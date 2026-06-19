# 知识库模式与写作工作台方案

## 文档定位

本文基于 [`docs/discuss.md`](./discuss.md) 的讨论记录整理，目标不是重复 [`docs/rag-literature-knowledge-base.md`](./rag-literature-knowledge-base.md) 里已经确定的底层 RAG 数据模型，而是回答下面几个更偏产品与架构的问题：

1. 知识库能力怎样升级成一个真正可用的桌面写作工作台。
2. “知识库模式” 应该如何影响界面、下载流程、RAG 调用与模型。
3. 当前仓库应该怎样从单侧边栏读写器，过渡到面向学术写作的三栏工作台。

一句话概括：我们要做的不是“把 PDF 存起来再顺手接个聊天框”，而是一个以证据为核心、以结构化编辑为内核、以 DOCX 为输出格式的学术写作桌面应用。

## 核心结论

### 1. “知识库模式” 应视为工作区模式，不只是一个普通功能开关

从用户视角看，它当然可以在设置页表现为一个开关；但从系统语义看，它控制的是整套工作方式：

1. PDF 下载结果是否允许进入知识库。
2. 左右侧边栏的布局与默认可见性。
3. RAG 检索、证据包组装、LLM 对话是否可用。
4. 写作界面是否切换到“证据驱动”工作流。

因此内部实现更推荐建模为：

- UI 文案：`知识库模式`
- 内部状态：`workspaceMode = 'reader' | 'knowledge-base'`

这样做比继续把所有东西都塞进 `ragEnabled: boolean` 更稳，因为后者已经不足以表达“布局切换 + 下载准入 + 检索能力 + 对话面板”这组联动行为。

### 2. “只有开启知识库模式，PDF 下载才能进入知识库” 应解释为“禁止入库”，而不是“禁止普通下载”

建议明确成下面这条规则：

1. 知识库模式关闭时：
   - 允许继续像现在一样下载 PDF。
   - 但下载结果不触发知识库注册、不生成索引任务、不进入 RAG 检索域。
2. 知识库模式开启时：
   - 下载成功后的 PDF 才允许被登记为知识库文献文件。
   - 才允许创建解析、切片、embedding、rerank 相关任务。

这样既满足你“不开启就不允许进入知识库”的要求，也不会破坏当前仓库已有的基础阅读与导出流程。

### 3. 产品应走“三栏写作工作台”，而不是继续围绕单侧边栏扩展

讨论记录里最重要的方向其实已经很明确：

1. 左侧负责文献与证据管理。
2. 中间负责阅读、编辑与写作主画布。
3. 右侧负责 RAG、LLM、证据引用、改写建议。

这比“在现有 sidebar 上不断叠按钮”更适合后续扩展，也更符合桌面端学术写作的工作流。

### 4. 内部文档格式不应以 DOCX 为主，DOCX 应作为导出目标

这一点建议直接定为长期原则：

1. 内部编辑格式使用结构化富文本文档树。
2. citation 使用结构化节点，而不是纯文本 `(Smith, 2021)`。
3. LLM 输出结构化 patch / command，而不是整段重写全文。
4. DOCX 是编译输出格式，而不是内部真相源。

推荐优先路线仍然是：

- 编辑器：Tiptap / ProseMirror
- 引用：独立 citation model
- 输出：DOCX / Markdown / PDF

## 产品模式设计

### 模式一：普通阅读模式

定位：保持当前应用的“抓取 / 阅读 / 翻译 / 导出”基础能力。

行为定义：

1. 左侧显示 `secondarysidebar`。
2. 右侧 `auxiliarysidebar` 默认关闭。
3. PDF 可下载，但不会自动进入知识库。
4. 不提供基于知识库的 RAG 对话与证据插入。
5. 设置页仍可查看知识库配置，但相关高级能力置灰或只读。

### 模式二：知识库模式

定位：进入“文献管理 + 检索 + 证据驱动写作”工作流。

行为定义：

1. 左侧切换为 `primarysidebar`。
2. 右侧 `auxiliarysidebar` 默认展开。
3. PDF 下载成功后允许进入知识库，并触发入库链路。
4. RAG 检索、证据包组装、LLM 写作辅助可用。
5. 写作动作必须建立在可追溯证据之上。

## 三栏布局与部件命名

### 命名建议

为避免后续语义混乱，建议尽快统一内部部件命名：

1. 现有左侧栏重命名为 `secondarysidebar`
   - 它承接当前“抓取结果 / 文章列表 / 批量选择 / 日期筛选”这一套交互。
2. 新增左侧主栏 `primarysidebar`
   - 它承接知识库文献管理、集合、筛选、索引状态与入库任务。
