# 表格编辑体验优化方案（参考 Obsidian）

文档状态：Phase A 已落地（源码结构化）  
关联：[PRD](./PRD.md) §6.2 / FR-101–106 / FR-205 / FR-109  
基线：v0.9.16 · CodeMirror 6 源码编辑 + markdown-it 预览  
更新时间：2026-07-23

## 实现进度

| 阶段                     | 状态       | 落点                                                                                                  |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------- |
| Phase A 源码结构化       | **已实现** | `src/utils/markdownTable.ts` · `src/components/editor/behavior/tables.ts` · Tab/Enter 接入 `input.ts` |
| Phase B 美化/粘贴/可发现 | 未做       | Format 命令已有；HTML 粘贴与命令面板仍缺                                                              |
| Phase C Live 叠层        | **已增强** | `tables.ts`：单元格编辑 + Tab/Enter 导航；右键菜单与快捷键增删行列                                    |

### Phase A 快捷键

| 操作                             | 快捷键                                      |
| -------------------------------- | ------------------------------------------- |
| 插入表格                         | `Mod-Shift-T`                               |
| 单元格前进 / 后退                | `Tab` / `Shift-Tab`（表内）                 |
| 下一行同列 / 末行加行 / 空行退出 | `Enter`（表内）                             |
| 下方 / 上方插入行                | `Mod-Shift-Enter` / `Alt-Shift-Enter`       |
| 左侧 / 右侧插入列                | `Alt-Mod-←` / `Alt-Mod-→`                   |
| 删除行 / 删除列                  | `Mod-Shift-Backspace` / `Alt-Mod-Backspace` |
| Live：右键菜单增删行列           | 单元格上右键                                |

## 1. 问题与目标

### 1.1 现状

表格在 墨记 中只有「写 pipe 源码 → 预览渲染」这条路径：

| 已有                                   | 缺失                               |
| -------------------------------------- | ---------------------------------- |
| GFM 表格预览（FR-205）                 | 单元格级导航（Tab / Shift-Tab）    |
| 松散表格归一化（空行、Unicode 分隔线） | 增删/移动行与列                    |
| format-on-save 时整理表格块            | 对齐方式切换、列宽对齐美化         |
| 列表/引用/代码块结构化快捷键           | 插入表格模板、表格命令面板         |
| —                                      | HTML 粘贴为 GFM 表格               |
| —                                      | 源码内表格感知的 Enter / Backspace |

PRD §6.2 已把「表格等高频源码编辑行为」列为体验指标，但 §7.1 结构化编辑范围未包含表格；当前 `createMarkdownKeyBindings` 对表格无任何特判。

### 1.2 目标体验（对齐 Obsidian，不照搬富文本）

Obsidian 表格体验的核心不是「把 Markdown 改成 Excel」，而是：

1. **单元格心智**：光标在单元格内移动，而不是在 `|` 字符间肉搏。
2. **结构操作可发现**：增删行列、对齐、格式化有命令与快捷键，不必手改 pipe。
3. **源码仍透明**：落盘仍是标准 GFM 表格，可迁移、可 diff。
4. **Live Preview 可选**：高级形态是点进格子直接改，但底座仍是 pipe 文本。

墨记 定位是「比 Obsidian 更轻量的纯 Markdown」，且明确不做富文本优先。因此方案采用：

> **源码优先的结构化表格编辑（Obsidian Advanced Tables / 源码侧行为）为 P0；可选的 Live 单元格叠层为 P2，不引入 TipTap/ProseMirror 整页 WYSIWYG。**

### 1.3 成功标准

- 在已有 GFM 表格内，Tab / Shift-Tab 在单元格间跳转；末格 Tab 自动追加一行。
- 用户可通过命令/快捷键完成：插入表格、增删行/列、移动行/列、切换列对齐、格式化对齐。
- 空行、Unicode 破折号等松散表格在编辑过程中即可被结构识别，不只依赖预览预处理。
- 从网页/Word 粘贴含 `<table>` 的 HTML 可得到可用的 GFM 表格。
- 不破坏现有列表/引用/代码块快捷键；表格外 Tab 行为不变。

