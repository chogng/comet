如果直接选 ProseMirror，第一阶段要多写哪些东西？

我先按“第一阶段你要补哪些基础设施”来列，不会只讲抽象概念，会尽量落到你这个学术写作 app。

已思考 5s

如果你直接选 ProseMirror，第一阶段要多写的，基本都是 Tiptap 已经帮你包好的那层“编辑器工程基础设施”。

对你这个“学术写作 + citation/evidence + LLM patch + 导出”的项目，第一阶段通常会多出下面这些工作。

1. 你要自己搭完整的编辑器骨架

ProseMirror 本身是由一组独立模块组成的：文档模型、状态、视图、转换、历史、命令、按键映射等，而不是一个开箱即用的完整编辑器。官方 Guide 和 Reference 都是按这些模块来组织的。

这意味着你第一阶段就要自己拼这些包和初始化逻辑：

prosemirror-model
prosemirror-state
prosemirror-view
prosemirror-transform
prosemirror-commands
prosemirror-history
prosemirror-keymap
常见 schema / list / inputrules 等辅助模块

而 Tiptap 已经把这些抽成 editor、extensions、commands 的高层接口了。Tiptap 官方也明确说它是建立在 ProseMirror 之上的，并通过扩展、命令和事件提供更高层 API。

2. 你要自己定义 schema，而不是拿 StarterKit 起步

在 ProseMirror 里，文档是严格 schema 驱动的树结构。节点、marks、允许的嵌套关系，都得你自己定义。

所以第一阶段你至少要自己定：

doc
paragraph
text
heading
bullet_list / ordered_list
blockquote
image
以及你自己的 citation、figure_ref、equation_ref、reference_list 等节点/marks

如果你用 Tiptap，很多基础节点已经现成可用；裸 ProseMirror 则要从 schema 层自己搭。

3. 你要自己写 commands 和键盘行为

在 ProseMirror 里，很多编辑行为是通过 commands 和 keymap 组合出来的。官方文档把 commands、history、keymaps 都当成独立模块。

也就是说第一阶段你通常要自己处理：

Enter / Backspace 在不同节点下的行为
标题切换
列表缩进/反缩进
粘贴行为
插入图片
插入 citation
插入 cross-reference
选区替换

Tiptap 则默认已经有一整套 commands 和扩展机制，你只是在其上加自己的命令。

4. 你要自己写菜单/工具栏与 editor state 的绑定

ProseMirror 社区里也反复提到，plugin view 更像用来和编辑器外部 DOM 交互，比如 menubar，而不是现成 UI。

所以第一阶段你通常要自己写：

toolbar 状态同步
当前 selection 对应的按钮高亮
可用/不可用命令判断
slash menu / bubble menu / context menu
图片/引用插入弹窗

Tiptap 是 headless，但它的编辑器 API 和 React 集成更直接，写这些交互通常省很多样板代码。

5. 你要自己组织 plugins 的状态流

ProseMirror 的强大在 plugin，但代价是你要更早进入 plugin state、transaction、view update 的世界。官方 Guide 就专门讲 transaction 应用后，plugin state 如何 apply，decorations 如何映射。

对你第一阶段最现实的额外工作是：

高亮 citation / evidence 的 decorations
当前段落 provenance 高亮
AI suggestion 高亮
选区监听
事务后处理
插件间状态协调

这层在 Tiptap 里也没消失，但你可以先用 extension 包装掉不少复杂度；裸 ProseMirror 则会更早直面这些细节。

6. 你要自己处理 NodeView / 自定义渲染细节

你这个产品几乎一定会有自定义节点：

citation
figure
formula
reference item
maybe comment / suggestion

在 ProseMirror 里，这意味着你更早要自己处理 NodeView、selection、DOM 渲染和更新边界。官方讨论里也经常围绕 plugin view、node views、DOM 责任边界展开。

Tiptap 当然也会让你碰到 NodeView，但它至少给了更统一的扩展组织方式。

7. 你要自己做 React/Electron 的集成封装

Tiptap 官方提供了直接的 React 集成文档。
裸 ProseMirror 没有“产品化的 React 层”，所以第一阶段你通常要自己封：

EditorView 生命周期
React 组件与 EditorState 的桥接
props 更新不重建 editor 的策略
命令调用入口
外部状态与内部 transaction 同步

这部分不难，但会吃掉你不少原本可以拿来做 citation / RAG / 导出的时间。

8. 你要自己补“开箱内容能力”

