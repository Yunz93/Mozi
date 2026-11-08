# 墨知 开发文档

[English](README.en.md) · [返回主页](../../README.md)

## 技术栈

- 桌面框架: [Tauri 2](https://tauri.app/)
- 前端: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- 构建工具: [Vite](https://vitejs.dev/)
- 状态管理: [Zustand](https://zustand-demo.pmnd.rs/)
- Markdown 渲染: [markdown-it](https://github.com/markdown-it/markdown-it)
- 代码高亮: [Shiki](https://shiki.style/)
- 数学公式: [KaTeX](https://katex.org/)
- 图表: [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)（Mermaid 语法，常见类型）+ [Mermaid](https://mermaid.js.org/)（其余类型回退）
- 画板: [Excalidraw](https://excalidraw.com/)（`.excalidraw` 与 Obsidian `.excalidraw.md` 编辑、笔记内嵌预览；Obsidian 默认 `compressed-json` 使用 LZ-String；字体经 Vite 插件自托管到 `public/fonts`，`EXCALIDRAW_ASSET_PATH=/`）
- AI: [Google Gemini API](https://ai.google.dev/) / [OpenAI API](https://platform.openai.com/)

## 环境要求

发布包支持 macOS 和 Windows；Linux 的 Debian 构建与桌面回归由 CI 验证。
跨平台驱动、25 项交互用例和云端虚拟机验收见[桌面验收方案](../testing/desktop-acceptance.md)。

### 通用要求

- Node.js 22（与 CI 一致）
- Rust stable
- npm 9+

### 平台依赖

#### macOS

```bash
xcode-select --install
```

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/Yunz93/Mozi.git
cd Mozi
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 AI（可选）

可在应用设置页填写 Gemini 或 OpenAI API Key，或在本地准备环境变量：

```env
GEMINI_API_KEY=your_api_key_here
```

也支持 OpenAI 兼容 API，可在设置页配置 Base URL 和 Key。

### 4. 启动开发模式

```bash
npm run tauri:dev
```

## 构建

### Web 构建

```bash
npm run build
```

### 桌面应用构建

```bash
npm run tauri:build
```

构建产物默认位于 `src-tauri/target/release/bundle/`。

### GitHub Tag 自动构建

仓库已配置 GitHub Actions 发布流程，推送 `v` 前缀标签后会自动构建并上传 macOS / Windows 安装包。

```bash
git tag v0.1.1
git push origin v0.1.1
```

CI 会自动将 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本号同步为当前 tag 对应版本，再执行 Tauri 打包和 GitHub Release 上传。

macOS 发布固定使用 `macos-15` Arm64 runner。若 macOS 任务一直未分配 runner，可在原任务停止后，手动触发 Release 工作流并指定 `release_tag`（如 `v2.0.1`）。手动补包只构建该既有标签的 macOS 文件，跳过 Windows；检出、版本同步和上传使用同一标签，不移动标签。完成后需重新下载并核对两端文件及 `latest.json`，避免把只有部分平台文件的 Release 当作发布完成。

手动补包默认仍使用托管 runner。只有得到本机所有者明确授权后，才可选择 `build_runner=local-once`，注册带 `mozi-release-once` 标签的 macOS Arm64 一次性 runner；执行一次任务后应确认其已注销。本机模式跳过 Rust 缓存上传，使用独立的 runner 工作目录；不得复用托管 runner 标签或在原项目检出目录执行 CI。

本机模式也禁用 npm 缓存上传，并应设置独立的 npm 缓存及临时目录。该模式仅支持 Apple ad-hoc 签名与应用更新签名；若已配置 Apple 证书或公证私钥，会在签名准备前停止，需改用托管 runner，防止改变本机钥匙串或落地 Apple 私钥。任务结束后核对 runner 注销，清空本次临时凭据内容；不触碰原有证书和用户缓存。

macOS 用户推荐使用一键安装脚本 `scripts/install-macos.sh`（自动下载 Release、执行 `xattr -cr` 并安装到 `/Applications`）。桌面应用设置页的「检查更新」在 macOS 上走同一套安装脚本，并显示下载进度。

### macOS 签名与公证

macOS 从浏览器下载的应用必须通过 **Developer ID 签名 + Apple 公证（notarization）** 才能通过 Gatekeeper，否则会出现「无法验证开发者」或「已损坏」提示。

Release 工作流会在 GitHub Secrets 齐全时自动完成签名与公证；未配置证书时回退到 ad-hoc 签名（需用户执行 `xattr -cr` 或使用一键安装脚本）。

在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret                       | 说明                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | 从 Keychain 导出的 Developer ID Application `.p12` 经 base64 编码 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 导出密码                                                   |
| `KEYCHAIN_PASSWORD`          | CI 临时钥匙串密码（任意强密码）                                   |
| `APPLE_ID`                   | Apple ID 邮箱（与下方二选一）                                     |
| `APPLE_PASSWORD`             | App 专用密码                                                      |
| `APPLE_TEAM_ID`              | Apple Developer Team ID                                           |
| `APPLE_API_KEY`              | App Store Connect API Key ID（推荐，与上方二选一）                |
| `APPLE_API_ISSUER`           | App Store Connect Issuer ID                                       |
| `APPLE_API_KEY_CONTENT`      | 下载的 `.p8` 私钥全文                                             |

证书导出与公证流程参考 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/)。

## Release 校验

项目已提供 release 冒烟检查脚本：

```bash
npm run smoke:release
```

配套检查清单见 [RELEASE_SMOKE_TEST.md](../release/SMOKE_TEST.md)。

## 开发说明

- 默认主题为暗色模式
- `.trash` 为应用内部回收站目录，不应手动编辑
- 预览层支持 wiki link、heading link、block ref 与附件解析
- Mermaid 图表优先由 beautiful-mermaid 渲染（flowchart、state、sequence、class、ER、xychart-beta）；pie、gantt 等其余类型回退到官方 Mermaid
- 设置页支持分别配置界面字体、编辑字体、预览字体和代码字体
- 默认字体为系统字体，内置中文字体提供仓耳今楷选项
- 支持外部文件变更监听，如果文件在外部被修改且无未保存编辑，会自动重新加载

## 编辑与预览性能约束

- 基础代码块与列表装饰按带缓冲的视口范围计算，后台语法推进不能反复扫描整篇文档。
- 单栏编辑、阅读切换保持窗格宽度稳定；隐藏编辑器保留最近的编辑配置，真正切换源码开关时才重配。
- 保留预览仅缓存当前文档，内容、主题、高亮器或排版选项变化时必须更新；重复激活不重写相同标题属性，也不清空已就绪图表。
- 调整侧栏宽度时采用紧凑正文预算，只为实际显示的大纲预留空间；窗口缩小不覆盖用户保存的宽度偏好。
- 滚动性能验证必须加载主程序完整样式，并确认容器高度、可见高度和实际滚动距离，使用同一 Tauri 运行时复测。

## 测试与质量门禁

```bash
npm test                 # 全量单测
npm run test:coverage    # 覆盖率（CI 硬门禁，见 vitest thresholds）
npm run test:retrieval-eval  # 知识层关键词检索评测集
```

检索评测夹具位于 `docs/fixtures/retrieval-eval/`：

- `vault/`：小型示例知识库（与 `src-tauri/resources/sample-notes` 对齐）
- `queries.json`：query → 期望笔记 path；`minHitRate` 控制通过线

扩展评测时优先补 query，避免改产品逻辑去「凑」命中率。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前建议至少执行：

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:retrieval-eval
npm run build
npm run smoke:release
```