---

## 2. Obsidian 对照与取舍

| Obsidian 行为                       | 价值       | 墨记 建议                                                                    |
| ----------------------------------- | ---------- | ---------------------------------------------------------------------------- | --------------------------------- |
| Tab / Shift-Tab 单元格导航          | 极高       | **P0** 源码模式实现                                                          |
| 末单元格 Tab → 新行                 | 极高       | **P0**                                                                       |
| Enter 在单元格内换行 / 下一行       | 高         | **P0**：表格内 Enter 移到下一行同列；空单元格连续 Enter 可退出表格（可配置） |
| 命令：Insert/Delete/Move row·column | 极高       | **P0** 命令 + 快捷键                                                         |
| 列对齐 Left/Center/Right            | 高         | **P0** 改 separator 行 `:---` / `:---:` / `---:`                             |
| Format table（列宽 `                | ` 对齐）   | 高                                                                           | **P1** 命令 + 可选 format-on-save |
| 右键/浮动控件增删行列               | 中         | **P1** 命令面板优先；浮动条可选                                              |
| Live Preview 可点击单元格编辑       | 高（视觉） | **P2** CodeMirror widget/overlay，非默认                                     |
| 单元格内公式/复杂块                 | 低         | **不做**：单元格仍是 inline Markdown                                         |
| 电子表格排序/筛选/公式              | 低         | **不做**：超出写作器定位                                                     |

刻意不做：

- 整页 WYSIWYG 表格编辑器（违反「不做富文本优先」）。
- 专有表格语法或二进制附件表。
- 合并单元格（GFM 不支持，Obsidian 核心也不做可靠合并）。

---

## 3. 方案总览

```text
┌─────────────────────────────────────────────────────────┐
│ UX 层                                                    │
│  快捷键 · 命令面板 ·（可选）表格浮动工具条 · 插入菜单     │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│ Editor behavior（CodeMirror StateCommand）               │
│  tableNavigate · tableEnter · tableInsert* · tableAlign  │
│  与现有 handleSmartTab / handleSmartEnter 优先级协作     │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│ Table model（纯函数，可单测）                            │
│  parseTableAt · serializeTable · navigateCell            │
│  insert/delete/move row·col · alignColumn · formatWidths │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│ 已有资产复用                                             │
│  markdownTableNormalize · markdownFormat · Turndown 粘贴 │
└─────────────────────────────────────────────────────────┘
```

原则：表格逻辑放在可测试的纯模块；编辑器只做光标/选区与事务分发。与列表结构化编辑同一模式。

---

## 4. 分阶段交付

### Phase A — 源码结构化（P0，优先落地）

**范围**

1. **表格模型** `src/utils/markdownTable.ts`（或 `src/components/editor/behavior/tables/`）
   - 从光标位置识别 GFM 表格块（header + separator + body）。
   - 解析为 `{ rows: string[][], alignments, startLine, endLine }`。
   - 序列化回 pipe 文本；可选列宽填充空格。
   - 复用/上移 `isPotentialMarkdownTableRow`、`isMarkdownTableSeparatorLine`。

2. **导航与输入**
   - 光标在表格行内时：`Tab` → 下一单元格；`Shift-Tab` → 上一单元格。
   - 末行末列 `Tab` → 追加空行并进入首列。
   - 表格内 `Enter` → 移到下一行同列；若已在末行则追加行。
   - 空行连续两次 `Enter` 或行首空单元格 `Backspace` → 退出/删行（细节见 §5）。
   - 与列表 Tab 冲突：`createHandleSmartTab` 先探测表格，命中则交给 table handler。