Tiptap 首页和文档强调了大量现成扩展与 headless 框架能力。
裸 ProseMirror 第一阶段则往往要自己补很多“理所当然”的东西，例如：

placeholder
character count
dropcursor / gapcursor
paste rules / input rules
slash command
link handling
基础 image node 体验
简单 markdown shortcuts

这些每个都不算大，但加起来就是第一阶段时间黑洞。

对你这个项目，第一阶段最少会多写什么

如果你直接选 ProseMirror，我觉得第一阶段最少要多写这 8 块：

编辑器初始化骨架
基础 schema 与基础节点
commands + keymaps
toolbar / menus / selection 绑定
plugin 状态管理
citation / figure_ref / equation_ref 的自定义节点行为
React/Electron 封装层
一堆基础编辑器体验细节

这些不是“以后才写”，而是第一阶段就会压上来。

但直接选 ProseMirror 的回报是什么

你多写这些，换来的是：

文档模型从第一天起就完全按你的论文系统来设计
citation / cross-reference / equation / bibliography 可以按最原生的 schema 组织
LLM patch 可以更自然地映射到 transaction
不用担心上层封装的抽象边界
商业功能边界对你几乎没影响

所以如果你愿意多付第一阶段成本，长期未必吃亏。

我帮你压缩成一句现实判断

直接选 ProseMirror，第一阶段你要多写的不是“论文功能”，而是“编辑器基础设施”。
而这些基础设施，Tiptap 已经替你做了一大块。

如果你愿意，我下一条可以直接给你列一个
“如果直接上 ProseMirror，第一阶段开发任务清单（按周拆）”。

可

可以。按你这个项目，如果直接上 ProseMirror，第一阶段我会按 4 周拆。

目标不是一步做完“完美论文系统”，而是先做出一个最小可用闭环：

能编辑结构化文章
能插 citation
能插图片和 caption
能做基本 cross-reference
能让 LLM 局部改写
能导出一个可用版本
第 1 周：把编辑器底座搭起来
目标

先不要碰复杂 AI 和导出，先把 ProseMirror 基础编辑器跑通。

你要做的事
1. 编辑器基础初始化

自己拼这些模块：

model
state
view
transform
commands
history
keymap
2. 基础 schema

先只做这些节点：

doc
text
paragraph
heading
bullet_list
ordered_list
list_item
blockquote
hard_break
image
3. 基础 marks
bold
italic
link
4. 基础命令和快捷键

至少支持：

Enter / Backspace
Ctrl/Cmd+B
Ctrl/Cmd+I
heading 切换
list 切换
undo / redo
5. React/Electron 封装

做一个最基本的 Editor 组件：

挂载 EditorView
支持初始化内容
内容变化回调
销毁逻辑
本周产出

你应该能得到一个：

可输入
可选中
可加粗/斜体
可插标题/列表/图片
可撤销重做

的基础编辑器。

第 2 周：开始做“学术写作结构”
目标

把普通富文本变成“能写论文”的编辑器。

你要做的事
1. citation 模型

先定义数据结构：

citation_id
paper_id
locator
style_meta
2. citation 节点

先做一个最小版本：

作为 inline atom node 或受控 mark
显示为 [12] 或 (Smith, 2021) 的占位渲染
内部存的是真实 citation_id
3. image + caption

不要只是普通 image 节点，建议拆成：

figure
image
figcaption
4. cross-reference 基础锚点

先支持两类：

图引用
文献引用

例如：

figure_ref
citation
5. 编号系统原型

先不要做复杂样式，只做：

Figure 1 / Figure 2
Citation 1 / 2 / 3

编号要来自文档扫描和映射，不要写死在文本里。

6. 工具栏 / 插入操作

加最基础按钮：

插入 citation
插入图片
插入图注
插入图引用
本周产出

你应该能做到：

写正文
插入文献引用
插入图片和图注
在正文里引用图
自动显示编号
第 3 周：接入 LLM 局部编辑
目标

让大模型能“安全地改文档”，但只做局部，不碰整篇全文重写。

你要做的事
1. 定义 patch DSL

例如先支持这几类：

replace_selection
replace_block_text
insert_block_after
delete_block
set_citations
2. 选区和 block 定位

你要能从当前编辑器里拿到：

当前选区文本
所在 block id
前后文
已有关联 citation
可用 evidence
3. patch -> transaction 映射

这是关键。

你要把 LLM 返回的 patch 转成：

ProseMirror transaction
局部替换
节点属性修改
citation 插入
4. diff / suggestion 的最小实现