3. 新增右侧栏 `auxiliarysidebar`
   - 它承接 RAG 检索、LLM 对话、证据预览、引用插入与写作建议。

这里的 `primary / secondary / auxiliary` 更适合作为内部工程命名；用户可见文案建议更直接：

1. `primarysidebar` 对外显示为“知识库”。
2. `secondarysidebar` 对外显示为“采集”或“来源”。
3. `auxiliarysidebar` 对外显示为“助手”或“证据助手”。

### 各侧边栏职责

#### `primarysidebar`

负责知识库主导航与文献管理，建议包含：

1. 文献列表
2. 收藏夹 / 项目集合 / 标签
3. 作者、年份、期刊、主题过滤
4. 入库状态与索引状态
5. 最近新增、待解析、待重建索引
6. 文献详情快捷入口

#### `secondarysidebar`

负责当前已有的采集与来源浏览流程，建议保留而不是删除：

1. 期刊源 / 抓取结果 / 阅读队列
2. 当前页面相关文章
3. 批量选择与下载入口
4. 非知识库模式下的主侧边栏角色

建议在知识库模式下不要彻底移除它，而是把它降级为辅助入口，例如：

1. 作为 `primarysidebar` 里的“采集”子视图。
2. 或作为工作区切换项，在需要补充文献时再打开。

这样可以保住现有能力，也避免知识库模式下失去“继续发现新文献”的入口。

#### `auxiliarysidebar`

负责右侧智能辅助面板，第一版建议至少包含三个区域：

1. 对话区
   - 用户问题、系统回答、引用到的证据列表。
2. 证据区
   - 展示本轮检索命中的 passage、页码、来源文献、相关度。
3. 动作区
   - 插入引用、根据证据起草段落、改写当前段落、总结当前小节。

后续可以继续扩展为标签页：

1. Chat
2. Evidence
3. Citations
4. Outline

### 模式切换时的布局行为

建议默认行为如下：

| 场景 | 左侧 | 中间 | 右侧 |
| --- | --- | --- | --- |
| 普通阅读模式 | `secondarysidebar` | reader / preview / future editor | 关闭 |
| 知识库模式 | `primarysidebar` | reader / editor | `auxiliarysidebar` 默认展开 |

补充建议：

1. 即使在知识库模式下，右侧栏也应允许手动收起。
2. 中间区不应强依赖右侧栏宽度，否则编辑体验会抖动。
3. 侧边栏展开状态与宽度应持久化，按模式分别记忆。

## Titlebar 调整建议

你的判断是对的，右侧栏必须有独立切换入口，且放在 DOCX 按钮左边是合理的。

建议 titlebar 调整为：

1. 保留现有左侧边栏切换按钮
   - 但语义改成“切换当前激活的左侧栏”。
2. 在 DOCX 导出按钮左侧新增“右侧助手栏”图标按钮。
3. 仅在知识库模式下显示该图标；普通阅读模式下可以隐藏或置灰。

建议的交互原则：

1. 进入知识库模式时，右栏默认展开一次，帮助用户理解产品形态。
2. 用户手动关闭后，后续记住其偏好。
3. 当用户触发“根据证据回答 / 起草 / 插引用”动作时，如果右栏关闭，可自动展开。

## 下载与入库链路

### 准入规则

为了避免语义含糊，建议把下载与入库拆成两个动作：

1. `download`
   - 获取 PDF 文件。
2. `registerToLibrary`
   - 将该文件登记为知识库文献文件，并触发后续索引链路。

其中：

1. 普通阅读模式只允许 `download`。
2. 知识库模式允许 `download + registerToLibrary`。

### 第一版建议的用户体验

1. 用户在知识库模式下点击下载 PDF。
2. 下载成功后自动执行注册。
3. 若注册失败，下载结果仍保留，但 UI 给出“下载成功、入库失败”的明确状态。
4. 若发现重复文献，则直接绑定到已有 `document`，并新增或更新 `document_file`。

### 不建议的做法

1. 不建议把“是否入库”完全埋在下载实现内部。
2. 不建议在普通模式下偷偷做半入库状态。
3. 不建议让下载失败与入库失败共用同一个错误文案。

## RAG 与模型方案

### 检索链路

继续沿用 [`docs/rag-literature-knowledge-base.md`](./rag-literature-knowledge-base.md) 已经明确的路线：

1. 词法召回：FTS / BM25
2. 稠密召回：embedding retrieval
3. 候选融合
4. 邻域扩展
5. reranker 精排
6. 证据包组装

这条链路应该服务写作，而不是只服务聊天，因此返回对象不应只是文本答案，而应是“证据包”：