3. **结构命令**（命令面板 + 快捷键）

   | 命令                 | 建议快捷键（可改）              |
   | -------------------- | ------------------------------- |
   | 插入表格（2×3 模板） | `Mod-Shift-T`                   |
   | 在上方/下方插入行    | `Mod-Shift-Enter` / `Alt-Enter` |
   | 在左/右侧插入列      | `Alt-Mod-←/→` 或命令面板        |
   | 删除当前行/列        | 命令面板                        |
   | 上/下移动行          | 命令面板                        |
   | 左/右移动列          | 命令面板                        |
   | 列对齐：左/中/右     | 命令面板                        |
   | 格式化当前表格       | 命令面板                        |

4. **插入体验**
   - 空行处 `Mod-Shift-T` 插入：

     ```markdown
     | 列1 | 列2 | 列3 |
     | --- | --- | --- |
     |     |     |     |
     |     |     |     |
     ```

   - 光标落在首个数据单元格；选中「列1」便于直接改名（可选）。

**验收**

- 单元测试覆盖 parse/serialize、导航边界、增删行列后光标位置。
- 手动：在 sample note 表格内 Tab 循环、末格加行、删列后预览仍正确。
- 列表/代码块内 Tab 行为回归通过现有测试。

---

### Phase B — 美化、粘贴与可发现性（P1）

1. **Format table**：按列最大显示宽度对齐 `|`（东亚字符宽度可先按 code point，后续再做 east-asian width）。
2. **format-on-save**：在现有 `markdownFormat` 表格分支中可选「对齐列宽」（默认关，避免无意义 diff）。
3. **HTML → GFM 表格**：`htmlToMarkdown` 增加 Turndown GFM 表规则或手写 `table` 规则；粘贴 Excel/网页表格可用。
4. **命令可发现**：命令面板条目 + 编辑菜单「表格」分组；插入菜单增加「表格」。
5. **松散表格编辑期识别**：编辑时也用与 `normalizeMarkdownTablesForRender` 相同启发（Unicode dash、行间空行）判断「是否在表内」，避免用户加空行后快捷键失效。

**验收**

- 粘贴简单 HTML `<table>` 得到合法 GFM。
- Format 后预览不变、源码列对齐；关闭 format-on-save 时不自动改写。

---

### Phase C — Live 单元格叠层（P2）

**已增强（就地编辑）**：表格块始终以 HTML 网格渲染；点击单元格进入 `contenteditable`，编辑时不退回 pipe 源码。

1. CodeMirror `Decoration.replace` + `WidgetType` 渲染表格；`atomicRanges` 避免光标落入源码。
2. 活动单元格由 `activeTableCellField` 跟踪；写回经 `setTableCell` + `serializeTable`。
3. 格内 **Tab / Shift-Tab** 横向导航（末格 Tab 追加行）；**Enter** 移到下一行同列（末行追加）；**Esc** 提交并退出。
4. 源码模式 Phase A 快捷键不变；Live / Split 下优先格子内编辑。
5. **不**引入完整富文本引擎。

风险：大表 widget 性能、与 Wiki/公式 inline 装饰冲突、IME 输入——已用 `isComposing` 跳过组合键提交。

---

## 5. 交互细则（Phase A）

### 5.1 单元格定位

- 行：光标所在物理行属于表格块。
- 列：按 `|` 分割后，光标落在哪一段（注意行首可选 `|`、行尾 `|`、转义 `\|` 可先不做或保守处理）。
- Separator 行：导航时跳过；结构命令作用在「当前逻辑列」。

### 5.2 Tab

```text
若光标不在表格 → 交给现有 list/indent 逻辑
若在表格：
  Tab       → 下一单元格；若无 → 新行 + 首单元格
  Shift-Tab → 上一单元格；若无 → false（交给默认）或停在首格
```

### 5.3 Enter