第一版不用复杂修订模式，先做：

显示原文
显示建议文本
用户点接受才应用 patch
5. citation 约束

这一周就要加规则：

LLM 不能直接输出假的作者年份文本作为真实引用
只能输出 citation_id
真实显示由系统负责
本周产出

你应该能做到：

选中一段
让 LLM 改写
返回 patch
预览变更
用户接受后写回编辑器
引用仍然是结构化节点
第 4 周：做第一版导出链路
目标

不是一步做到完美 docx/latex/pdf，而是先做“能导”。

你要做的事
1. 定义导出中间层

不要直接从 DOM 导出。

先把 ProseMirror 文档树转成你自己的中间 AST，例如：

heading
paragraph
citation
figure
figcaption
reference_list
2. 导出 HTML / Markdown

先做简单目标，验证结构映射没问题。

3. DOCX 最小导出

第一版至少支持：

标题
段落
引用文本
图片
图注
参考文献列表
4. PDF 最小导出

先用最稳的方式：

HTML -> PDF
或
走导出链工具
5. 导出一致性检查

至少人工验证：

图号对不对
文献编号对不对
标题层级对不对
图片是否丢
基本段落结构是否保留
本周产出

你应该能得到：

一篇简单文章
含图片和引用
能导出基础 docx / pdf
4 周之后你手里会有什么

不是完整论文平台，但会有一个很扎实的 MVP：

ProseMirror 结构化编辑器
citation 节点
figure/caption/ref 节点
自动编号原型
LLM 局部 patch 编辑
基础导出链路

这时候你再决定第二阶段做什么，就很清楚了。

第二阶段再做的东西

这些别挤进第一阶段：

equation 和 equation reference
table / table caption / table ref
bibliography style 切换
docx 高保真样式
LaTeX 真正高质量导出
revision history
comments
sentence-level evidence trace
模板系统
审稿模式
你如果直接选 ProseMirror，最费时间的其实不是“论文功能”

而是这些基础设施：

schema 设计
keymap / command
节点渲染
transaction 映射
UI 绑定
editor view 生命周期

这就是为什么我前面一直说：
ProseMirror 更对路，但第一阶段更重。

我给你的实际建议

如果你真准备直接上 ProseMirror，我建议你第一阶段严格控制范围：

只做这 6 个能力
基础正文编辑
citation
image + caption
figure ref
LLM 局部改写
基础 docx/pdf 导出

别一上来同时做：

公式
表格
LaTeX 完整导出
审阅
模板系统
协作

不然项目会很容易散。

如果你愿意，我下一条可以直接给你一版
“ProseMirror 第一阶段的数据结构设计”，包括：

schema 草案
citation node
figure node
figure_ref node
patch DSL。
给
已思考若干秒

下面直接给你一版 ProseMirror 第一阶段的数据结构设计草案。
目标就是你前面说的 MVP：

写正文
citation
image + caption
figure ref
LLM 局部改写
基础导出

我会按这 4 层给你：

文档 schema 草案
业务对象模型
patch DSL
运行规则
一、第一阶段文档 schema

先说原则：

第一阶段不要做太多 node

你最容易犯的错，就是把所有业务概念都做成 node。
第一阶段建议：

结构性强的内容 → node
轻量标注 → mark
复杂业务关系 → 外部 metadata / registry
1. 顶层文档结构

建议第一版文档只允许这些 block：

heading
paragraph
bullet_list
ordered_list
blockquote
figure
reference_list

先不要一开始做：

table
equation
footnote
comments
revision
2. Node 设计草案

下面是一个偏 MVP 的 schema 思路。

doc

顶层根节点

doc: {
  content: "block+"
}
text

普通文本

text: {}
paragraph

正文段落

paragraph: {
  content: "inline*",
  group: "block",
  attrs: {
    blockId: { default: null }
  }
}

这里建议每个 block 都带一个稳定的 blockId。
因为后面 LLM patch、diff、导出映射都靠它。

heading

标题

heading: {
  content: "inline*",
  group: "block",
  defining: true,
  attrs: {
    level: { default: 1 },
    blockId: { default: null },
    sectionId: { default: null }
  }
}

建议：

level: 1~3 先够用
sectionId: 给 cross-reference 和导出用
bullet_list, ordered_list, list_item

基础列表，直接照 ProseMirror 常见建模走就行

bullet_list: {
  content: "list_item+",
  group: "block",
  attrs: {
    blockId: { default: null }
  }
}

