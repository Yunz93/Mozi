# M記

[中文](./README.md) · [Development guide](./docs/DEVELOPMENT.en.md)

A local-first Markdown editor for knowledge-base writing: tight editor–preview parity, smooth wiki and attachment workflows, desktop builds on Tauri.

> Goal: a focused Markdown writing flow—lighter than Obsidian, smoother day-to-day than Typora for many writers.

![M記 preview](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M%20%E8%A8%98-1776170252301.png)

## Download

Grab the installer for your platform from [GitHub Releases](https://github.com/Yunz93/markdown-press/releases).

### macOS

**Recommended: one-line install** (downloads, clears quarantine, and copies to Applications):

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/markdown-press/main/scripts/install-macos.sh | bash
```

Pin a release (optional):

```bash
RELEASE_TAG=v0.9.16 curl -fsSL https://raw.githubusercontent.com/Yunz93/markdown-press/main/scripts/install-macos.sh | bash
```

Signed and notarized GitHub Releases should also open normally after you drag **M記.app** into Applications. If Gatekeeper still blocks the app, run:

```bash
xattr -cr /Applications/M記.app
```

If it is still in Downloads, use `~/Downloads/M記.app` instead.

See [Development guide — macOS signing & notarization](./docs/DEVELOPMENT.en.md#macos-signing--notarization) for the CI secret setup.

### Windows

Run the `.exe` installer. If SmartScreen appears, choose **More info** → **Run anyway**. After install, **Settings → About** can check for newer GitHub Release builds.

## Highlights

- **Local vault**: Folder-based library with tabs, sidebar, and search; notes and assets stay on disk under your control.
- **Source / Split / Reading**: Three view modes; preview renders Markdown plus common extensions (math, diagrams, highlighted code); outline for structure at a glance.
- **Knowledge-base Markdown**: Familiar wiki links and `![[embeds]]`, configurable YAML metadata and templates, images handled in the same reference flow.
- **Knowledge layer (Beta)**: Backlinks and outgoing links panel, related-notes recommendations (local semantic search), Ask Vault Q&A with source citations; built-in local embedding with an optional privacy mode that blocks non-local endpoints.
- **Export & publish**: PDF, HTML, and a single long-image share from the preview; toolbar publishing to **simple-blog** (GitHub + Vercel) or **WeChat Official Account drafts**.
- **Optional AI assist**: Switch between Gemini and an OpenAI-compatible API for polish, summaries, tags, and generating entries from a selection.

## Keyboard shortcuts

Defaults below; the full list lives in **Settings → Shortcuts**.

| Shortcut                                | Action                                             |
| --------------------------------------- | -------------------------------------------------- |
| `Cmd/Ctrl + S`                          | Save                                               |
| `Cmd/Ctrl + 0`                          | Settings                                           |
| `Cmd/Ctrl + 1` ~ `5`                    | Sidebar / outline / view mode / theme / AI enhance |
| `Cmd + Shift + F`                       | In-file search                                     |
| `Cmd + Shift + S`                       | Sidebar search                                     |
| `Cmd + Shift + K` / `L`                 | Open vault / locate current file                   |
| `Cmd + Shift + H`                       | Export PDF                                         |
| `Cmd/Ctrl + N` / `Cmd/Ctrl + Shift + N` | New note / new folder                              |
| `Cmd/Ctrl + W`                          | Close tab                                          |
| `Cmd/Ctrl + +` / `Cmd/Ctrl + -`         | Zoom UI text in / out                              |
| `Cmd/Ctrl + Shift + 0`                  | Reset UI text size                                 |
| `Cmd/Ctrl + Shift + -`                  | Clean unused attachments                           |
| `Escape`                                | Close search panel, dialog, or menu                |

## Publish to simple-blog

In **Settings → Publishing**, set:

- **Blog repository URL** (`https://github.com/owner/repo`, `git@github.com:owner/repo.git`, or `owner/repo`)
- **Public blog site URL** (used to write back `link` in frontmatter, e.g. `https://your-domain` or `your-app.vercel.app`)
- **GitHub token**: Fine-grained PAT with **Contents: Read and write** on the target repo

On publish, the app saves the note, sets `is_publish: true`, syncs `posts/` and images, rewrites image links to raw URLs, and pushes so Vercel redeploys.

Common frontmatter: `title`, `aliases`, `slug`, `link` (filled after publish), `status` (editorial only, not publish gate), `is_publish`. Empty `title` / `aliases` / `slug` can fall back to file name or title; the repo file name does not change when you edit `slug`.

## Publish to WeChat drafts

Same settings tab: **App ID** and **App Secret** (App Secret stays in secure local storage only). From the toolbar, pick the WeChat channel: confirm title, author, digest, and source URL; pick the cover at publish time; local images in the body upload automatically. First publish stores `wechat_draft_media_id`; republishing updates that draft. One account and single-article drafts for now; server-side calls may require allowlisting the outbound IP on the WeChat platform.

## License

[MIT License](./LICENSE)

## Acknowledgements

M記 is built on the following open-source projects and services (in no particular order):

**Desktop & UI**

- [Tauri](https://tauri.app/) · [React](https://react.dev/) · [Zustand](https://github.com/pmndrs/zustand) · [Vite](https://vitejs.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Lucide](https://lucide.dev/)

**Editor**

- [CodeMirror](https://codemirror.net/)

**Markdown & preview**

- [markdown-it](https://github.com/markdown-it/markdown-it) · [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) · [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) · [GitHub Markdown CSS](https://github.com/sindresorhus/github-markdown-css) · [Shiki](https://shiki.style/) · [KaTeX](https://katex.org/) · [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) · [Mermaid](https://mermaid.js.org/) · [DOMPurify](https://github.com/cure53/DOMPurify)

**Export & PDF**

- [PDF.js](https://mozilla.github.io/pdf.js/) · [html2canvas](https://html2canvas.hertzen.com/) · [html2pdf.js](https://ekoopmans.github.io/html2pdf.js/) · [jsPDF](https://github.com/parallax/jsPDF)

**Other**

- [js-yaml](https://github.com/nodeca/js-yaml)

**AI services (optional)**

- [Google Gemini](https://ai.google.dev/) · [OpenAI](https://openai.com/)