1. 文本片段
2. 页码 / section / 邻接片段
3. 文献元数据
4. 证据 id
5. 可插入 citation 的结构化引用信息

### 检索范围建议

为了避免知识库越做越大后“什么都能搜到一点，但当前写作并不够准”，建议从第一版就把检索范围做成显式概念：

1. 全局知识库
   - 所有已入库文献。
2. 项目范围
   - 当前论文或当前写作任务挂载的文献集合。
3. 临时会话范围
   - 用户本轮手动钉住的若干篇文献或证据。

默认策略建议是：

1. 普通问答默认搜“当前项目范围”。
2. 用户显式要求时再扩展到全局知识库。
3. 右侧 `auxiliarysidebar` 里始终显示当前检索范围，并允许一键切换。

这样可以明显降低无关召回，也更符合论文写作时“围绕一个课题收束证据”的实际工作方式。

### 云端模型选择

你提到的方向基本合理，建议第一版默认接入：

1. Embedding：`Qwen3-Embedding-8B`
2. Reranker：`Qwen3-Reranker-8B`

但实现上不要把它们写死进核心流程，而应抽象成 provider：

1. `EmbeddingProvider`
2. `RerankerProvider`
3. `GenerationProvider`

这样后续才能平滑支持：

1. 其他云端模型
2. 不同供应商的 API 兼容层
3. 本地模型实验
4. 按项目切换模型策略

### 为什么需要 provider 抽象

因为 embedding、rerank、LLM 这三层的生命周期并不一致：

1. embedding 结果会持久化，并受模型版本影响。
2. reranker 多半是在线实时调用，可更换而不必全量重建库。
3. generation 更偏交互层，不应和底层索引结构耦死。

因此建议在索引和检索元数据里记录：

1. provider id
2. model id
3. model version
4. chunk version
5. parser version

这样将来切换模型时，系统才能明确知道哪些向量需要重建，哪些 rerank 配置只需重新查询即可。

### RAG 与 LLM 的关系

这里建议明确一条产品原则：

LLM 不是直接面向“整个知识库自由发挥”，而是只消费经过检索与筛选后的证据包。

也就是说：

1. 用户提问
2. 系统先检索并重排
3. 系统生成证据包
4. LLM 基于证据包回答、总结、起草或改写
5. 输出结果必须能回指到 evidence id / citation id

这条约束很重要，它决定了后面引用插入、事实追溯和“不能越证据边界改写”的可控性。

## 写作编辑器与引用模型

### 编辑器路线

结合讨论记录，推荐明确采用：

1. 编辑器内核：Tiptap / ProseMirror
2. 文档主格式：结构化 JSON 文档树
3. DOCX：导出目标，不作为内部主格式

### citation 不应是纯文本

建议从一开始就把 citation 定义为结构化节点，至少包含：

1. `citationId`
2. `documentId`
3. `evidenceIds`
4. `style`
5. `locator`
6. `renderedText`

其中 `renderedText` 只是显示层缓存，真正的引用真相源应该是结构化字段，避免模型直接拼装作者名和年份。

### LLM 不直接改全文，而是输出 patch

建议在知识库模式下尽早确立这条规则：

1. LLM 输出的是结构化编辑意图。
2. 系统把编辑意图编译成 patch / command。
3. patch 应用前必须校验范围、节点类型、citation 合法性和 evidence 绑定。
4. 用户确认后再落到 editor state。

这会比“整段替换文本”安全得多，也更适合撤销、审阅和引用校验。

## 设置项建议

设置页建议从“RAG 设置”升级为“知识库模式设置”，最少包含下面几组：

### 1. 模式与准入

1. `knowledgeBaseModeEnabled`
2. `autoRegisterDownloadedPdf`
3. `libraryStorageMode`
4. `managedLibraryDirectory`

其中 `autoRegisterDownloadedPdf` 只有在知识库模式开启时才生效。

### 2. 索引与检索

1. `embeddingProvider`
2. `embeddingModel`
3. `rerankerProvider`
4. `rerankerModel`
5. `indexingConcurrency`
6. `maxChunkTokens`

### 3. 对话与生成

1. `generationProvider`
2. `generationModel`
3. `maxContextEvidenceCount`
4. `citationInsertionStyle`

### 4. 布局偏好

1. `primarySidebarWidth`
2. `secondarySidebarWidth`
3. `agentSidebarWidth`
4. `agentSidebarCollapsedInReaderMode`
5. `agentSidebarCollapsedInKnowledgeBaseMode`

## 与当前仓库的接入建议

下面这些改动点是和当前代码结构最相关、也最值得优先落地的：