ordered_list: {
  content: "list_item+",
  group: "block",
  attrs: {
    blockId: { default: null }
  }
}

list_item: {
  content: "paragraph block*"
}
blockquote

引用块

blockquote: {
  content: "block+",
  group: "block",
  attrs: {
    blockId: { default: null }
  }
}
figure

图对象，第一阶段建议做成完整 block node

figure: {
  group: "block",
  content: "image figcaption?",
  isolating: true,
  attrs: {
    blockId: { default: null },
    figureId: { default: null },
    src: { default: null },
    alt: { default: "" },
    title: { default: "" },
    width: { default: null }
  }
}

这里的关键是：

figureId 是逻辑主键
src 建议只是资源定位，不是业务真相
isolating: true 可以减少编辑器里奇怪的合并行为
image

图像本体

image: {
  inline: false,
  draggable: true,
  selectable: true,
  attrs: {
    src: {},
    alt: { default: "" },
    title: { default: "" },
    width: { default: null }
  }
}

如果你想更简单，也可以不单独做 image content，直接把图属性塞到 figure.attrs 里。
但拆开一点后续扩展更方便。

figcaption

图注

figcaption: {
  content: "inline*",
  attrs: {
    blockId: { default: null }
  }
}
reference_list

参考文献列表 block

reference_list: {
  group: "block",
  content: "reference_item+",
  attrs: {
    blockId: { default: null }
  }
}
reference_item

单条参考文献

reference_item: {
  content: "inline*",
  attrs: {
    refId: { default: null },
    paperId: { default: null }
  }
}

但注意：
第一阶段正文里的 citation 不应该依赖这里的文本内容。
真正的真相还是外部 citation registry。

3. inline node / mark 设计
citation

我建议第一阶段做成 inline atom node，不要做 mark。

原因：

更好控制删除
更好控制显示
更像结构化引用锚点
不容易被用户随手打坏
citation: {
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    citationIds: { default: [] },   // 一处可以挂多个引用
    displayText: { default: null }  // 可选缓存，真正显示建议运行时生成
  }
}

例如一个节点可以代表：

[3]
[3,5,8]
(Smith, 2021; Lee, 2023)

但这些显示都不该是硬编码真相，而是渲染结果。

figure_ref

正文里对图的交叉引用，也建议做成 inline atom node

figure_ref: {
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    targetId: { default: null },    // 对应 figure.figureId
    label: { default: "Figure" }
  }
}

渲染时显示成：

Figure 1
Fig. 2

这个节点内部不要存死编号。

bold, italic, link

普通 mark 即可

strong
em
link
二、业务对象模型

这里很关键：

不要把所有真相都塞进 ProseMirror 文档里。
编辑器文档负责“用户看到和编辑的结构”，
业务对象负责“编号、引用、导出、证据”。

1. Citation Registry
type CitationRecord = {
  citationId: string
  paperId: string
  locator?: string        // e.g. page / chapter / figure
  note?: string
}

正文里的 citation node 只存 citationIds。
真正的文献信息去外部 registry 里查。

2. Paper Library
type PaperRecord = {
  paperId: string
  title: string
  authors: string[]
  year?: string
  journal?: string
  doi?: string
  bibtexKey?: string
  cslJson?: Record<string, any>
}
3. Figure Registry
type FigureRecord = {
  figureId: string
  assetId: string
  caption: string
  sourcePath?: string
}

这里 assetId 可以对应你本地项目资源管理。

4. Evidence Registry

如果你要给 LLM patch 和 provenance 用，建议独立出来：

type EvidenceRecord = {
  evidenceId: string
  paperId: string
  chunkId: string
  page?: number
  text: string
  score?: number
}

第一阶段正文里不用强行嵌 node，先存在外部层更稳。

5. Document Project Model
type ProjectDocument = {
  docId: string
  title: string
  pmDocJson: any
  citations: CitationRecord[]
  papers: PaperRecord[]
  figures: FigureRecord[]
  evidences: EvidenceRecord[]
}
三、Patch DSL

这是你后面接 LLM 最关键的一层。

目标：
LLM 不直接返回 HTML，不直接改 PM JSON，而是返回受限 patch。

1. 第一阶段只支持 8 类操作
type PatchOp =
  | { op: "replace_selection_text"; text: string }
  | { op: "replace_block_text"; blockId: string; text: string }
  | { op: "insert_paragraph_after"; afterBlockId: string; text: string }
  | { op: "delete_block"; blockId: string }
  | { op: "set_block_citations"; blockId: string; citationIds: string[] }
  | { op: "insert_citation_at"; blockId: string; offset: number; citationIds: string[] }
  | { op: "insert_figure_ref_at"; blockId: string; offset: number; targetId: string }
  | { op: "update_figcaption"; figureId: string; text: string }
