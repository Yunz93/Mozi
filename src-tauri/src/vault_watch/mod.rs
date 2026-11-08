//! Window-owned IPC boundary around the process-wide, GUI-independent broker.
use mozi_vault_watch::{Broker, Page, Stats, Subscription};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Default)]
struct Owners {
    subscriptions: HashMap<String, String>,
    generations: HashMap<String, u64>,
}
pub struct WatchState {
    pub broker: Broker,
    owners: Arc<Mutex<Owners>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Hint {
    subscription_id: String,
    epoch: String,
    seq: u64,
}

pub fn native_enabled() -> bool {
    std::env::var("MOZI_WATCH_MODE").as_deref() == Ok("native")
}
pub fn available(app: &AppHandle) -> bool {
    native_enabled() && app.try_state::<WatchState>().is_some()
}
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let owners = Arc::new(Mutex::new(Owners::default()));
    let routes = owners.clone();
    let handle = app.clone();
    let broker = Broker::try_new(move |notice| {
        let owner = routes
            .lock()
            .ok()
            .and_then(|o| o.subscriptions.get(&notice.subscription_id).cloned());
        if let Some(label) = owner {
            let _ = handle.emit_to(
                label,
                "vault-watch-changed",
                Hint {
                    subscription_id: notice.subscription_id,
                    epoch: notice.epoch,
                    seq: notice.seq,
                },
            );
        }
    })?;
    app.manage(WatchState { broker, owners });
    Ok(())
}
impl WatchState {
    fn generation(&self, label: &str) -> Result<u64, String> {
        Ok(*self
            .owners
            .lock()
            .map_err(|_| "Owner lock failed")?
            .generations
            .get(label)
            .unwrap_or(&0))
    }
    fn owns(&self, label: &str, id: &str) -> Result<(), String> {
        if self
            .owners
            .lock()
            .map_err(|_| "Owner lock failed")?
            .subscriptions
            .get(id)
            .is_some_and(|owner| owner == label)
        {
            Ok(())
        } else {
            Err("Subscription does not belong to this window".into())
        }
    }
    fn attach(&self, label: &str, generation: u64, token: &Subscription) -> Result<(), String> {
        let mut owners = self.owners.lock().map_err(|_| "Owner lock failed")?;
        if *owners.generations.get(label).unwrap_or(&0) != generation {
            return Err("Window subscription was superseded".into());
        }
        if owners
            .subscriptions
            .values()
            .filter(|owner| owner.as_str() == label)
            .count()
            >= 64
        {
            return Err("Too many window subscriptions".into());
        }
        owners
            .subscriptions
            .insert(token.subscription_id.clone(), label.into());
        Ok(())
    }
}
/// Called for reload and destruction. Revoke ownership synchronously; release OS
/// handles off the UI thread so a backend shutdown cannot freeze window input.
pub fn release_window(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<WatchState>() else {
        return;
    };
    let ids = if let Ok(mut owners) = state.owners.lock() {
        *owners.generations.entry(label.into()).or_default() += 1;
        let ids: Vec<_> = owners
            .subscriptions
            .iter()
            .filter(|(_, owner)| owner.as_str() == label)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            owners.subscriptions.remove(id);
        }
        ids
    } else {
        Vec::new()
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(state) = app.try_state::<WatchState>() {
            for id in ids {
                state.broker.unsubscribe(&id);
            }
        }
    });
}

#[tauri::command]
pub fn vault_watch_mode(app: AppHandle) -> &'static str {
    if available(&app) {
        "native"
    } else {
        "poll"
    }
}

#[tauri::command]
pub async fn subscribe_vault(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    directory: bool,
) -> Result<Subscription, String> {
    if !available(&app) {
        return Err("Native watch mode is disabled".into());
    }
    let label = window.label().to_string();
    let generation = app.state::<WatchState>().generation(&label)?;
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = crate::canonicalize_scope_path(&path)?;
        let security = app.state::<crate::SecurityState>();
        if directory {
            let paths = security
                .allowed_paths
                .lock()
                .map_err(|_| "Path permission lock failed")?;
            if !paths
                .iter()
                .any(|entry| entry.recursive && canonical.starts_with(&entry.path))
            {
                return Err("Recursive directory permission is required".into());
            }
        } else {
            crate::ensure_path_allowed(security.inner(), &canonical)?;
        }
        let state = app
            .try_state::<WatchState>()
            .ok_or("Watch service unavailable")?;
        let token = state.broker.subscribe(&canonical, directory)?;
        if app.get_webview_window(&label).is_none() {
            state.broker.unsubscribe(&token.subscription_id);
            return Err("Window has closed".into());
        }
        if let Err(error) = state.attach(&label, generation, &token) {
            state.broker.unsubscribe(&token.subscription_id);
            return Err(error);
        }
        Ok(token)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn get_vault_changes(
    app: AppHandle,
    window: WebviewWindow,
    subscription_id: String,
    epoch: String,
    after_seq: u64,
) -> Result<Page, String> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<WatchState>()
            .ok_or("Watch service unavailable")?;
        state.owns(&label, &subscription_id)?;
        state.broker.changes(&subscription_id, &epoch, after_seq)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn unsubscribe_vault(
    app: AppHandle,
    window: WebviewWindow,
    subscription_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<WatchState>()
            .ok_or("Watch service unavailable")?;
        state.owns(&label, &subscription_id)?;
        state
            .owners
            .lock()
            .map_err(|_| "Owner lock failed")?
            .subscriptions
            .remove(&subscription_id);
        state.broker.unsubscribe(&subscription_id);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn vault_watch_stats(app: AppHandle) -> Stats {
    app.try_state::<WatchState>()
        .map(|state| state.broker.stats())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owner_and_generation_isolate_windows() {
        let state = WatchState {
            broker: Broker::default(),
            owners: Default::default(),
        };
        let token = Subscription {
            subscription_id: "one".into(),
            epoch: "epoch".into(),
            seq: 0,
            path: "/synthetic".into(),
        };
        state.attach("main", 0, &token).unwrap();
        assert!(state.owns("other", "one").is_err());
        assert!(state.owns("main", "one").is_ok());
        state
            .owners
            .lock()
            .unwrap()
            .generations
            .insert("main".into(), 1);
        assert!(state.attach("main", 0, &token).is_err());
    }
}