### 1. `layout.ts`

把当前单一 `sidebar` 扩展成多部件布局，建议新增：

1. `primarySidebar`
2. `secondarySidebar`
3. `agentSidebar`

同时把“当前活跃左侧栏”和“右侧栏是否展开”做成显式布局状态，而不是只保留一个 `isSidebarVisible`。

### 2. `workbenchView.ts`

把当前工作台从“页面切换”升级为“页面 + 工作区模式 + 边栏状态”的组合状态：

1. 页面仍可保留 `reader / settings`
2. 新增 `workspaceMode`
3. 根据 `workspaceMode` 决定渲染哪个左侧栏、右侧栏是否默认展开

### 3. 当前 `sidebarPart.ts`

现有实现建议保留主体逻辑，但语义上迁移为 `fetchPanePart`，减少一次性重写风险。

### 4. 新增 `primarySidebarPart`

这一部分负责：

1. 知识库文献列表
2. 过滤器
3. 入库任务状态
4. 文献详情快捷动作

第一版不必做得很重，哪怕先只显示文献列表、状态和搜索框，也已经足够支撑后续演进。

### 5. `titlebarView.ts`

新增右侧边栏 toggle，并让左侧 toggle 适配多左栏模型。

### 6. 设置模型

当前仓库里已有 `ragEnabled`、知识库目录与存储模式等字段。建议做一次命名升级：

1. `ragEnabled` 迁移为 `knowledgeBaseModeEnabled`
2. 继续保留现有知识库目录与存储模式设置
3. 新增模型 provider、模型名、并发度、布局偏好

这样可以减少后期“明明是模式开关，却叫 ragEnabled”的语义错位。

## 分阶段实施建议

### Phase 1：知识库模式与多侧边栏骨架

目标：先把“产品模式”和“布局骨架”搭起来。

1. 引入 `knowledgeBaseModeEnabled` 或 `workspaceMode`
2. 下载与入库动作解耦
3. 当前 sidebar 重命名为 `secondarysidebar`
4. 新建 `primarysidebar`
5. 新建 `auxiliarysidebar`
6. titlebar 增加右栏 toggle
7. 按模式持久化左右边栏状态

### Phase 2：知识库全文索引与混合检索

目标：补齐真实 RAG 能力，而不是只停留在文献登记。

1. PDF 解析
2. raw blocks / passages
3. FTS / BM25
4. embedding 索引
5. rerank 接口
6. evidence package 组装

### Phase 3：辅助侧栏与证据对话

目标：让右侧 `auxiliarysidebar` 成为真正可用的工作面板。

1. 聊天 UI
2. 检索证据列表
3. 回答中的引用跳转
4. 从证据插入 citation
5. 从当前选择文本发起“基于证据改写”

### Phase 4：结构化写作编辑器

目标：从“阅读器 + 助手”走到“真正的写作工作台”。

1. 引入 Tiptap / ProseMirror
2. citation node
3. evidence binding
4. patch engine
5. 用户确认后应用 patch

### Phase 5：导出与高保真互通

目标：把内部结构化内容稳定输出为交稿格式。

1. 导出 DOCX
2. 导出 Markdown / PDF
3. citation style 渲染
4. 参考文献列表生成
5. 逐步增强 Word 互通保真度

## 当前建议的默认决策

如果现在就要开始拆任务，我建议直接采用下面这些默认决策：

1. “知识库模式” 是产品主模式，内部最好不是简单 `ragEnabled`。
2. 模式关闭时不禁止普通 PDF 下载，只禁止进入知识库。
3. 左侧新建 `primarysidebar`，现有 sidebar 重命名为 `secondarysidebar`。
4. 右侧新增 `auxiliarysidebar`，默认在知识库模式下展开。
5. titlebar 在 DOCX 左侧新增右栏 toggle。
6. Embedding 默认接 `Qwen3-Embedding-8B`。
7. Reranker 默认接 `Qwen3-Reranker-8B`。
8. 模型采用 provider 抽象，不把供应商写死到核心流程里。
9. 检索默认优先限定在“当前项目 / 当前集合”范围，而不是直接扫全库。
10. 编辑器长期路线选 Tiptap / ProseMirror，不以 DOCX 为内部主格式。
11. LLM 必须消费证据包并输出结构化 patch，而不是自由改全文。

## 一句话总结

这个项目下一阶段最合理的形态，不是“给现在的阅读器加一个 RAG 功能”，而是把它升级成一个以知识库模式驱动、以三栏布局承载、以证据包约束 LLM、以结构化编辑器为核心、最终导出 DOCX 的学术写作工作台。
