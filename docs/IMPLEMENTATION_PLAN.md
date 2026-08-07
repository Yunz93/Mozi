# M記 知识层具体实施方案

文档状态：可执行草案  
关联：[产品演进方案](./PRODUCT_ROADMAP.md) · [PRD](./PRD.md)  
基线：v0.9.12 代码结构  
更新时间：2026-07-22

本文把演进方案落成可开工的工程规格：模块、类型、钩子点、UI、测试与验收。不阻塞 1.0；从 **1.x 知识层** 起算。

---

## 0. 现状可复用资产

| 能力       | 位置                                                                       | 复用方式                                          |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Wiki 解析  | `src/utils/wikiLinks.ts`：`parseWikiLinkReference` / `resolveWikiLinkFile` | 出链解析与目标解析                                |
| Wiki 正则  | `src/utils/markdownLinkUtils.ts`：`WIKI_LINK_REGEX`                        | 全文扫链                                          |
| 重命名改写 | `src/utils/linkRewriter.ts`                                                | 路径变更时同步刷新链接索引                        |
| 标题切片   | `src/utils/outline.ts`：`parseHeadings`                                    | Chunk 按标题切分                                  |
| 关键词搜索 | `src/components/sidebar/hooks/useSidebarSearch.ts`                         | 扩展为 keyword \| semantic \| hybrid              |
| 打开库     | `src/services/filesystem/knowledgeBaseService.ts`                          | 全量重建钩子                                      |
| 目录监听   | `src/app/useKnowledgeBaseWatch.ts`                                         | 树变更增量（注意：不感知纯内容改）                |
| AI 路由    | `src/services/aiService.ts` + `deepseek`/`codex`/`gemini`                  | 扩展 Ask Vault；本地端点先走 OpenAI 兼容 Base URL |
| 确认写回   | `src/components/ai/AiResultReviewDialog.tsx`                               | Ask Vault「插入/新建」复用                        |
| 安全存储   | `sensitiveSettingKeys` + Tauri `secure_settings`                           | 新密钥同模式                                      |
| 右侧栏     | `App.tsx` Outline 挂载处                                                   | 增加 Backlinks / Related Tab                      |

**明确缺口：** 无 vault 链接索引、无 embedding、无 Ask Vault、目录 watch 不触发内容级索引更新。

---

## 1. 目标架构

```text
┌──────────────────────────────────────────────────────────┐
│ UI                                                       │
│  RightRail: Outline | Backlinks | Related                │
│  SidebarSearch: keyword | semantic | hybrid              │
│  AskVaultPanel + Toolbar 入口                            │
│  Settings: AI / Index / Privacy                          │
└───────────────┬──────────────────────────▲───────────────┘
                │                          │
┌───────────────▼──────────────────────────┴───────────────┐
│ Application hooks                                        │
│  useVaultIndexLifecycle · useAskVault · useRelatedNotes  │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│ Domain services (`src/services/vault/`)                  │
│  linkIndexService     —— 出链/入链图                     │
│  chunkService         —— 文档切片 + 元数据               │
│  embeddingProvider    —— 本地/云 embedding 抽象          │
│  vectorStore          —— 本地向量持久化                  │
│  retrieveService      —— hybrid 检索（关键词+向量）      │
│  askVaultService      —— RAG 组装 + 引用结构化           │
│  indexStorage         —— 索引目录读写 / 版本 / 重建      │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│ Existing                                                   │
│  wikiLinks · outline · aiService · filesystem · secure   │
└──────────────────────────────────────────────────────────┘
```

**索引落盘约定（二选一，推荐 A）：**

- **A（推荐）：** `{app_config_dir}/vault-index/{vaultId}/`
  - `vaultId` = vault 根路径的稳定 hash（sha256 截断）
  - 不污染用户笔记目录；与 `secure_settings` 同属应用数据区
