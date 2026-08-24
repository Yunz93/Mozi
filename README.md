# 墨知

英文名：**Mozi**。

[English](./README.en.md) · [开发文档](./docs/DEVELOPMENT.md)

本地优先的 Markdown 编辑器，面向知识库写作：编辑与预览一致、Wiki 与附件链路顺手，桌面端基于 Tauri。

> 目标：比 Typora 更顺手、比 Obsidian 更轻量的纯 Markdown 写作体验。

![墨知-1776329034274](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M%20%E8%A8%98-1776170252301.png)

## 下载安装

在 [GitHub Releases](https://github.com/Yunz93/Mozi/releases) 获取当前平台的安装包。

### macOS

**推荐：一键安装**（自动下载、移除隔离标记并安装到「应用程序」）

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/Mozi/main/scripts/install-macos.sh | bash
```

指定版本（可选）：

```bash
RELEASE_TAG=v0.9.2 curl -fsSL https://raw.githubusercontent.com/Yunz93/Mozi/main/scripts/install-macos.sh | bash
```

已配置 Apple 开发者证书与公证凭据的 Release 通常也可直接拖入「应用程序」打开。若系统仍提示无法验证开发者，将 `墨知.app` 放入「应用程序」后执行：

```bash
xattr -cr /Applications/墨知.app
```

若仍在「下载」中，把路径换成 `~/Downloads/墨知.app`。

证书与公证配置见 [开发文档 - macOS 签名公证](./docs/DEVELOPMENT.md#macos-签名与公证)。

### Windows

运行 `.exe` 安装。SmartScreen 提示时选「更多信息」→「仍要运行」。安装后可在 **设置 → 关于** 检查 GitHub Release 更新。

## 功能亮点

- **本地知识库**：以文件夹为仓库；多标签、侧边栏、文件树与搜索管理笔记与附件，数据始终留在本机普通文件中。
- **实时预览 / 阅读**：两种主视图切换。Live 在编辑时即时渲染标题、强调、链接、表格、任务列表、公式、Mermaid、Callout、嵌入等；Reading 专注阅读，与 Live 共享 Markdown 样式预设与排版。
- **知识库式 Markdown**：兼容双链 `[[wiki]]`、`![[嵌入]]`、YAML frontmatter 与可配置新建模板；图片粘贴、本地资源目录与未引用附件清理在同一条引用链路里。
- **Excalidraw 画板**：打开与编辑 `.excalidraw`，兼容 Obsidian Excalidraw 插件的 `.excalidraw.md`（含默认 `compressed-json`）；支持侧边栏新建；笔记中可用 `![[drawing.excalidraw]]` / `![[drawing.excalidraw.md]]` 嵌入静态预览，点击进入编辑。
- **富媒体预览**：图片、PDF、HTML、视频等附件可在阅读侧预览；HTML 支持适应宽度与缩放。
- **知识层（Beta）**：反向链接与出链面板、当前笔记邻域图、相关笔记推荐（本地语义检索）、**小知助手**知识库问答（带来源引用）；内置本地 embedding，可开启隐私模式禁止非本地端点。
- **导出与发布**：PDF、HTML，以及将整篇预览合成为一张长图；工具栏可发布到 **simple-blog**（GitHub + Vercel）或 **微信公众号草稿**。
- **可选 AI 辅助**：在 Gemini 与 OpenAI 兼容接口之间切换，用于润色、摘要、标签与从选区生成词条等；无 API Key 时基础写作完整可用。
- **外观与桌面体验**：浅色 / 深色主题、多种 Markdown 样式预设、字体与字号、中英界面、可自定义快捷键；Windows 支持应用内检查更新。

## 常用快捷键

默认键位；完整列表见 **Settings → Shortcuts**。

| 快捷键                                  | 动作                                         |
| --------------------------------------- | -------------------------------------------- |
| `Cmd/Ctrl + S`                          | 保存                                         |
| `Cmd/Ctrl + 0`                          | 设置                                         |
| `Cmd/Ctrl + 1` ~ `5`                    | 侧边栏 / Outline / 视图模式 / 主题 / AI 增强 |
| `Cmd + Shift + F`                       | 当前文件搜索                                 |
| `Cmd + Shift + S`                       | 侧边栏搜索                                   |
| `Cmd + Shift + K` / `L`                 | 打开知识库 / 定位当前文件                    |
| `Cmd + Shift + H`                       | 导出 PDF                                     |
| `Cmd/Ctrl + N` / `Cmd/Ctrl + Shift + N` | 新建笔记 / 文件夹                            |
| `Cmd/Ctrl + Shift + Alt + N`            | 新建窗口（桌面端）                           |
| `Cmd/Ctrl + W`                          | 关闭标签                                     |
| `Cmd/Ctrl + +` / `Cmd/Ctrl + -`         | 放大 / 缩小界面文字                          |
| `Cmd/Ctrl + Shift + 0`                  | 重置界面文字大小                             |
| `Cmd/Ctrl + Shift + -`                  | 清理未引用附件                               |
| `Escape`                                | 关闭搜索面板、弹窗或菜单                     |

## 发布到 simple-blog

在 **Settings → Publishing** 填写：

- **Blog Repository URL**（`https://github.com/owner/repo`、`git@github.com:...` 或 `owner/repo`）
- **博客公开地址**（用于回写 frontmatter 中的 `link`，如 `https://你的域名` 或 `xxx.vercel.app`）
- **GitHub Token**：Fine-grained PAT，对目标仓库开启 **Contents: Read and write**

发布后应用会保存当前笔记、写入 `is_publish: true`，同步 `posts/` 与图片到仓库、改写图片为 raw 链接，并由 GitHub 推送触发 Vercel。

常用 frontmatter：`title`、`aliases`、`slug`、`link`（发布后回填）、`status`（写作状态，不参与是否发布）、`is_publish`。未填 `title` / `aliases` / `slug` 时可用文件名或标题推导；仓库内文件名不因 `slug` 改变。

## 发布到微信公众号草稿

同一设置页配置 **AppID**、**AppSecret**（仅本机安全存储）。工具栏选择微信公众号渠道：填写标题/作者/摘要/原文链接，封面发布时选择；正文本地图片会上传。首次发布会写入 `wechat_draft_media_id`，再次发布同一篇则更新原草稿。当前为单账号、单图文草稿；若使用服务器域名调用接口，需将出口 IP 加入微信公众平台白名单。

## 许可证

[Apache License 2.0](./LICENSE)

## 致谢

墨知 建立在大量优秀开源项目之上（排名不分先后）。下列为产品运行时直接依赖的主要组件；完整版本与传递依赖见仓库中的 `package.json` / `package-lock.json` 与 `src-tauri/Cargo.toml` / `Cargo.lock`。

### 桌面与界面

| 项目                                                                                    | 用途                           | 许可              |
| --------------------------------------------------------------------------------------- | ------------------------------ | ----------------- |
| [Tauri](https://tauri.app/)（含 API 与 dialog / fs / process / shell / updater 等插件） | 桌面壳、文件系统、对话框、更新 | Apache-2.0 OR MIT |
| [React](https://react.dev/)                                                             | UI                             | MIT               |
| [Zustand](https://github.com/pmndrs/zustand)                                            | 应用状态                       | MIT               |
| [Vite](https://vitejs.dev/)                                                             | 前端构建                       | MIT               |
| [Tailwind CSS](https://tailwindcss.com/)                                                | 样式                           | MIT               |
| [Lucide](https://lucide.dev/)（`lucide-react`）                                         | 图标                           | ISC               |

### 编辑器

| 项目                                                                                   | 用途                            | 许可 |
| -------------------------------------------------------------------------------------- | ------------------------------- | ---- |
| [CodeMirror 6](https://codemirror.net/)（`@codemirror/*`，含 Markdown / 多种代码语言） | Live 编辑、语法高亮、选区与装饰 | MIT  |
| [Lezer Highlight](https://github.com/lezer-parser/highlight)                           | 语法高亮标签                    | MIT  |
| [@replit/codemirror-lang-csharp](https://github.com/replit/codemirror-lang-csharp)     | C# 语言支持                     | MIT  |

### Markdown、预览与画板

| 项目                                                                        | 用途                   | 许可                  |
| --------------------------------------------------------------------------- | ---------------------- | --------------------- |
| [markdown-it](https://github.com/markdown-it/markdown-it)                   | Markdown 解析          | MIT                   |
| [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) | 脚注                   | MIT                   |
| [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists)   | 任务列表               | ISC                   |
| [GitHub Markdown CSS](https://github.com/sindresorhus/github-markdown-css)  | 预览基础样式           | MIT                   |
| [Shiki](https://shiki.style/)                                               | 代码高亮               | MIT                   |
| [KaTeX](https://katex.org/)                                                 | 数学公式               | MIT                   |
| [Mermaid](https://mermaid.js.org/)                                          | 流程图等图表           | MIT                   |
| [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)          | Mermaid 渲染辅助       | MIT                   |
| [DOMPurify](https://github.com/cure53/DOMPurify)                            | HTML 消毒              | MPL-2.0 OR Apache-2.0 |
| [Excalidraw](https://excalidraw.com/)（`@excalidraw/excalidraw`）           | 手绘白板编辑与嵌入预览 | MIT                   |
| [lz-string](https://github.com/pieroxy/lz-string)                           | Obsidian 图纸压缩格式  | MIT                   |
| [Turndown](https://github.com/mixmark-io/turndown)                          | HTML → Markdown        | MIT                   |
| [js-yaml](https://github.com/nodeca/js-yaml)                                | YAML frontmatter       | MIT                   |

### 导出、PDF 与文档渲染

| 项目                                                        | 用途       | 许可       |
| ----------------------------------------------------------- | ---------- | ---------- |
| [PDF.js](https://mozilla.github.io/pdf.js/)（`pdfjs-dist`） | PDF 预览   | Apache-2.0 |
| [html2canvas](https://html2canvas.hertzen.com/)             | 预览光栅化 | MIT        |
| [html2pdf.js](https://ekoopmans.github.io/html2pdf.js/)     | HTML → PDF | MIT        |
| [jsPDF](https://github.com/parallax/jsPDF)                  | PDF 生成   | MIT        |

### 知识检索与可选 AI

| 项目 / 服务                                                                                                | 用途                            | 许可 / 说明    |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------- |
| [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js)（`@huggingface/transformers`） | 内置本地 embedding              | Apache-2.0     |
| [Google Gen AI SDK](https://github.com/googleapis/js-genai)（`@google/genai`）                             | 可选 Gemini 调用                | Apache-2.0     |
| [Google Gemini](https://ai.google.dev/) / [OpenAI](https://openai.com/) 兼容接口                           | 可选云端或本地（如 Ollama）模型 | 第三方服务条款 |

Rust 侧还依赖 [serde](https://serde.rs/)、[reqwest](https://github.com/seanmonstar/reqwest)、[uuid](https://github.com/uuid-rs/uuid) 以及加密封装相关 crate（如 `chacha20poly1305`、`hmac`、`sha2` 等），用于配置安全存储与网络请求等桌面能力。

若发现致谢遗漏，欢迎提交 Issue 或 PR 补充。