2. Patch Envelope
type DocumentPatch = {
  patchId: string
  scope: {
    blockIds?: string[]
    selection?: {
      from: number
      to: number
    }
  }
  operations: PatchOp[]
  notes?: string[]
}
3. LLM 返回建议格式

你给 LLM 的提示要明确要求它返回 JSON，例如：

{
  "patchId": "patch_001",
  "scope": {
    "blockIds": ["p_12"]
  },
  "operations": [
    {
      "op": "replace_block_text",
      "blockId": "p_12",
      "text": "Van der Waals heterostructures have attracted extensive attention due to..."
    },
    {
      "op": "set_block_citations",
      "blockId": "p_12",
      "citationIds": ["cite_1", "cite_3"]
    }
  ],
  "notes": [
    "Rewrote the paragraph in a more academic tone.",
    "Preserved the original claim scope."
  ]
}
四、Patch 应用规则

Patch DSL 有了，不代表就能直接写进文档。
你还需要一层 Patch Executor。

1. 只允许改选定范围

比如用户只选中当前段落，那 patch 不准去改别的 block。

规则：

blockId 不在允许范围 → 拒绝
selection 越界 → 拒绝
2. citation 必须合法

规则：

citationIds 必须都在 registry 里存在
不允许模型自由造 (Smith, 2021) 文本来冒充系统 citation
3. figure_ref 必须能找到目标

规则：

targetId 对应 figure registry
找不到目标则不应用
4. block 替换不能破坏 schema

例如 replace_block_text 只能改纯文本内容，
不能偷偷把 paragraph 改成非法结构。

5. 所有 patch 默认“先预览，后接受”

第一阶段不建议让模型直接写入文档。
建议流程：

LLM 返回 patch
本地模拟应用，生成 preview
用户确认
真正写 transaction
五、编号与交叉引用怎么做

这层不要存在 node 真值里，
而是作为一个 derived state。

1. Figure numbering

扫描文档中的 figure 节点，按出现顺序生成：

{
  "fig_1": 1,
  "fig_2": 2
}

figure_ref(targetId="fig_2") 渲染时显示：

Figure 2
2. Citation numbering

如果你是 IEEE 风格，就扫描正文里的 citation node 出现顺序，得到：

{
  "cite_7": 1,
  "cite_2": 2,
  "cite_5": 3
}

然后渲染成 [1] [2] [3]。

如果以后切换 APA，逻辑 ID 不变，只是显示规则变。

六、导出前的中间层

你后面一定会需要这个，不然 docx/latex 会很痛。

建议从 PM 文档树导出成你自己的 AST：

type ExportBlock =
  | { type: "heading"; level: number; text: string; sectionId?: string }
  | { type: "paragraph"; children: ExportInline[] }
  | { type: "figure"; figureId: string; src: string; caption: ExportInline[] }
  | { type: "reference_list"; items: { refId: string; text: string }[] }

type ExportInline =
  | { type: "text"; text: string; marks?: string[] }
  | { type: "citation"; citationIds: string[] }
  | { type: "figure_ref"; targetId: string }

然后：

AST → DOCX
AST → LaTeX
AST → HTML/PDF

这样会比直接从 PM DOM 硬转稳很多。

七、第一阶段的最小技术边界

我建议你第一阶段 明确不做：

table
equation
footnote
comments
revision history
collaboration
complex bibliography style switching

先把下面做好就够了：

paragraph / heading
citation
figure + caption
figure_ref
LLM patch
basic export
八、我替你直接给一个第一阶段最小结论

如果你直接选 ProseMirror，那第一阶段最稳的设计是：

文档层
paragraph
heading
figure
citation
figure_ref
业务层
PaperRecord
CitationRecord
FigureRecord
EvidenceRecord
LLM 层
只返回 DocumentPatch
不直接写 HTML
不直接写 PM JSON
导出层
PM JSON → Export AST → docx/latex/pdf
九、最值得你马上定下来的三个决定
1. citation 用 node 还是 mark

我建议第一阶段用 inline atom node。

2. 编号存不存到文档里

我建议 不存，运行时推导。

3. LLM 是否能直接写 editor content

我建议 不能，只能返回 patch。