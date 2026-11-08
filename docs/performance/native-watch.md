# Native observation measurements and rollout

The Rust broker replaces repeated directory walks in experimental native mode.
It keeps one native watcher for consumers sharing the same vault root. Frontend
and task consumers hold separate cursors; closing windows does not stop task
reminders. The TypeScript document/conflict policy remains in the frontend.

## Reproduce

```sh
npm run perf:native
# Short smoke run
npm run perf:native -- --counts 100 --windows 1 --rounds 3
# Longer idle check with the background cursor active
npm run perf:native -- --counts 10000 --windows 5 --rounds 10 --idle-ms 60000
cargo test --locked --manifest-path src-tauri/Cargo.toml -p mozi-vault-watch
```

Requires Rust stable. `CARGO=/path/to/cargo` can select the binary. Fixtures are
synthetic Markdown files in a temporary directory and are removed afterward.
Reports are written to ignored `.perf/native/latest.json`; they include OS,
architecture, commit and whether the working tree was dirty. No vault names,
paths or note contents are written into measurement reports.

Each modeled window holds a tree and active-file subscription; a background
observer holds one further reference. These are real OS handles and file events,
but **not actual application windows**. The report measures time from writing a
file until a cursor can read its event, including a 10 ms sampling interval.
It excludes IPC, WebView, React, editor rendering and calendar export. Legacy scan
cadence is modeled from current intervals, while one metadata scan is timed on
the same fixture; this is not an application CPU, memory or battery comparison.
The native harness performs no recursive scans after initializing its fixture.

## Initial Linux measurements

On 2026-11-08, the 100/1,000/10,000-note by 1/2/5-modeled-window matrix completed
with eight edits per case. Each case held one shared watcher, observed no batches
during its one-second idle interval, and released the last watcher after all
references closed. Journal-visible p95 ranged from 151.9 to 154.9 ms. These small
synthetic samples are a baseline for regression investigation, not a UI SLA or
proof of energy savings. CI uploads an independent short measurement per OS;
latency is informational to avoid thresholds tied to shared runner scheduling.

## Release gates

Native mode remains opt-in: launch with `MOZI_WATCH_MODE=native`. Unset the
variable or set `MOZI_WATCH_MODE=poll` and restart to restore polling for both
consumers. An unavailable backend or root automatically falls back. Frontend
fallback lasts until that subscription is recreated; task fallback retries native
attachment after 30 seconds. Startup failure keeps polling available.

| Validation                                               | Linux                                      | macOS   | Windows               |
| -------------------------------------------------------- | ------------------------------------------ | ------- | --------------------- |
| Real OS file events and shared-reference tests           | CI                                         | CI      | CI                    |
| Atomic replacement, case rename, burst and cleanup tests | CI                                         | CI      | CI                    |
| Synthetic broker measurement artifact                    | CI                                         | CI      | CI                    |
| Full Tauri Rust application tests                        | Requires GTK development libraries locally | CI      | Pending dedicated job |
| Packaged application UI, native mode                     | Pending                                    | Pending | Pending               |

Before changing the default, exercise the packaged app on each OS using both
watch modes and 1/2/5 windows. Cover initial opening and restoration, external
modification, own save, atomic replacement, case-only rename, move into/out of
trash, nested directory move, deletion with a dirty buffer, standalone files,
knowledge-base switching, window reload/close, sleep/resume, root removal and
recreation, and forced registration/backend failure. Check tree, editor conflict
behavior, backlinks/search/task consistency, unchanged reminder delivery and
final handle release. Include a slow disk and unavailable network share where
supported. Record app version, OS/filesystem, fixture size, idle CPU/RSS, IPC
volume, reads/full scans and end-to-end p50/p95. Set budgets from that evidence.

Headless tests and Linux Chromium tests do not clear the packaged UI gate. This
implementation does not authorize a default switch or claim completion of that
manual platform matrix.
