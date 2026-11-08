# Native filesystem observation

The GUI-independent Rust crate `src-tauri/crates/vault-watch` owns native handles,
150 ms event coalescing (500 ms maximum under a sustained burst), bounded replay
and per-subscription scopes. `src-tauri/src/vault_watch` authorizes IPC requests
and routes hints only to the owning window. The frontend still owns document
conflicts and the task consumer still owns reminder policy. This service does not
write notes or change disk index formats.

## Contract and lifetime

- `vault_watch_mode` returns `native` or `poll` for this process.
- `subscribe_vault(path, directory)` returns a window-owned ID, canonical scope
  path, epoch and sequence. File grants never imply access to sibling files.
- Establish the subscription **before** reading the initial snapshot, then fetch
  `get_vault_changes(subscriptionId, epoch, afterSeq)` to reconcile changes during
  that read. `vault-watch-changed` is a targeted version hint, not the data log.
- A cursor gap, backend overflow, epoch mismatch or ambiguous event requests a
  snapshot; a terminal backend/root error requests polling fallback. Replay is
  bounded, so clients must tolerate resynchronization, not assume exactly-once OS
  delivery. Changed paths carry no file contents.
- `unsubscribe_vault` releases a reference. The last reference drops the handle.
  Reload and actual window destruction revoke old IPC ownership. Background task
  references are independent of editor-window references.
- `vault_watch_stats` provides numerical diagnostics without exposing root paths.

Native mode is experimental and **not enabled by default**. Set
`MOZI_WATCH_MODE=native` before launching the app to opt in; use `poll` (or unset
it) and restart to roll back both frontend/task consumers. Enabling by default is
reserved for successful packaged macOS/Windows/Linux validation. Unit tests,
headless OS watcher tests and Chromium do not establish that validation.

Run native tests on any supported OS without GTK/WebView dependencies:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml -p mozi-vault-watch
```

CI also runs the Tauri application tests on macOS to check IPC integration. Native
watcher tests exercise shared roots, exact-file isolation, snapshot races, actual
rename/delete/root loss and symlink boundaries (where supported); deterministic
journal tests cover coalescing, bounded latency, overflow and replay gaps.

## Task calendar consumer

The task worker holds independent broker subscriptions for registered vaults, so
closing an editor window releases only its own references. It subscribes before
the initial scan and consumes cursor pages on its existing one-second reminder
tick. A healthy native consumer does not run the five-second recursive scan.

File hints reparse the current target. Directory creation/moves reconcile that
subtree; excluded directories, trash, symlinks and non-Markdown files retain the
snapshot policy. Replay gaps, resume after a long sleep, timezone changes and
manual refresh trigger a snapshot. Read/backend failures release native references
and restore the existing scan backoff; native attachment retries after 30 seconds.
Reminder delivery still rereads due source files before sending notifications.

Replay requests probe only the watched root's metadata to detect backends that
silently stop after root removal. Idle consumers do not walk directories or read
note bodies. Ambiguous renames preserve a structural hint; unsafe link replacement
requests a filtered snapshot rather than disclosing the target. For measurements,
rollback instructions and the packaged platform gate, see
[performance/native-watch.md](../performance/native-watch.md).
