//! Bundled sample-notes synchronization.
//!
//! Extracted from `lib.rs` to keep the app entry point focused. The Tauri
//! command lives in `lib.rs`; this module owns the copy/diff/migration logic.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const SAMPLE_NOTES_STATE_FILE: &str = ".markdown-press-sample-notes-state.json";
pub const SAMPLE_NOTES_FOLDER_NAME: &str = "示例笔记";
const LEGACY_SAMPLE_NOTES_RENAMES: [(&str, &str); 1] =
    [("02-Obsidian-内联语法.md", "02-Obsidian-内联语法示例.md")];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopySampleNotesResult {
    pub updated: bool,
    pub copied_files: Vec<String>,
    pub skipped_files: Vec<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleNotesState {
    bundle_hash: String,
    files: BTreeMap<String, String>,
}

#[derive(Debug)]
struct CopyDecision {
    should_copy: bool,
    skip_reason_user_modified: bool,
    tracked_hash: Option<String>,
}

/// Synchronize the bundled sample notes from `source` into `target`,
/// preserving user modifications and cleaning up stale tracked files.
pub fn sync_sample_notes(source: &Path, target: &Path) -> Result<CopySampleNotesResult, String> {
    let (mut previous_state, _) = read_sample_notes_state(target)?;
    migrate_legacy_sample_notes(target, &mut previous_state)?;

    let source_files = collect_files(source, source)?;
    let source_hashes = build_source_hashes(&source_files)?;
    let bundle_hash = hash_manifest(&source_hashes)?;

    if previous_state.bundle_hash == bundle_hash {
        return Ok(CopySampleNotesResult {
            updated: false,
            copied_files: Vec::new(),
            skipped_files: Vec::new(),
        });
    }

    let mut next_state = SampleNotesState {
        bundle_hash,
        files: BTreeMap::new(),
    };
    let mut copied_files = Vec::new();
    let mut skipped_files = Vec::new();

    remove_stale_sample_note_files(target, &previous_state, &source_hashes)?;

    for (relative_path, source_path) in source_files {
        let source_hash = source_hashes
            .get(&relative_path)
            .ok_or_else(|| format!("Missing source hash for {}", relative_path))?
            .clone();
        let target_path = target.join(relative_path.as_str());
        let copy_decision = decide_copy_action(
            &target_path,
            &source_hash,
            previous_state.files.get(&relative_path),
        )?;

        if copy_decision.should_copy {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
            }

            fs::copy(&source_path, &target_path)
                .map_err(|e| format!("Failed to copy file {:?}: {}", source_path, e))?;
            copied_files.push(relative_path.clone());
            next_state.files.insert(relative_path, source_hash);
            continue;
        }

        if copy_decision.skip_reason_user_modified {
            skipped_files.push(relative_path.clone());
        }

        let tracked_hash = copy_decision.tracked_hash.unwrap_or(source_hash);
        next_state.files.insert(relative_path, tracked_hash);
    }

    write_sample_notes_state(target, &next_state)?;

    Ok(CopySampleNotesResult {
        updated: !copied_files.is_empty(),
        copied_files,
        skipped_files,
    })
}

fn collect_files(base: &Path, current: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut files = BTreeMap::new();

    for entry in fs::read_dir(current).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            files.extend(collect_files(base, &path)?);
            continue;
        }

        let relative = path
            .strip_prefix(base)
            .map_err(|e| format!("Failed to resolve relative path {:?}: {}", path, e))?;
        files.insert(relative.to_string_lossy().replace('\\', "/"), path);
    }

    Ok(files)
}

fn build_source_hashes(
    files: &BTreeMap<String, PathBuf>,
) -> Result<BTreeMap<String, String>, String> {
    files
        .iter()
        .map(|(relative_path, full_path)| {
            hash_file(full_path).map(|hash| (relative_path.clone(), hash))
        })
        .collect()
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file {:?}: {}", path, e))?;
    Ok(hash_bytes(&bytes))
}

