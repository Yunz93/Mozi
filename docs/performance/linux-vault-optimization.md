# Vault indexing and window rendering

The November 2026 Linux desktop acceptance exposed repeated file-tree work,
retained background-read state, and an unbounded sidebar DOM. The follow-up
changes are split into PRs [250](https://github.com/Yunz93/Mozi/pull/250),
[251](https://github.com/Yunz93/Mozi/pull/251),
[252](https://github.com/Yunz93/Mozi/pull/252),
[253](https://github.com/Yunz93/Mozi/pull/253), and
[254](https://github.com/Yunz93/Mozi/pull/254).

## Implementation

- Wiki resolution builds lookup maps once per immutable tree and root, preserving
  root/local/suffix/basename precedence and ambiguity. Backlink deduplication uses
  sets rather than repeated linear membership checks.
- Directory scans normalize each directory once through the native path API and
  append native leaf names locally. Background index/search reads do not retain
  editor content, BOM, line-ending, or encoding-guard state. Persisted index JSON
  is released from the in-memory fallback store after successful disk writes.
- Index reads have at most eight outstanding requests. Link and chunk keys retain
  tree order even when reads complete out of order; cancellation stops admission
  of further files. Progress updates publish at most ten times per second, plus
  initial/final updates. External index notifications coalesce for 80 ms, yielding
  to document reloads and cancelling pending work when a vault closes.
- The sidebar renders visible rows with overscan. Expansion state outlives row
  unmounts; locate-current-file waits for ancestor paths and handles repeated
  requests. Row measurement follows actual CSS height. Drag imports, moves,
  hover expansion, trash filtering, and existing ordering remain covered.
- Syntax highlighting starts only when a supported fence needs it and loads
  requested grammars. Plain notes and Mermaid fences do not initialize Shiki.
- Hybrid sidebar search merges literal contents with retrieval hits, including
  notes shorter than the semantic chunk threshold and current unsaved buffers.
  Reads have the same eight-request bound. The disk-text cache holds at most
  2,048 files and 1,000,000 UTF-16 code units; index/tree updates invalidate it.

## Core measurement

The existing `npm run perf:core` harness compared baseline `9c01e23` with
implementation `ab13e95`, on Linux x86_64 / Node 24.22.1, using identical fixtures
and five rounds per size. Values below are median full-index durations:

| Notes | Before | After |
| --- | ---: | ---: |
| 100 | 15.0 ms | 3.4 ms |
| 1,000 | 480.3 ms | 22.3 ms |
| 10,000 | 41,473.4 ms | 162.9 ms |

These are Node/Vite SSR observations on a shared development machine, excluding
disk, WebView, windows, and embedding models. Rounds reuse a process and fixture
tree; the first round includes building lookup maps. They are not native launch
times or a latency budget. Preserve raw samples when repeating comparisons.

```sh
PERF_COUNTS=100,1000,10000 PERF_ROUNDS=5 npm run perf:core
```

## Desktop comparison protocol

Use the [Linux acceptance environment](linux-desktop-acceptance.md) and the
[desktop checklist](README.md#packaged-desktop-checklist). Install the actual
release package and generate synthetic vaults; do not substitute a browser
filesystem fixture. For every note-count/window-count/mode cohort, start a fresh
application process and isolated profile. Measure the first window's restored
document and first persisted link/chunk indexes separately. Open actual windows,
then wait a fixed interval before sampling aggregate process PSS and external
write-to-all-window DOM latency. Record the interval, background activity,
package hash, runtime, window count, and individual samples.

An eight-second wait is a reproducible resource snapshot, not proof of steady
state or peak memory. Three write samples are smoke evidence, not a stable p95
or a power budget. Native and poll modes may have different background work.
Keep generated profiles, settings, notes, screenshots, and raw session paths out
of the public repository; attach a sanitized comparison to the relevant PR.

The shared Rust watcher remains opt-in. These changes do not replace the remaining
physical suspend/resume, network-share, zero-window tray notification, hardware
rendering, and packaged macOS/Windows UI gates.
