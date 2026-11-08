//! Cursor ownership for trusted, non-window consumers of the shared broker.
use crate::{Broker, Change, Subscription};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Arc,
};
#[derive(Default)]
pub struct Updates {
    pub rescan_required: bool,
    pub changes: Vec<Change>,
}
pub struct Observer {
    broker: Arc<Broker>,
    roots: BTreeMap<PathBuf, Subscription>,
}
impl Observer {
    pub fn new(broker: Arc<Broker>) -> Self {
        Self {
            broker,
            roots: BTreeMap::new(),
        }
    }
    /// New roots are subscribed before the caller reads their initial snapshot.
    /// On failure all references are released, allowing exclusive polling fallback.
    pub fn set_roots(&mut self, paths: impl IntoIterator<Item = PathBuf>) -> Result<(), String> {
        let wanted: BTreeSet<_> = paths.into_iter().collect();
        let obsolete: Vec<_> = self
            .roots
            .keys()
            .filter(|p| !wanted.contains(*p))
            .cloned()
            .collect();
        for path in obsolete {
            if let Some(sub) = self.roots.remove(&path) {
                self.broker.unsubscribe(&sub.subscription_id);
            }
        }
        for path in wanted {
            if self.roots.contains_key(&path) {
                continue;
            }
            match self.broker.subscribe(&path, true) {
                Ok(token) => {
                    self.roots.insert(path, token);
                }
                Err(error) => {
                    self.clear();
                    return Err(error);
                }
            }
        }
        Ok(())
    }
    pub fn poll(&mut self) -> Result<Updates, String> {
        let mut updates = Updates::default();
        for token in self.roots.values_mut() {
            let page = self
                .broker
                .changes(&token.subscription_id, &token.epoch, token.seq)?;
            if let Some(error) = page.error {
                return Err(error);
            }
            // Advance BEFORE the consumer reads a replacement snapshot.
            token.epoch = page.epoch;
            token.seq = page.seq;
            updates.rescan_required |= page.rescan_required;
            updates.changes.extend(page.changes);
        }
        Ok(updates)
    }
    fn clear(&mut self) {
        for (_, token) in std::mem::take(&mut self.roots) {
            self.broker.unsubscribe(&token.subscription_id);
        }
    }
}
impl Drop for Observer {
    fn drop(&mut self) {
        self.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn background_reference_survives_window_close_and_releases_on_drop() {
        let path = std::env::temp_dir().join(format!("mozi-observer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let broker = Arc::new(Broker::default());
        let window = broker.subscribe(&path, true).unwrap();
        let mut observer = Observer::new(broker.clone());
        observer.set_roots([path.clone()]).unwrap();
        broker.unsubscribe(&window.subscription_id);
        assert_eq!(broker.stats().watchers, 1);
        assert_eq!(broker.stats().subscriptions, 1);
        assert!(observer
            .poll()
            .unwrap()
            .changes
            .iter()
            .all(|c| c.path.starts_with(std::fs::canonicalize(&path).unwrap())));
        drop(observer);
        assert_eq!(broker.stats().watchers, 0);
        std::fs::remove_dir(path).unwrap();
    }
    #[test]
    fn failed_subscription_releases_every_reference() {
        let path = std::env::temp_dir().join(format!("mozi-observer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let broker = Arc::new(Broker::default());
        let mut observer = Observer::new(broker.clone());
        observer.set_roots([path.clone()]).unwrap();
        assert!(observer
            .set_roots([path.clone(), path.join("missing")])
            .is_err());
        assert_eq!(broker.stats().subscriptions, 0);
        std::fs::remove_dir(path).unwrap();
    }
}