- **B（可选设置）：** `{vault}/.markdown-press/index/`
  - 便于用户备份/迁移；默认关闭，设置中开启「索引放在知识库内」

索引损坏或版本不兼容 → 删除目录全量重建；**永不改写用户 `.md`**。

---

## 2. 目录与文件规划

```text
src/
  types/vaultIndex.ts              # 链接/切片/检索/问答类型
  utils/wikiOutbound.ts            # extractOutboundWikiLinks（新）
  utils/wikiOutbound.test.ts
  services/vault/
    indexPaths.ts                  # vaultId、目录路径
    indexStorage.ts                # 读写 manifest / 原子写
    linkIndexService.ts
    linkIndexService.test.ts
    chunkService.ts
    chunkService.test.ts
    embeddingProvider.ts           # embedTexts(texts) 抽象
    embeddingLocal.ts              # OpenAI-compatible /embeddings
    embeddingCloud.ts              # 可选云端（明示上传）
    vectorStore.ts                 # JSONL 或简易 sqlite（见 §4 选型）
    retrieveService.ts
    retrieveService.test.ts
    askVaultService.ts
    askVaultService.test.ts
    indexQueue.ts                  # 后台队列：优先级、取消、进度
  hooks/
    useVaultIndexLifecycle.ts
    useAskVault.ts
    useRelatedNotes.ts
  components/
    backlinks/BacklinksPanel.tsx
    backlinks/OutboundLinksList.tsx
    related/RelatedNotesPanel.tsx
    ai/AskVaultPanel.tsx
    ai/AskVaultCitationList.tsx
    search/SearchModeToggle.tsx    # 或并入 Sidebar
  components/settings/tabs/
    AITab.tsx                      # 扩展本地端点 / 隐私
    IndexTab.tsx                   # 新建：重建、排除、存放位置
  store/
    vaultIndexStore.ts             # 运行时索引状态（不 persist 大体量）
```

`appStore` 组合进 `vaultIndexStore`（进度、lastError、ready 标志）；**向量与边表不进 localStorage persist**。

---

## 3. 核心类型（`src/types/vaultIndex.ts`）

```ts
/** 一条出链（源笔记内的一次 [[wiki]] / ![[embed]]） */
export interface WikiOutboundLink {
  sourcePath: string;
  raw: string; // 原始 [[...]]
  targetRaw: string; // parse 后的 path 部分
  displayText: string;
  resolvedPath: string | null; // resolveWikiLinkFile 结果；null=死链
  isEmbed: boolean;
  subpath?: string;
  subpathType?: "heading" | "block" | null;
  /** 源文件内偏移，便于定位 */
  startOffset: number;
  endOffset: number;
}

export interface LinkIndexSnapshot {
  version: 1;
  vaultRoot: string;
  builtAt: number;
  /** sourcePath -> outbounds */
  outbounds: Record<string, WikiOutboundLink[]>;
  /** resolvedPath -> sourcePaths（反向） */
  inbounds: Record<string, string[]>;
  /** 未解析目标 raw -> 出现的 sourcePaths */
  unresolved: Record<string, string[]>;
  fileMtimes: Record<string, number>;
}

export interface TextChunk {
  id: string; // `${relPath}#${ordinal}` 或 hash
  path: string; // 绝对或 vault 相对，全库统一一种
  relPath: string;
  titlePath: string[]; // 标题面包屑
  headingAnchor: string | null;
  startLine: number;
  endLine: number;
  text: string;
  mtime: number;
  contentHash: string; // 切片文本 hash，增量跳过
}

export interface RetrieveHit {
  chunk: TextChunk;
  score: number;
  source: "keyword" | "vector" | "hybrid";
}

export interface AskVaultCitation {
  index: number; // [1], [2]
  path: string;
  relPath: string;
  titlePath: string[];
  snippet: string;
  startLine: number;
  endLine: number;
  headingAnchor: string | null;
}

