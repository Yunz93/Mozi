# M記 Development Guide

[中文](./DEVELOPMENT.md) · [Back to README](../README.en.md)

## Tech Stack

- Desktop framework: [Tauri 2](https://tauri.app/)
- Frontend: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- Build tool: [Vite](https://vitejs.dev/)
- State management: [Zustand](https://zustand-demo.pmnd.rs/)
- Markdown rendering: [markdown-it](https://github.com/markdown-it/markdown-it)
- Syntax highlighting: [Shiki](https://shiki.style/)
- Math rendering: [KaTeX](https://katex.org/)
- Diagrams: [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) (common Mermaid syntax) + [Mermaid](https://mermaid.js.org/) (fallback for other types)
- Drawings: [Excalidraw](https://excalidraw.com/) (`.excalidraw` editing and in-note embed preview)
- AI: [Google Gemini API](https://ai.google.dev/) / [OpenAI API](https://platform.openai.com/)

## Requirements

This project currently supports macOS and Windows. Linux build/file-operation support has been removed for now.

### Common

- Node.js 18+
- Rust 1.77+
- npm 9+

### Platform Dependencies

#### macOS

```bash
xcode-select --install
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Yunz93/markdown-press.git
cd markdown-press
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure AI (optional)

You can enter the Gemini or OpenAI API key in the app settings, or provide it locally:

```env
GEMINI_API_KEY=your_api_key_here
```

OpenAI-compatible APIs are also supported; configure the base URL and key in settings.

### 4. Run in development mode

```bash
npm run tauri:dev
```

## Build

### Web build

```bash
npm run build
```

### Desktop build

```bash
npm run tauri:build
```

Artifacts are generated under `src-tauri/target/release/bundle/`.

### GitHub Tag Auto Build

The repository is configured with a GitHub Actions release workflow. Push a `v`-prefixed tag to automatically build and upload macOS / Windows installers.

```bash
git tag v0.1.1
git push origin v0.1.1
```

CI automatically syncs the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to the tag, then runs the Tauri build and uploads to GitHub Releases.

macOS users should prefer the one-line installer `scripts/install-macos.sh`, which downloads the release, runs `xattr -cr`, and copies the app into `/Applications`.

### macOS signing & notarization

Apps downloaded from the browser must be **Developer ID signed and notarized** to pass Gatekeeper. Otherwise macOS shows “cannot verify developer” or “damaged” warnings.

The release workflow signs and notarizes automatically when the GitHub Secrets below are configured. Without them it falls back to ad-hoc signing and users must run `xattr -cr` or use the one-line installer.

Configure these in **Settings → Secrets and variables → Actions**:

| Secret                       | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `APPLE_CERTIFICATE`          | Base64-encoded Developer ID Application `.p12` export  |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`                |
| `KEYCHAIN_PASSWORD`          | Temporary CI keychain password                         |
| `APPLE_ID`                   | Apple ID email (use with password auth below)          |
| `APPLE_PASSWORD`             | App-specific password                                  |
| `APPLE_TEAM_ID`              | Apple Developer Team ID                                |
| `APPLE_API_KEY`              | App Store Connect API Key ID (recommended alternative) |
| `APPLE_API_ISSUER`           | App Store Connect Issuer ID                            |
| `APPLE_API_KEY_CONTENT`      | Full `.p8` private key text                            |

See the [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) for certificate export and notarization details.

## Release Smoke Test

The project includes a release smoke-test script:

```bash
npm run smoke:release
```

See [RELEASE_SMOKE_TEST.md](./RELEASE_SMOKE_TEST.md) for the manual checklist.

## Development Notes

- Dark mode is the default theme
- `.trash` is an internal application directory and should not be edited manually
- The preview pipeline supports wiki links, heading jumps, block references, and attachment resolution
- Mermaid diagrams prefer beautiful-mermaid (flowchart, state, sequence, class, ER, xychart-beta); pie, gantt, and other types fall back to official Mermaid
- Settings allow separate UI, editor, preview, and code font configuration
- The default font is the system font, with 仓耳今楷 available as a bundled Chinese font option
- External file change watch: if a file is modified outside the app with no unsaved edits, it reloads automatically

## Tests and quality gates

```bash
npm test                     # full unit suite
npm run test:coverage        # coverage floor (CI hard gate; see vitest thresholds)
npm run test:retrieval-eval  # knowledge-layer keyword retrieval eval set
```

Retrieval fixtures live under `docs/fixtures/retrieval-eval/`:

- `vault/` — small sample knowledge base (aligned with `src-tauri/resources/sample-notes`)
- `queries.json` — query → expected note path; `minHitRate` is the pass line

Prefer adding queries when extending the set; do not bend product logic just to hit the rate.

## Contributing

Issues and pull requests are welcome. Before submitting changes, run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:retrieval-eval
npm run build
npm run smoke:release
```
