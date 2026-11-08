# Project documentation

- [Development](development/README.en.md) / [开发指南](development/README.md)
- [Performance measurements and platform checklist](performance/README.md)
- [Product requirements](product/PRD.md), [roadmap](product/ROADMAP.md),
  [implementation notes](product/IMPLEMENTATION_PLAN.md), [table proposal](product/TABLE_EDITING_PROPOSAL.md)
- [Release smoke checks](release/SMOKE_TEST.md), [updater delivery](release/UPDATER.md)

## Directory responsibilities

- `src/app`: application lifecycle and workspace orchestration.
- `src/components`: product UI grouped by feature; component-specific hooks,
  rendering and behavior belong under that feature.
- `src/hooks`: React adapters for shared application workflows.
- `src/services`: filesystem, AI and vault operations without UI ownership.
- `src/store`: runtime state, persistence and migrations.
- `src/utils`: reusable domain/text/platform helpers, not unused UI implementations.
- `src/types`: shared contracts; `src/testUtils`: test-only support code.
- Tests stay next to the implementation they exercise. Fixtures live in
  `src/**/__fixtures__` or `docs/fixtures`; remove obsolete tests with retired
  implementations and keep equivalent coverage on the active feature.
- `src-tauri/src`: native capabilities and backend services, grouped by domain.
- `scripts/perf`: reproducible performance tooling. Existing release scripts retain
  their stable paths because workflows and public install commands depend on them.
- `docs/product`, `docs/development`, `docs/release`, `docs/performance`: public
  documentation; `docs/assets`: reviewed documentation images.

Keep secrets, local environment files, generated reports, traces and personal
filesystem paths out of tracked files. Use synthetic examples in fixtures.
Preserve license notices and project attribution. Do not imply external
certification or review that has not actually occurred.