fn hash_manifest(manifest: &BTreeMap<String, String>) -> Result<String, String> {
    let bytes = serde_json::to_vec(manifest)
        .map_err(|e| format!("Failed to serialize sample notes manifest: {}", e))?;
    Ok(hash_bytes(&bytes))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn read_sample_notes_state(target: &Path) -> Result<(SampleNotesState, bool), String> {
    let state_path = target.join(SAMPLE_NOTES_STATE_FILE);
    if !state_path.exists() {
        return Ok((SampleNotesState::default(), false));
    }

    let content = fs::read_to_string(&state_path)
        .map_err(|e| format!("Failed to read sample notes state {:?}: {}", state_path, e))?;
    serde_json::from_str(&content)
        .map(|state| (state, true))
        .map_err(|e| format!("Failed to parse sample notes state {:?}: {}", state_path, e))
}

fn write_sample_notes_state(target: &Path, state: &SampleNotesState) -> Result<(), String> {
    let state_path = target.join(SAMPLE_NOTES_STATE_FILE);
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize sample notes state: {}", e))?;
    let temp_path = state_path.with_extension("json.tmp");

    fs::write(&temp_path, content).map_err(|e| {
        format!(
            "Failed to write sample notes state temp file {:?}: {}",
            temp_path, e
        )
    })?;
    fs::rename(&temp_path, &state_path).map_err(|e| {
        format!(
            "Failed to replace sample notes state {:?}: {}",
            state_path, e
        )
    })
}

fn decide_copy_action(
    target_path: &Path,
    source_hash: &str,
    previous_hash: Option<&String>,
) -> Result<CopyDecision, String> {
    if !target_path.exists() {
        return Ok(CopyDecision {
            should_copy: true,
            skip_reason_user_modified: false,
            tracked_hash: None,
        });
    }

    let current_target_hash = hash_file(target_path)?;
    if current_target_hash == source_hash {
        return Ok(CopyDecision {
            should_copy: false,
            skip_reason_user_modified: false,
            tracked_hash: Some(source_hash.to_string()),
        });
    }

    if let Some(previous_hash) = previous_hash {
        if current_target_hash == *previous_hash {
            return Ok(CopyDecision {
                should_copy: true,
                skip_reason_user_modified: false,
                tracked_hash: None,
            });
        }

        return Ok(CopyDecision {
            should_copy: false,
            skip_reason_user_modified: true,
            tracked_hash: Some(previous_hash.clone()),
        });
    }

    // No tracking hash: the file was there before we started managing it
    // (settings reset, missing state file, or a user-created note with the
    // same name). Never replace it on app update.
    Ok(CopyDecision {
        should_copy: false,
        skip_reason_user_modified: true,
        tracked_hash: Some(current_target_hash),
    })
}

fn migrate_legacy_sample_notes(target: &Path, state: &mut SampleNotesState) -> Result<(), String> {
    for (legacy_relative_path, current_relative_path) in LEGACY_SAMPLE_NOTES_RENAMES {
        let legacy_path = target.join(legacy_relative_path);
        if !legacy_path.exists() {
            state.files.remove(legacy_relative_path);
            continue;
        }

        if let Some(previous_hash) = state.files.remove(legacy_relative_path) {
            state
                .files
                .entry(current_relative_path.to_string())
                .or_insert(previous_hash);
        }

        let current_path = target.join(current_relative_path);
        if current_path.exists() {
            fs::remove_file(&legacy_path).map_err(|e| {
                format!(
                    "Failed to remove migrated legacy sample note {:?}: {}",
                    legacy_path, e
                )
            })?;
            continue;
        }

        if let Some(parent) = current_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
        }

        fs::rename(&legacy_path, &current_path).map_err(|e| {
            format!(
                "Failed to rename legacy sample note {:?} to {:?}: {}",
                legacy_path, current_path, e
            )
        })?;
    }

    Ok(())
}

fn remove_stale_sample_note_files(
    target: &Path,
    previous_state: &SampleNotesState,
    source_hashes: &BTreeMap<String, String>,
) -> Result<(), String> {
    for (relative_path, tracked_hash) in &previous_state.files {
        if source_hashes.contains_key(relative_path) {
            continue;
        }

        let target_path = target.join(relative_path);
        if !target_path.exists() {
            continue;
        }

        let current_hash = hash_file(&target_path)?;
        if current_hash != *tracked_hash {
            continue;
        }

        fs::remove_file(&target_path).map_err(|e| {
            format!(
                "Failed to remove stale sample note {:?}: {}",
                target_path, e
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn untracked_existing_sample_note_is_preserved() {
        let temp_dir = create_test_directory("sample-note-preserve");
        let target_path = temp_dir.join("02-Obsidian-内联语法示例.md");
        fs::write(&target_path, "# old sample version\n").expect("write target");

        let decision = decide_copy_action(&target_path, &hash_bytes(b"# bundled version\n"), None)
            .expect("copy decision");

        assert!(!decision.should_copy);
        assert!(decision.skip_reason_user_modified);
        assert_eq!(
            decision.tracked_hash.as_deref(),
            Some(hash_bytes(b"# old sample version\n").as_str())
        );

        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn migrate_legacy_sample_note_removes_duplicate_file() {
        let temp_dir = create_test_directory("sample-note-migration");
        let legacy_relative_path = "02-Obsidian-内联语法.md";
        let current_relative_path = "02-Obsidian-内联语法示例.md";
        let legacy_path = temp_dir.join(legacy_relative_path);
        let current_path = temp_dir.join(current_relative_path);
        fs::write(&legacy_path, "# legacy sample\n").expect("write legacy sample");
        fs::write(&current_path, "# current bundled sample\n").expect("write current sample");

        let mut state = SampleNotesState::default();
        migrate_legacy_sample_notes(&temp_dir, &mut state).expect("migrate legacy sample");

        assert!(!legacy_path.exists());
        assert!(current_path.exists());
        assert!(state.files.get(current_relative_path).is_none());

        cleanup_test_directory(&temp_dir);
    }

    fn create_test_directory(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let unique = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        path.push(format!(
            "markdown-press-{}-{}-{}",
            prefix,
            std::process::id(),
            unique
        ));

        if path.exists() {
            fs::remove_dir_all(&path).expect("cleanup existing test dir");
        }

        fs::create_dir_all(&path).expect("create test dir");
        path
    }

    fn cleanup_test_directory(path: &Path) {
        if path.exists() {
            fs::remove_dir_all(path).expect("cleanup test dir");
        }
    }
}
