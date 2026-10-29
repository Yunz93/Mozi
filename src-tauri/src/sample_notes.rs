//! Bundled sample-notes synchronization.
//!
//! Extracted from `lib.rs` to keep the app entry point focused. The Tauri
//! command lives in `lib.rs`; this module owns the copy/diff/migration logic.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const SAMPLE_NOTES_STATE_FILE: &str = ".markdown-press-sample-notes-state.json";
pub const SAMPLE_NOTES_FOLDER_NAME: &str = "示例笔记";
const SAMPLE_NOTES_STATE_VERSION: u8 = 1;
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
    #[serde(default)]
    version: u8,
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
    let metadata = fs::symlink_metadata(target)
        .map_err(|e| format!("Failed to inspect sample notes directory: {}", e))?;
    let canonical_target = fs::canonicalize(target)
        .map_err(|e| format!("Failed to resolve sample notes directory: {}", e))?;
    let parent = fs::canonicalize(target.parent().ok_or("Missing sample notes parent")?)
        .map_err(|e| format!("Failed to resolve sample notes parent: {}", e))?;
    if metadata.file_type().is_symlink() || canonical_target.parent() != Some(parent.as_path()) {
        return Err("Sample notes directory must not redirect outside its parent".to_string());
    }
    let target = canonical_target.as_path();
    let (mut previous_state, _) = read_sample_notes_state(target)?;
    if previous_state.version != SAMPLE_NOTES_STATE_VERSION {
        // 旧版可能把用户原文哈希误作管理基线，不能用于覆盖、删除或跳过重建。
        previous_state = SampleNotesState::default();
    }
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
        version: SAMPLE_NOTES_STATE_VERSION,
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
        let target_path = match safe_sample_path(target, &relative_path) {
            Ok(path) => path,
            Err(_) => {
                skipped_files.push(relative_path);
                continue;
            }
        };
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

        if let Some(tracked_hash) = copy_decision.tracked_hash {
            next_state.files.insert(relative_path, tracked_hash);
        }
    }

    write_sample_notes_state(target, &next_state)?;

    Ok(CopySampleNotesResult {
        updated: !copied_files.is_empty(),
        copied_files,
        skipped_files,
    })
}

