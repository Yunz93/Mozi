# M記

[English](./README.en.md) · [开发文档](./docs/DEVELOPMENT.md)

本地优先的 Markdown 编辑器，面向知识库写作：编辑与预览一致、Wiki 与附件链路顺手，桌面端基于 Tauri。

> 目标：比 Typora 更顺手、比 Obsidian 更轻量的纯 Markdown 写作体验。

![M 記-1776329034274](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M%20%E8%A8%98-1776170252301.png)

## 下载安装

在 [GitHub Releases](https://github.com/Yunz93/markdown-press/releases) 获取当前平台的安装包。

### macOS

**推荐：一键安装**（自动下载、移除隔离标记并安装到「应用程序」）

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/markdown-press/main/scripts/install-macos.sh | bash
```

指定版本（可选）：

```bash
RELEASE_TAG=v0.9.16 curl -fsSL https://raw.githubusercontent.com/Yunz93/markdown-press/main/scripts/install-macos.sh | bash
```

已配置 Apple 开发者证书与公证凭据的 Release 通常也可直接拖入「应用程序」打开。若系统仍提示无法验证开发者，将 `M記.app` 放入「应用程序」后执行：

```bash
xattr -cr /Applications/M記.app
```

若仍在「下载」中，把路径换成 `~/Downloads/M記.app`。

证书与公证配置见 [开发文档 - macOS 签名公证](./docs/DEVELOPMENT.md#macos-签名与公证)。

### Windows

运行 `.exe` 安装。SmartScreen 提示时选「更多信息」→「仍要运行」。安装后可在 **设置 → 关于** 检查 GitHub Release 更新。

## 功能亮点

- **本地知识库**：以文件夹为仓库，多标签、侧边栏与搜索管理笔记与附件，数据留在本机。
- **源码 / 分屏 / 阅读**：三种视图模式切换；预览侧完整呈现 Markdown 与常见扩展（公式、图表、代码高亮等），Outline 把握长文结构。
- **Excalidraw 画板**：打开与编辑 `.excalidraw` 文件，支持侧边栏新建画板；笔记中可通过 `![[drawing.excalidraw]]` 嵌入静态预览，点击即可进入编辑。
- **知识库式 Markdown**：兼容常用的双链、`![[嵌入]]` 等写法，YAML 元信息与新建模板可配置，图片与资源在同一条引用链路里管理。
- **知识层（Beta）**：反向链接与出链面板、相关笔记推荐（本地语义检索）、Ask Vault 库级问答（带来源引用）；内置本地 embedding，可开启隐私模式禁止非本地端点。
- **导出与发布**：PDF、HTML，以及将整篇预览合成为一张长图便于分享；可从工具栏发布到 **simple-blog**（GitHub + Vercel）或 **微信公众号草稿**。
- **可选 AI 辅助**：在 Gemini 与 OpenAI 兼容接口之间切换，用于润色、摘要、标签与从选区生成词条等。

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

[MIT License](./LICENSE)

## 致谢

M記 建立在以下开源项目与服务之上（排名不分先后）：

**桌面与界面**

- [Tauri](https://tauri.app/) · [React](https://react.dev/) · [Zustand](https://github.com/pmndrs/zustand) · [Vite](https://vitejs.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Lucide](https://lucide.dev/)

**编辑器**

- [CodeMirror](https://codemirror.net/)

**Markdown 与预览**

- [markdown-it](https://github.com/markdown-it/markdown-it) · [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) · [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) · [GitHub Markdown CSS](https://github.com/sindresorhus/github-markdown-css) · [Shiki](https://shiki.style/) · [KaTeX](https://katex.org/) · [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) · [Mermaid](https://mermaid.js.org/) · [DOMPurify](https://github.com/cure53/DOMPurify)

**导出与 PDF**

- [PDF.js](https://mozilla.github.io/pdf.js/) · [html2canvas](https://html2canvas.hertzen.com/) · [html2pdf.js](https://ekoopmans.github.io/html2pdf.js/) · [jsPDF](https://github.com/parallax/jsPDF)

**其他**

- [js-yaml](https://github.com/nodeca/js-yaml)

**AI 服务（可选）**

- [Google Gemini](https://ai.google.dev/) · [OpenAI](https://openai.com/)