export interface AskVaultAnswer {
  answerMarkdown: string;
  citations: AskVaultCitation[];
  usedChunkIds: string[];
  model: string;
  retrievedAt: number;
}

export type SearchMode = "keyword" | "semantic" | "hybrid";

export type IndexJobKind = "link" | "chunk" | "embed";
```

`AppSettings` 增量字段（`types.ts` + `uiStore` default + `persistMigrations`）：

```ts
// 知识索引
indexStoreInVault?: boolean;          // default false → app_config
indexExcludeGlobs?: string[];         // default ['.trash/**', '**/node_modules/**']
embeddingProvider?: 'none' | 'openai-compatible' | 'gemini'; // none=仅关键词
embeddingApiBaseUrl?: string;
embeddingModel?: string;
embeddingApiKey?: string;             // 走 secure storage
searchModeDefault?: SearchMode;       // default 'keyword'
privacyMode?: boolean;                // default false；true 禁止云端 LLM/embed
askVaultSystemPrompt?: string;
```

`AIProvider` 短期不新增枚举值：本地聊天继续用 `deepseek`/`codex` + 自定义 Base URL。Phase 4 再考虑显式 `local` 标签（UX 用，路由仍走 OpenAI 兼容）。

---

## 4. 存储选型

| 数据       | Phase 1                                                                            | Phase 2+ 推荐                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 链接索引   | 单文件 `link-index.json`（原子写：tmp + rename）                                   | 同左；边数极大时再分片                                                                                                  |
| 切片元数据 | —                                                                                  | `chunks.jsonl`（一行一个 chunk 元数据，不含向量）                                                                       |
| 向量       | —                                                                                  | **优先** `vectors.bin` + `vectors-meta.json`（Float32Array 按 id 顺序），或嵌入 **sql.js / SQLite**（若引入成本可接受） |
| Manifest   | `manifest.json`：`{ schemaVersion, vaultRoot, linkBuiltAt, embedModel, embedDim }` | 版本不匹配则全量重建                                                                                                    |
| Ask 历史   | —                                                                                  | `{vaultId}/ask-history/*.md` 或 jsonl；纯本地                                                                           |

**首版不做** LanceDB / 外部向量库进程，降低桌面分发复杂度。中小型库（≤5k 笔记、≤10万 chunk）内存+JSONL 足够；超限进入 Phase 5 性能专项。

**原子写：** `writeTextFile(tmp)` → rename；读失败则标记 corrupt 并重建。

---

## 5. 索引生命周期（横切，Phase 1 起落地）

### 5.1 钩子

| 事件           | 钩子位置                                                 | 动作                                                         |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| 打开知识库成功 | `openKnowledgeBase` / App 恢复 last path 之后            | `ensureIndex(vaultRoot)`：读 manifest → 增量或全量           |
| 目录树变更     | `useKnowledgeBaseWatch` 回调末尾                         | `reconcileTree(prevFiles, nextFiles)`：增删路径              |
| 笔记保存成功   | autosave / 手动 save 成功路径（`markAsSaved` 一带）      | `invalidateFile(path)` → 重解析出链（+ 后续重切块/重 embed） |
| 重命名/移动    | `useFileOperations` + `findAndRewriteAffectedFiles` 之后 | 路径 remap + 受影响文件重解析                                |
| 设置变更       | IndexTab：排除规则 / 存放位置 / embedding 模型           | 提示「需重建」；用户确认后 `rebuildAll`                      |
| 手动重建       | IndexTab 按钮                                            | `rebuildAll({ link, chunk, embed })`                         |

### 5.2 队列（`indexQueue.ts`）

- 单 worker、可取消、可合并同 path 任务（后写覆盖）。
- 优先级：`user-visible`（当前文件 backlinks）> `save` > `background`。
- 进度写入 `vaultIndexStore`：`{ phase, done, total, currentPath, error }`。
- **硬规则：** 队列错误只打日志 + UI 提示，永不打断编辑器输入。

### 5.3 `useVaultIndexLifecycle.ts`

```ts
// 伪代码职责
- 订阅 rootFolderPath / files
- 打开库 → ensureIndex
- watch 树变更 → reconcileTree
- 暴露 rebuildIndex() 给设置页
- 卸载/切库 → cancelJobs + 释放内存快照
```

---

## 6. Phase 1 实施方案：链接索引 + Backlinks

### 6.1 解析工具

新增 `src/utils/wikiOutbound.ts`：

```ts
export function extractOutboundWikiLinks(
  sourcePath: string,
  content: string,
): Omit<WikiOutboundLink, "resolvedPath">[];

export function resolveOutbounds(
  links: Omit<WikiOutboundLink, "resolvedPath">[],
  files: FileNode[],
  rootFolderPath: string | null,
): WikiOutboundLink[];
```

实现：`WIKI_LINK_REGEX` 全局匹配 → `parseWikiLinkReference` → 记录 offset → `resolveWikiLinkFile(files, target, root, sourcePath)`。

单测覆盖：相对路径、basename 歧义、死链、embed、`#heading`、`^block`、中文文件名、trash 忽略。

### 6.2 `linkIndexService`

```ts
buildFullLinkIndex(files, root, readFile): Promise<LinkIndexSnapshot>
updateFilesInIndex(snapshot, paths, readFile, files, root): Promise<LinkIndexSnapshot>
removeFilesFromIndex(snapshot, paths): LinkIndexSnapshot
remapPaths(snapshot, mapping: Record<old, new>): LinkIndexSnapshot
getBacklinks(snapshot, path): { sourcePath; links: WikiOutboundLink[] }[]
getOutbounds(snapshot, path): WikiOutboundLink[]
getUnresolved(snapshot, path): WikiOutboundLink[]
```

内存结构：打开库后持有一份 `LinkIndexSnapshot`；面板只读查询。

### 6.3 UI

1. **右侧栏 Tab 容器**（改造 Outline 区域）
   - Tabs：`大纲` | `链接`（Phase 2 再加 `相关`）
   - 文件：`src/components/backlinks/BacklinksPanel.tsx`

2. **链接面板内容**
   - **反向链接：** 列表项 = 源文件名 + 一行上下文（可选：读源文件截取含 `[[...]]` 的行）
   - **出链：** 当前文件 outbound；死链用警告样式；点击死链 → 确认后 `createNote`（复用新建笔记流程）
   - 点击已解析链接 → `handleFileSelect(path)`；若有 heading → 复用 `requestPreviewHeadingScroll` / editor focus

3. **空态：** 「暂无反向链接」/「暂无出链」，不显示假数据。

### 6.4 设置

`IndexTab` 最小集：重建链接索引、显示上次构建时间、错误信息。排除规则可先写死 `.trash`，Phase 2 再开放 UI。

### 6.5 测试与验收

| 项   | 标准                                                                    |
| ---- | ----------------------------------------------------------------------- |
| 单测 | outbound 解析、增量更新、remap、死链                                    |
| 手测 | 打开含双链的样例库 → 面板正确；改链接保存后刷新；重命名后 backlink 不丢 |
| 性能 | ≤500 笔记全量链接索引在可感知等待内完成，不卡输入                       |
| 回归 | 现有 `wikiLinks.test.ts` / rename rewrite 全绿                          |

### 6.6 交付物

可独立发版的 **1.x-backlinks**：无 AI、无向量依赖。

---

## 7. Phase 2 实施方案：切片 + Embedding + 语义搜索

### 7.1 `chunkService`

策略（默认）：

1. 去掉 frontmatter（保留标题可用 `title` 字段）。
2. 按 `parseHeadings` 切段；无标题则按约 500–800 汉字/词窗口、重叠 ~80。
3. 过滤过短片（如 < 40 字符）与纯代码围栏可选策略：代码块单独成片或附属前文。
4. 产出 `TextChunk` + `contentHash`。

```ts
chunkMarkdownFile(path, relPath, content, mtime): TextChunk[]
diffChunks(old: TextChunk[], next: TextChunk[]): { upsert; removeIds }
```

### 7.2 `embeddingProvider`

```ts
interface EmbeddingProvider {
  id: string;
  dims: number;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}
```

- `embeddingProvider === 'none'` → 跳过向量；语义搜索不可用。
- `openai-compatible`：`POST {base}/embeddings`，复用 `services/ai/http.ts` 模式。
- `privacyMode === true` 时禁止非 localhost Base URL。

密钥：`embeddingApiKey` 加入 `sensitiveSettingKeys`。

### 7.3 `vectorStore`

最小 API：

```ts
upsert(ids: string[], vectors: Float32Array[]): Promise<void>
remove(ids: string[]): Promise<void>
search(query: Float32Array, topK: number): Promise<{ id: string; score: number }[]>
load(): Promise<void>
```

首版暴力余弦即可 + topK；笔记量上来再加简易 IVF 或换 SQLite。

### 7.4 `retrieveService`

```ts
retrieve(query: string, opts: {
  mode: SearchMode;
  scope: 'vault' | 'folder' | 'files';
  folderPath?: string;
  filePaths?: string[];
  topK?: number;          // default 12
}): Promise<RetrieveHit[]>
```

- **keyword：** 复用/抽取 `useSidebarSearch` 的匹配逻辑到纯函数 `keywordSearchChunks` 或文件级后再映射到 chunk。
- **semantic：** embed(query) → vectorStore.search。
- **hybrid：** 两侧取 topN，RRF 或加权合并；同 path 去重保留最高分。

### 7.5 UI

1. Sidebar 搜索头增加 `SearchModeToggle`（三态）；默认跟随 `searchModeDefault`。
2. 未建 embedding 时选 semantic → toast + 链到 Index/AI 设置。
3. `RelatedNotesPanel`：对当前笔记取代表 chunk（标题+前几段）检索 top 5，排除自身。
4. 右侧栏第三 Tab：`相关`。

### 7.6 测试与验收

| 项     | 标准                                                                                 |
| ------ | ------------------------------------------------------------------------------------ |
| 单测   | 切片边界、hash 增量跳过、hybrid 合并去重                                             |
| 评测集 | 准备 `docs/fixtures/retrieval-eval/`：小 vault + 20 条 query→期望 path（可先 10 条） |
| 隐私   | privacyMode 下拒绝云端 embed                                                         |
| 降级   | embedding=none 时搜索仅 keyword，无崩溃                                              |

### 7.7 交付物

**1.x-semantic-search**；Ask Vault 尚未必需。

---

## 8. Phase 3 实施方案：Ask Vault

### 8.1 `askVaultService`

```ts
askVault(input: {
  question: string;
  scope: RetrieveScope;
  settings: AppSettings; // 含 prompt / provider
  signal?: AbortSignal;
}): Promise<AskVaultAnswer>
```

流水线：

1. `retrieve(question, { mode: hybrid|semantic, topK: 8..16 })`
2. 若 hits 为空 → 返回固定文案「知识库中未找到相关内容」，citations=`[]`，**不调用 LLM**（可配置强制仍问，默认否）
3. 组装 prompt（`services/ai/prompts.ts` 新增 `buildAskVaultPrompt`）：
   - 系统：只依据片段；不知则说不知；引用用 `[n]`
   - 用户：问题 + 编号片段（path、行号、text）
4. 走现有 `aiService` 聊天补全（抽一层 `completeChat(messages)` 供润色与 Ask 共用——**建议本 Phase 开头先做这一小步重构**）
5. 解析答案中的 `[n]` → `AskVaultCitation[]`；无引用标记时仍附上检索 top 命中供用户展开

### 8.2 UI：`AskVaultPanel`

- 入口：Toolbar 在现有 AI 按钮旁；快捷键可进 `shortcuts`（如 `askVault`）。
- 布局：问题输入、范围选择（全库/当前文件夹/当前文件）、发送、回答区、引用列表。
- 引用点击：`handleFileSelect` + 按 `startLine`/`headingAnchor` 定位（扩展现有 `requestEditorRangeFocus`）。
- 「插入到光标 / 存为新笔记」→ 填入 `pendingAiResult` 走确认框。
- 「查看将发送的片段」折叠面板：展示 hits 原文（隐私可见性）。

### 8.3 对话历史

- 路径：`{indexRoot}/ask-history/{ISO-date}.jsonl`
- 每行：`{ id, question, answer, citations, model, at }`
- 面板可展开「历史」；不上传云端。

### 8.4 与单篇 AI 整合

| 步骤 | 动作                                                           |
| ---- | -------------------------------------------------------------- |
| 1    | `aiService.completeChat` 统一 DeepSeek/Codex/Gemini 文本补全   |
| 2    | `analyzeMarkdownWithProvider` / wiki gen 改为调 `completeChat` |
| 3    | Ask Vault 共用同一配置与错误提示                               |

### 8.5 测试与验收

| 项   | 标准                                             |
| ---- | ------------------------------------------------ |
| 单测 | 空检索不调 LLM；citation 解析；prompt 含全部 hit |
| 评测 | 同 retrieval-eval：答案引用 path 正确率可统计    |
| 安全 | 无 Key 时入口禁用但写作可用；写回必确认          |
| UX   | 引用可点开并大致定位到段                         |

### 8.6 交付物

**1.x-ask-vault** —— 兑现「AI 知识库」核心承诺。

---

## 9. Phase 4 实施方案：本地模型与隐私

### 9.1 设置 UX

`AITab` 增加：

- 预设：「云端」｜「本地 OpenAI 兼容（Ollama / LM Studio）」
- 本地时引导填 `http://127.0.0.1:11434/v1` 等；模型名文本框
- **隐私模式**开关：开启后
  - 禁止非 loopback Base URL（聊天 + embedding）
  - Gemini 等云厂商入口禁用
  - Ask Vault / 润色均只走本地

### 9.2 运行时闸门

在 `ensureAIConfiguration` 与 `embeddingProvider.embed` 入口：

```ts
assertPrivacyAllowed(settings, endpointUrl);
```

违规 → 抛可读错误，UI toast。

### 9.3 排除规则 UI

`IndexTab`：`indexExcludeGlobs` 多行编辑；变更需重建。

### 9.4 验收

断网 + Ollama 可用时：语义搜索与 Ask Vault 链路通；隐私模式开启后抓包/日志无外网请求（开发者自测清单写入 `docs/RELEASE_SMOKE_TEST.md` 增补项）。

---

## 10. 工程切片（建议 PR 序列）

每个 PR 保持可合并、带测：

| 序号 | PR 主题                                                                        | 依赖         |
| ---- | ------------------------------------------------------------------------------ | ------------ |
| P1   | `wikiOutbound` 工具 + 单测                                                     | 无           |
| P2   | `linkIndexService` + 落盘 + lifecycle 钩子（无 UI）                            | P1           |
| P3   | Backlinks / Outbound 右侧面板                                                  | P2           |
| P4   | IndexTab 重建入口 + 进度条                                                     | P2           |
| P5   | `chunkService` + 落盘                                                          | P2           |
| P6   | `completeChat` 重构现有 AI（无行为变化）                                       | 无（可并行） |
| P7   | embeddingProvider + vectorStore + 增量 embed 队列                              | P5           |
| P8   | `retrieveService` + Sidebar 搜索模式 + Related 面板                            | P7           |
| P9   | `askVaultService` + AskVaultPanel + 引用跳转                                   | P6+P8        |
| P10  | 对话历史                                                                       | P9           |
| P11  | 隐私模式 + 本地预设 + 排除规则 UI                                              | P7           |
| P12  | retrieval-eval 夹具 + CI 硬门禁（`test:retrieval-eval` / coverage thresholds） | P8           |

Phase 5（PDF 入索引、大库性能）单独立项，不插入上述关键路径。

---

## 11. 性能预算（中小型库）

假设：≤ 2,000 Markdown，均 5KB。

| 操作                 | 预算                                       |
| -------------------- | ------------------------------------------ |
| 全量链接索引         | 不阻塞 UI；后台完成；面板显示 spinner      |
| 单文件保存后链接更新 | < 100ms 量级主线程工作或让出主线程         |
| 语义检索 topK        | < 300ms（已 load 的向量，不含 embed 网络） |
| Ask Vault 端到端     | 主要耗时在 LLM；检索部分 < 1s              |

手段：Web Worker（可选，Phase 2 若主线程卡再加）；分批 embed（每批 16/32）；`requestIdleCallback` 调度低优任务。

---

## 12. 风险与规避（实施层）

| 风险                             | 做法                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| 目录 watch 不感知内容            | 保存成功必 `invalidateFile`；可选定期 mtime 扫描（设置「后台校验索引」） |
| 浏览器/dev 无 Tauri              | indexStorage 走内存或降级提示「索引仅桌面完整可用」                      |
| Gemini 与 OpenAI embeddings 差异 | embedding 单独配置，不绑死聊天 Provider                                  |
| 中文分词弱                       | 关键词侧保留现有 substring；语义侧承担同义                               |
| 索引写坏                         | schemaVersion + 损坏自动重建；设置页手动重建                             |

---

## 13. 各 Phase DoD（完成定义）

**Phase 1 DoD**

- [ ] 右侧「链接」面板展示当前笔记 backlinks / outbounds / 死链
- [ ] 打开库自动建链索引；保存/重命名后最终一致
- [ ] 索引可重建；删除索引目录不影响笔记
- [ ] 相关单测通过；样例库手测通过

**Phase 2 DoD**

- [ ] 可配置 embedding；可 hybrid 搜索
- [ ] 相关笔记 Tab 可用
- [ ] embedding=none / 失败时优雅降级
- [x] 至少 10 条评测 query 有基线数字（`docs/fixtures/retrieval-eval/` + `npm run test:retrieval-eval`）

**Phase 3 DoD**

- [ ] Ask Vault 带来源；点击可打开定位
- [ ] 空检索不乱答；写回需确认
- [ ] 与单篇 AI 共用 Provider 配置

**Phase 4 DoD**

- [ ] 隐私模式阻断云端
- [ ] 本地 OpenAI 兼容端点文档化（README 增补一小节）
- [ ] 冒烟清单含断网本地问答

---

## 14. 文档与对外说明

| 文档                         | 动作                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `PRODUCT_ROADMAP.md`         | 链到本文                                                           |
| `README.md` / `README.en.md` | Phase 3 落地后补充「Ask Vault / 反向链接」亮点；Phase 4 补本地模型 |
| `DEVELOPMENT.md`             | 已增补评测夹具与覆盖率门禁运行方式；索引目录/重建说明可继续补      |
| `RELEASE_SMOKE_TEST.md`      | 每 Phase 增加对应冒烟项                                            |

---

## 15. 开工第一刀（建议本周可执行）

1. 落地 `src/utils/wikiOutbound.ts` + 单测（P1）。
2. 落地 `linkIndexService` + app_config 落盘 + `useVaultIndexLifecycle` 挂到打开库（P2）。
3. 右侧栏「链接」面板接上只读查询（P3）。

完成这三步即具备可演示的知识关系层，并为 Phase 2 切片索引留好 `invalidateFile` 管道。