/// 状态清单来自知识库，只允许目录内的普通相对路径，不能沿符号链接写入或删除。
fn safe_sample_path(target: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty()
        || relative.contains('\\')
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Invalid sample notes relative path".to_string());
    }
    let root = fs::canonicalize(target).map_err(|e| e.to_string())?;
    let mut current = root.clone();
    for part in path.components() {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink()
                    || !fs::canonicalize(&current)
                        .map_err(|e| e.to_string())?
                        .starts_with(&root)
                {
                    return Err(
                        "Sample notes path redirects outside the managed directory".to_string()
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(current)
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
    let state_path = safe_sample_path(target, SAMPLE_NOTES_STATE_FILE)?;
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
    let state_path = safe_sample_path(target, SAMPLE_NOTES_STATE_FILE)?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize sample notes state: {}", e))?;
    let temp_path = safe_sample_path(target, ".markdown-press-sample-notes-state.json.tmp")?;

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

    // 用户原有文件不加入受管理清单，避免后续更新或清理把用户内容当作旧样例。
    Ok(CopyDecision {
        should_copy: false,
        skip_reason_user_modified: true,
        tracked_hash: None,
    })
}

fn migrate_legacy_sample_notes(target: &Path, state: &mut SampleNotesState) -> Result<(), String> {
    if state.version != SAMPLE_NOTES_STATE_VERSION {
        return Ok(());
    }
    for (legacy_relative_path, current_relative_path) in LEGACY_SAMPLE_NOTES_RENAMES {
        let Ok(legacy_path) = safe_sample_path(target, legacy_relative_path) else {
            continue;
        };
        if !legacy_path.exists() {
            state.files.remove(legacy_relative_path);
            continue;
        }

        // 只迁移当前版本明确管理且未被修改的旧样例，不动用户原有同名文件。
        let Some(previous_hash) = state.files.get(legacy_relative_path) else {
            continue;
        };
        if hash_file(&legacy_path)? != *previous_hash {
            continue;
        }

        if let Some(previous_hash) = state.files.remove(legacy_relative_path) {
            state
                .files
                .entry(current_relative_path.to_string())
                .or_insert(previous_hash);
        }

        let Ok(current_path) = safe_sample_path(target, current_relative_path) else {
            continue;
        };
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

        let Ok(target_path) = safe_sample_path(target, relative_path) else {
            continue;
        };
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
    fn current_state_migrates_only_unmodified_managed_legacy_notes() {
        for user_modified in [false, true] {
            let temp_dir = create_test_directory("sample-managed-legacy-rename");
            let legacy_name = "02-Obsidian-内联语法.md";
            let current = temp_dir.join("02-Obsidian-内联语法示例.md");
            let legacy = temp_dir.join(legacy_name);
            fs::write(
                &legacy,
                if user_modified {
                    "# user edits\n"
                } else {
                    "# bundled legacy\n"
                },
            )
            .expect("write legacy note");
            let mut state = SampleNotesState {
                version: SAMPLE_NOTES_STATE_VERSION,
                files: BTreeMap::from([(
                    legacy_name.to_string(),
                    hash_bytes(b"# bundled legacy\n"),
                )]),
                ..SampleNotesState::default()
            };

            migrate_legacy_sample_notes(&temp_dir, &mut state).expect("migrate trusted legacy");

            if user_modified {
                assert_eq!(
                    fs::read_to_string(&legacy).expect("user edits survive"),
                    "# user edits\n"
                );
                assert!(!current.exists());
            } else {
                assert!(!legacy.exists());
                assert_eq!(
                    fs::read_to_string(&current).expect("read migrated note"),
                    "# bundled legacy\n"
                );
            }
            cleanup_test_directory(&temp_dir);
        }
    }

    #[test]
    fn untracked_legacy_user_note_is_neither_removed_nor_renamed() {
        for current_exists in [false, true] {
            let temp_dir = create_test_directory("sample-legacy-untracked-name");
            let legacy = temp_dir.join("02-Obsidian-内联语法.md");
            let current = temp_dir.join("02-Obsidian-内联语法示例.md");
            fs::write(&legacy, "# user original\n").expect("write legacy user note");
            if current_exists {
                fs::write(&current, "# another user note\n").expect("write current user note");
            }

            migrate_legacy_sample_notes(&temp_dir, &mut SampleNotesState::default())
                .expect("skip untrusted migration");

            assert_eq!(
                fs::read_to_string(&legacy).expect("legacy note survives"),
                "# user original\n"
            );
            assert_eq!(current.exists(), current_exists);
            cleanup_test_directory(&temp_dir);
        }
    }

    #[test]
    fn legacy_user_hash_cannot_authorize_overwrite_or_stale_removal() {
        for removed_from_bundle in [false, true] {
            let temp_dir = create_test_directory("sample-legacy-user-hash");
            let source = temp_dir.join("source");
            let target = temp_dir.join("target");
            fs::create_dir(&source).expect("create source");
            fs::create_dir(&target).expect("create target");
            let user_note = target.join("custom.md");
            fs::write(&user_note, "# user original\n").expect("write user note");
            if !removed_from_bundle {
                fs::write(source.join("custom.md"), "# new bundle\n").expect("write new bundle");
            }
            let legacy_state = serde_json::json!({
                "bundleHash": "previous-bundle",
                "files": {"custom.md": hash_file(&user_note).expect("hash user note")},
            });
            fs::write(
                target.join(SAMPLE_NOTES_STATE_FILE),
                legacy_state.to_string(),
            )
            .expect("write legacy state");

            sync_sample_notes(&source, &target).expect("migrate and sync");

            assert_eq!(
                fs::read_to_string(&user_note).expect("user note survives"),
                "# user original\n"
            );
            let (state, _) = read_sample_notes_state(&target).expect("read new state");
            assert!(!state.files.contains_key("custom.md"));
            cleanup_test_directory(&temp_dir);
        }
    }

    #[test]
    fn legacy_matching_bundle_rebuilds_only_verified_management_hashes() {
        let temp_dir = create_test_directory("sample-legacy-rebuild");
        let source = temp_dir.join("source");
        let target = temp_dir.join("target");
        fs::create_dir(&source).expect("create source");
        fs::create_dir(&target).expect("create target");
        fs::write(source.join("managed.md"), "# bundle v1\n").expect("write source");
        fs::write(target.join("managed.md"), "# bundle v1\n").expect("write matching copy");
        let user_note = target.join("custom.md");
        fs::write(&user_note, "# user original\n").expect("write user note");
        let current_bundle_hash = hash_manifest(
            &build_source_hashes(&collect_files(&source, &source).expect("collect source"))
                .expect("hash source"),
        )
        .expect("hash manifest");
        let legacy_state = serde_json::json!({
            "bundleHash": current_bundle_hash,
            "files": {"custom.md": hash_file(&user_note).expect("hash user note")},
        });
        fs::write(
            target.join(SAMPLE_NOTES_STATE_FILE),
            legacy_state.to_string(),
        )
        .expect("write legacy state");

        sync_sample_notes(&source, &target).expect("rebuild legacy state");

        let (state, _) = read_sample_notes_state(&target).expect("read rebuilt state");
        assert!(!state.files.contains_key("custom.md"));
        assert!(state.files.contains_key("managed.md"));
        fs::write(source.join("managed.md"), "# bundle v2\n").expect("update source");
        sync_sample_notes(&source, &target).expect("update verified sample");
        assert_eq!(
            fs::read_to_string(target.join("managed.md")).expect("read sample"),
            "# bundle v2\n"
        );
        assert_eq!(
            fs::read_to_string(&user_note).expect("read user note"),
            "# user original\n"
        );
        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn current_state_removes_only_unchanged_managed_samples() {
        let temp_dir = create_test_directory("sample-managed-removal");
        let source = temp_dir.join("source");
        let target = temp_dir.join("target");
        let empty_source = temp_dir.join("empty-source");
        fs::create_dir(&source).expect("create source");
        fs::create_dir(&target).expect("create target");
        fs::create_dir(&empty_source).expect("create empty source");
        fs::write(source.join("managed.md"), "# managed\n").expect("write source");
        sync_sample_notes(&source, &target).expect("first sync");
        assert!(target.join("managed.md").exists());

        sync_sample_notes(&empty_source, &target).expect("remove stale managed sample");

        assert!(!target.join("managed.md").exists());
        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn managed_sample_updates_and_preserves_later_user_edits() {
        let temp_dir = create_test_directory("sample-managed-updates");
        let source = temp_dir.join("source");
        let target = temp_dir.join("target");
        fs::create_dir(&source).expect("create source");
        fs::create_dir(&target).expect("create target");
        let bundled = source.join("managed.md");
        let copied = target.join("managed.md");
        fs::write(&bundled, "# bundled v1\n").expect("write bundle v1");
        sync_sample_notes(&source, &target).expect("first sync");
        fs::write(&bundled, "# bundled v2\n").expect("write bundle v2");
        sync_sample_notes(&source, &target).expect("second sync");
        assert_eq!(
            fs::read_to_string(&copied).expect("read updated sample"),
            "# bundled v2\n"
        );

        fs::write(&copied, "# user edits\n").expect("edit copied sample");
        fs::write(&bundled, "# bundled v3\n").expect("write bundle v3");
        sync_sample_notes(&source, &target).expect("third sync");
        assert_eq!(
            fs::read_to_string(&copied).expect("read edited sample"),
            "# user edits\n"
        );
        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn untracked_user_note_survives_later_bundle_updates_and_removal() {
        let temp_dir = create_test_directory("sample-user-note-multiple-syncs");
        let source = temp_dir.join("source");
        let target = temp_dir.join("target");
        fs::create_dir(&source).expect("create source");
        fs::create_dir(&target).expect("create target");
        let user_note = target.join("custom.md");
        fs::write(&user_note, "# my original note\n").expect("write user note");
        fs::write(source.join("custom.md"), "# bundled v1\n").expect("write bundle v1");
        sync_sample_notes(&source, &target).expect("first sync");
        assert_eq!(
            fs::read_to_string(&user_note).expect("first read"),
            "# my original note\n"
        );

        fs::write(source.join("custom.md"), "# bundled v2\n").expect("write bundle v2");
        sync_sample_notes(&source, &target).expect("second sync");
        assert_eq!(
            fs::read_to_string(&user_note).expect("second read"),
            "# my original note\n"
        );

        let empty_source = temp_dir.join("empty-source");
        fs::create_dir(&empty_source).expect("create empty source");
        sync_sample_notes(&empty_source, &target).expect("sync removed sample");
        assert_eq!(
            fs::read_to_string(&user_note).expect("final read"),
            "# my original note\n"
        );
        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn untracked_existing_sample_note_is_preserved() {
        let temp_dir = create_test_directory("sample-note-preserve");
        let target_path = temp_dir.join("02-Obsidian-内联语法示例.md");
        fs::write(&target_path, "# old sample version\n").expect("write target");

        let decision = decide_copy_action(&target_path, &hash_bytes(b"# bundled version\n"), None)
            .expect("copy decision");

        assert!(!decision.should_copy);
        assert!(decision.skip_reason_user_modified);
        assert!(decision.tracked_hash.is_none());

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

        let mut state = SampleNotesState {
            version: SAMPLE_NOTES_STATE_VERSION,
            files: BTreeMap::from([(
                legacy_relative_path.to_string(),
                hash_file(&legacy_path).expect("hash legacy sample"),
            )]),
            ..SampleNotesState::default()
        };
        migrate_legacy_sample_notes(&temp_dir, &mut state).expect("migrate legacy sample");

        assert!(!legacy_path.exists());
        assert!(current_path.exists());
        assert!(state.files.contains_key(current_relative_path));

        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn forged_state_cannot_remove_files_outside_sample_directory() {
        let root = create_test_directory("sample-path-traversal");
        let source = root.join("source");
        let target = root.join("vault/samples");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("valid.md"), "# bundled\n").unwrap();
        let victim = root.join("outside.md");
        fs::write(&victim, "# user content\n").unwrap();
        for relative in [
            "../../outside.md".to_string(),
            victim.to_string_lossy().into_owned(),
            "..\\..\\outside.md".to_string(),
        ] {
            let state = SampleNotesState {
                version: 1,
                bundle_hash: "old".to_string(),
                files: BTreeMap::from([(relative, hash_file(&victim).unwrap())]),
            };
            write_sample_notes_state(&target, &state).unwrap();
            sync_sample_notes(&source, &target).unwrap();
            assert_eq!(fs::read_to_string(&victim).unwrap(), "# user content\n");
        }
        assert!(target.join("valid.md").exists());
        cleanup_test_directory(&root);
    }

    #[cfg(unix)]
    #[test]
    fn sample_sync_never_follows_target_or_child_symlinks() {
        use std::os::unix::fs::symlink;
        let root = create_test_directory("sample-symlink-boundary");
        let source = root.join("source");
        let target = root.join("vault/samples");
        let outside = root.join("outside");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(source.join("note.md"), "# new bundle\n").unwrap();
        let victim = outside.join("user.md");
        fs::write(&victim, "# user content\n").unwrap();
        symlink(&outside, target.join("linked")).unwrap();
        symlink(&victim, target.join("note.md")).unwrap();
        let state = SampleNotesState {
            version: 1,
            bundle_hash: "old".to_string(),
            files: BTreeMap::from([
                ("linked/user.md".to_string(), hash_file(&victim).unwrap()),
                ("note.md".to_string(), hash_file(&victim).unwrap()),
            ]),
        };
        write_sample_notes_state(&target, &state).unwrap();
        let result = sync_sample_notes(&source, &target).unwrap();
        assert!(result.skipped_files.contains(&"note.md".to_string()));
        assert_eq!(fs::read_to_string(&victim).unwrap(), "# user content\n");
        let alias = root.join("vault/alias");
        symlink(&outside, &alias).unwrap();
        assert!(sync_sample_notes(&source, &alias).is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "# user content\n");
        cleanup_test_directory(&root);
    }

    #[cfg(unix)]
    #[test]
    fn sample_state_and_temp_files_cannot_redirect_writes() {
        use std::os::unix::fs::symlink;
        let root = create_test_directory("sample-state-symlink");
        let target = root.join("samples");
        fs::create_dir(&target).unwrap();
        let victim = root.join("private.md");
        fs::write(&victim, "private user content").unwrap();
        symlink(
            &victim,
            target.join(".markdown-press-sample-notes-state.json.tmp"),
        )
        .unwrap();
        assert!(write_sample_notes_state(&target, &SampleNotesState::default()).is_err());
        symlink(&victim, target.join(SAMPLE_NOTES_STATE_FILE)).unwrap();
        assert!(read_sample_notes_state(&target).is_err());
        assert_eq!(fs::read_to_string(&victim).unwrap(), "private user content");
        cleanup_test_directory(&root);
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
