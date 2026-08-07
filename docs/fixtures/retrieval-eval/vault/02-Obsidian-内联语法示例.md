---
category: 示例
tags:
  - Obsidian
  - Wiki
status: draft
is_publish: false
"date created": 2026-07-15
"date modified": "2026-07-15 00:00:00"
---

# Obsidian 内联语法示例

M記 支持常用的 Wiki 双链与嵌入写法，方便从 Obsidian 知识库迁过来继续写。入门见 [[00-快速上手]]，通用 Markdown 见 [[01-Markdown-语法示例]]。

## Wiki 链接

链接到同知识库其他笔记：

[[01-Markdown-语法示例]]

带显示别名：

[[01-Markdown-语法示例|Markdown 语法一览]]

跳到目标笔记的指定标题：

[[01-Markdown-语法示例#强调]]

跳到本笔记内的标题（用于目录、回跳）：

[[#附件嵌入]]

## 附件嵌入

### 嵌入图片

![[lbxx.jpeg]]

### 嵌入笔记片段

按标题嵌入另一篇笔记的一节：

![[01-Markdown-语法示例#强调]]

---

以上覆盖日常双链与嵌入；Obsidian 的 Callout、`==高亮==`、`%%注释%%` 等本应用暂不特殊处理，会按普通 Markdown 显示。
