# Optimization series verification

The series uses the fixture generator and measurement commands in [README](README.md).
All measurements below are Linux Node/Chromium smoke checks, not packaged desktop
claims. No macOS or Windows UI measurements have been collected in this environment.

## Deterministic changes

| Scenario                                                    |                                     Before |            After |
| ----------------------------------------------------------- | -----------------------------------------: | ---------------: |
| Settings writes during the browser edit-to-reading scenario |                                          4 |                0 |
| Full link + chunk index, 100 notes                          |                                  200 reads |        100 reads |
| Full link + chunk index, 1,000 notes                        |                                2,000 reads |      1,000 reads |
| Float32 conversion during 20 repeated vector queries        | one conversion per stored vector per query | zero conversions |

Reference/full-builder equivalence tests retain link resolution, semantic exclusion
rules, Markdown-wrapped drawing treatment, per-file failures and cancellation.
Incremental lifecycle tests retain per-vault queue ordering and save-event coalescing.
Vector tests compare exact scores/order with the previous stable full-sort algorithm,
including ties, ragged dimensions, zero vectors, unusual K values, rename/removal and
legacy non-finite values. The non-finite case intentionally retains a full-sort fallback.
Runtime vectors are owned Float32 buffers; plain-array/base64 snapshot formats remain
compatible. Embedding bookkeeping uses hashes/ids without reconstructing snapshots.

## Directional timing samples

Before-vector samples were recorded against the original implementation in the
baseline run (three rounds); after samples use five rounds. Same environment,
384-dimensional generated vectors and Top-10, but concurrent machine load and warm-up
conditions were not strictly controlled. Rounded medians were approximately:

| Vectors | Before | After |
| ------- | -----: | ----: |
| 1,000   |   3 ms |  1 ms |
| 10,000  |  32 ms |  9 ms |
| 50,000  | 183 ms | 47 ms |

These samples motivate a controlled native-app comparison; they do not establish a
statistical speedup, startup improvement or memory reduction. CPU costs in wiki-link
resolution still dominate the synthetic 10,000-note full build; halving reads does
not imply halving elapsed time. Use the raw benchmark output on the same machine
and matching rounds to evaluate a particular release. Output metadata includes the
commit and whether the working tree was dirty when collected.

## Release limitations

Keep the macOS/Windows packaged checklist in README as outstanding until actually
performed. In particular, system dialogs, IME on native WebViews, file permissions,
calendar/notification integration, updates, model downloads and native multi-window
behavior are not proven by mocked tests or Chromium. This series changes no user
configuration keys, disk index schemas or Rust subsystem; ordinary code reverts do
not require a data migration. Existing map-shaped document storage remains a
compatibility boundary behind the single-session workflow contract.
