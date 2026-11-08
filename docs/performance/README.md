# Reproducible performance checks

Run from the repository root with Node 22 or newer:

```sh
npm run perf:core
# Small, quick run; full run defaults to 100/1,000/10,000 notes and 3 rounds
PERF_COUNTS=100 PERF_ROUNDS=1 npm run perf:core
npm run perf:core -- --fixtures .perf/fixtures
npx playwright install chromium
npm run perf:browser
# Use an installed browser if necessary:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run perf:browser
```

Generated files are ignored under `.perf/`. Fixtures contain deterministic notes,
links, tasks, SVG assets and 100 KB / 1 MB / 5 MB long documents; no user data,
credentials or model download is needed. The long document sizes are approximate
UTF-8 byte budgets. `PERF_DOCUMENT_BYTES=100000,1000000,5000000` enables all long
files in the browser run; the quick default is 100 KB. Windows PowerShell uses
`$env:PERF_COUNTS="100"` to set environment variables.

`core.json` records commit/runtime, raw durations, heap samples and file-read
counts for the full index and 384-dimensional vector retrieval. Heap samples
are process measurements, not peak memory or native-app memory. Inputs and
round counts must match when comparing commits; use at least five runs on the
same machine, retain raw samples and compare medians/p95. Timing is informational,
not a flaky shared-runner CI gate. Gate deterministic work counts and correctness
with unit tests. Investigate reproducible regressions above 10% before merging.

`browser.json` records startup to the folder choice, document open, edit-to-reading
and settings writes, plus screenshots. It starts an isolated Vite server on 4175
and uses a writable in-memory File System Access fixture. Cold/warm means a fresh
page in the same browser context, not a cold/warm model or OS filesystem cache.
Browser and SSR results must not be presented as native macOS/Windows measurements.

## Packaged desktop checklist

Record commit, OS/version, CPU, memory, architecture, app build type and WebView
version. Generate the disk fixtures above and repeat on macOS and Windows using
the same release build, fixtures and window size. Do not use real user vaults.

1. Measure cold launch, restored launch, first note open, reading/edit/source
   transitions and typing/scrolling for all three document sizes.
2. Repeat with model disabled, downloaded model cached/index absent, and model
   plus indexes cached. Measure model download separately, never as index time.
3. Record full/incremental index time, retrieval latency, idle/background CPU,
   application memory and multiple-window behavior. Check external rename,
   delete, disk edits, save failure, IME, focus and undo after mode switches.
4. Capture traces for stalls and note the actual renderer/runtime. Preserve
   scroll, selection and pending writes; confirm generated disk content matches
   the edited text. Record unavailable platform checks explicitly.

Existing mocked performance tests verify bounded work and state preservation;
they are not substitutes for these desktop measurements.

The checked-in `baseline-*-linux.json` files are one initial smoke measurement
against `a1bfeb0`, using 100 notes and the quick browser document. They demonstrate
reproducibility and work counts, not a statistical performance claim. They contain
no vault content or local paths. Repeat the same sizes/rounds for comparisons.

Native filesystem observation has a separate [benchmark and rollout guide](native-watch.md).
Run `npm run perf:native` for actual OS events without a WebView; this does not
replace packaged desktop UI validation.

The [vault/window optimization notes](linux-vault-optimization.md) describe the
index, rendering, background I/O and search bounds, with the core comparison and
the protocol for comparing fresh Linux desktop processes.