```text
若在表格数据行：
  Enter → 同列下一行；无则追加空行并定位
  若当前单元格为空且为末行 → 删除该空行并跳出表格（Obsidian 式退出）
若在 header 行：
  Enter → 进入首个 body 行同列（不拆 header）
```

### 5.4 增删列

- 插入列：每行对应位置插入空 cell；separator 插入 `---`。
- 删除列：至少保留 1 列；删后重新 serialize。
- 对齐：只改 separator 对应段。

### 5.5 与归一化的关系

- 结构操作输出的表格应始终是「紧凑合法 GFM」（无行间空行、ASCII `-`）。
- 预览侧 `normalizeMarkdownTablesForRender` 继续兜底历史松散笔记。

---

## 6. 工程落点

| 模块     | 路径（建议）                                      | 说明                           |
| -------- | ------------------------------------------------- | ------------------------------ |
| 表格模型 | `src/utils/markdownTable.ts` + `*.test.ts`        | 纯函数 parse/serialize/mutate  |
| 编辑命令 | `src/components/editor/behavior/tables.ts`        | StateCommand                   |
| 键绑定   | `behavior/index.ts` → `createMarkdownKeyBindings` | Tab/Enter 优先表格             |
| 输入协作 | `behavior/input.ts`                               | SmartTab/Enter 调用 table 探测 |
| 粘贴     | `src/utils/htmlToMarkdown.ts`                     | table 规则                     |
| 格式化   | `src/utils/markdownFormat.ts`                     | 可选列宽对齐                   |
| 命令面板 | 现有 command palette 注册处                       | 表格命令组                     |
| 文档     | PRD 增补 FR-109；本方案作为规格                   | —                              |

现有可复用：

- `src/utils/markdownTableNormalize.ts`
- `src/utils/markdownFormat.ts` 表格行分类
- `src/components/editor/behavior/` 列表结构化模式

---

## 7. PRD 增量建议

在 [PRD](./PRD.md) 功能需求中增加：

| ID     | 需求                                                                            | 优先级 |
| ------ | ------------------------------------------------------------------------------- | ------ |
| FR-109 | 源码模式下支持 GFM 表格结构化编辑：单元格导航、增删行列、列对齐、插入表格模板。 | P1     |
| FR-110 | 支持将粘贴的 HTML 表格转为 GFM 表格。                                           | P2     |
| FR-111 | （可选）表格 Live 单元格编辑叠层，默认不改变源码优先路径。                      | P2     |

并将 §7.1「Markdown 结构化编辑」扩展为：列表、引用、代码块、**表格**、常见快捷输入。

---

## 8. 风险与缓解

| 风险                                   | 缓解                                               |
| -------------------------------------- | -------------------------------------------------- |
| 误判非表格的管道行（如 `a \| b \| c`） | 要求存在 separator 行才认定为表；与 normalize 一致 |
| 单元格含未转义 `\|`                    | Phase A 按简单 split；文档说明；后续再做转义感知   |
| Tab 与列表缩进冲突                     | 表格探测优先；仅在表内劫持                         |
| Format 造成 git diff 噪音              | 列宽对齐默认仅手动命令；save 时可选                |
| Live widget 复杂度                     | 严格放在 Phase C，先用源码方案满足 80%             |

---

## 9. 建议实施顺序

1. 落地 `markdownTable` 模型 + 单测（不改 UI）。
2. 接入 Tab/Enter 导航与末格加行。
3. 插入表格 + 增删行列 + 对齐命令。
4. 命令面板与快捷键、回归列表行为。
5. HTML 粘贴与 Format table。
6. 视反馈决定是否做 Live 叠层 Spike。

---

## 10. 结论

当前表格「能渲染、难编辑」。按 Obsidian 的单元格心智，在 **CodeMirror 源码模式** 补齐导航与结构命令，即可在不违背「纯 Markdown / 非富文本优先」的前提下，把表格从痛点变成与列表同级的结构化编辑能力。Live Preview 式格子编辑可作为后续增强，而非第一刀。
