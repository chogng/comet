# 文献知识库 RAG 设计方案

## 背景

我们接下来想做的，不只是“把 PDF 切片后存起来”，而是把已下载文献变成一个可检索、可追溯、可持续增量更新的内部知识库，服务后续论文写作。

对这个场景来说，目标不是单点追求向量相似度，而是同时满足下面三件事：

1. 高召回：相关证据尽量不要漏。
2. 高精度：真正相关的片段能排到前面。
3. 强可追溯：每个片段都能回指到文献、章节、页码和原始文件。

这意味着我们最终要做的是“面向论文写作的证据检索系统”，而不只是一个普通聊天问答式 RAG。

## 当前仓库现状

结合当前代码，可以先明确几个边界：

1. 当前 `Article` 还是“抓取摘要级”结构，只包含标题、作者、摘要/描述、DOI、发布日期、来源 URL 等字段，还没有全文块、页码锚点和章节结构。
   参考：[`desktopTypes.d.ts`](../src/ls/base/parts/sandbox/common/desktopTypes.d.ts)
2. 已经支持 PDF 下载和 DOCX 导出，但 `preview_download_pdf` 只返回下载结果 `filePath`，当前没有把“文献元数据 <-> 本地 PDF <-> 全文索引”绑定成长期知识库记录。
   参考：[`ipc.ts`](../src/ls/code/electron-main/ipc.ts)
3. 当前本地持久化主要只有三类：
   - 配置：`~/.reader/config/config.json`
   - 抓取历史：`~/.reader/data/history.json`
   - 翻译缓存：`~/.reader/data/translation-cache.json`
   参考：[`environmentMainService.ts`](../src/ls/platform/environment/electron-main/environmentMainService.ts)
4. `StorageService` 目前也只暴露了抓取历史、翻译缓存和设置相关能力，没有知识库、索引任务、全文检索这些接口。
   参考：[`storage.ts`](../src/ls/platform/storage/common/storage.ts)
5. `historyStore` 里已经有一段很重要的注释，明确指出“抓取历史不应该等同于长期数据库”，后续应该由专门流程决定哪些文献被提升为长期持久化数据。
   参考：[`historyStore.ts`](../src/ls/platform/storage/electron-main/historyStore.ts)

所以，从仓库现状出发，RAG 更像是在现有“抓取/下载/导出”工作台之上，新建一层“知识库与证据检索”能力，而不是在现有 `history.json` 上继续堆字段。

## 设计目标

### 业务目标

1. 下载过的文献可以自动进入可索引状态。
2. 同一篇文献重复下载、重复入库时可以去重。
3. 写论文时可以按主题、方法、结论、实验现象等方式快速召回相关证据。
4. 返回结果必须带出处，方便后续核对与引用。
5. 后续可以继续做“论文写作助手”，但生成层必须建立在可追溯证据之上。

### 工程目标

1. 采用增量入库，避免每次全量重建。
2. 长耗时任务不阻塞 Electron 主线程。
3. 检索链路可观测，可评估，可调参。
4. 数据模型允许以后扩展到 HTML 正文、OCR、图表说明、笔记批注等更多来源。

### 非目标

第一阶段不追求：

1. 直接做一个“无出处自由写作”的生成器。
2. 一开始就覆盖所有文件格式；建议先以 PDF 为主。
3. 一开始就引入非常重的分布式服务；优先做本地单机可用方案。

## 核心原则

### 1. 保留原始证据，不只保留重排结果

“切片重排存起来”是有必要的，但不能只保留重排后的块。建议同时保留两层：

1. `raw blocks`
   PDF 提取器给出的原始文本块或段落，保留最接近原文的顺序和位置。
2. `canonical passages`
   在清洗页眉页脚、合并断行、恢复章节结构后得到的规范检索片段。

这样做的价值是：

1. 检索和重排时用 `canonical passages`，提高相关性。
2. 回显证据和定位页码时仍然能追到 `raw blocks`，降低“重排后失真”的风险。

### 2. 召回层和排序层分开

对论文写作，单一检索方式通常不够：

1. 词法检索适合命中术语、基因名、药物名、方法名、DOI、缩写。
2. 向量检索适合命中语义相近但措辞不同的表述。
3. 重排层适合从高召回候选里挑出真正相关证据。

所以推荐走“三段式”：

1. 高召回候选：`BM25/FTS + dense retrieval`
2. 候选融合与邻域扩展
3. reranker 精排

### 3. 写作上下文不是简单 top-k

论文写作常常需要：

1. 多篇文献的交叉证据
2. 同一主题下的方法、结果、局限性分层展示
3. 避免上下文被一篇长文献独占

因此最终拼装上下文时，要做“去重 + 多样性 + 邻近扩展 + 来源覆盖”，而不是只取相似度最高的前几块。

## 总体架构

建议采用下面这条主链路：

1. 文献注册
   下载 PDF 或手动导入后，先登记文献元数据、来源 URL、文件路径、文件哈希。
2. 入库任务
   后台任务读取 PDF，提取全文、页码、章节、图表说明等结构。
3. 文本清洗与结构恢复
   去页眉页脚、去断行、段落合并、章节识别、参考文献区识别。
4. 切片与重排
   生成适合检索的 `canonical passages`，同时保留 `raw blocks`。
5. 索引构建
   为片段建立词法索引、向量索引、元数据过滤索引。
6. 检索与重排
   查询时先高召回，再精排，再组装证据包。
7. 写作调用
   后续论文写作或内部助手只消费“证据包”，并始终带出处。

## 数据模型

第一阶段建议把知识库的“权威真相源”放进本地数据库，而不是继续堆 JSON 文件。原因很直接：

1. 文献、文件、切片、向量、任务状态之间是多表关系。
2. 需要事务、去重、过滤、排序和全文检索。
3. 后续一定会出现重建索引、版本迁移和局部重算。

推荐的数据对象如下。

### 1. documents

代表一篇逻辑文献。

建议字段：

1. `document_id`
2. `title`
3. `doi`
4. `authors`
5. `journal_title`
6. `published_at`
7. `source_url`
8. `source_id`
9. `language`
10. `ingest_status`
11. `created_at`
12. `updated_at`

### 2. document_files

代表一个具体文件版本，允许一篇文献对应多个文件来源。

建议字段：

1. `file_id`
2. `document_id`
3. `file_path`
4. `storage_mode`
   - `linked-original`
   - `managed-copy`
5. `file_sha256`
6. `file_size`
7. `mime_type`
8. `downloaded_at`
9. `extractor_version`
10. `parse_status`

### 3. raw_blocks

代表 PDF 提取器输出的原始块。

建议字段：

1. `block_id`
2. `file_id`
3. `page_number`
4. `reading_order`
5. `text`
6. `bbox`
7. `block_type`
   - `paragraph`
   - `heading`
   - `caption`
   - `table`
   - `footer`
   - `reference`

### 4. passages

代表经过清洗和重排后的规范检索片段，也是检索主单位。

建议字段：

1. `passage_id`
2. `document_id`
3. `file_id`
4. `section_path`
   例如：`Introduction > Related Work`
5. `section_kind`
   例如：`abstract`、`methods`、`results`、`discussion`
6. `content_kind`
   例如：`body`、`caption`、`table-note`
7. `page_start`
8. `page_end`
9. `reading_order_start`
10. `reading_order_end`
11. `text`
12. `normalized_text`
13. `token_count`
14. `prev_passage_id`
15. `next_passage_id`
16. `source_block_ids`
17. `parser_version`
18. `chunk_version`

### 5. passage_embeddings

代表 passage 的向量表示。

建议字段：

1. `passage_id`
2. `embedding_model`
3. `embedding_version`
4. `vector`
5. `created_at`

### 6. indexing_jobs

代表后台入库任务。

建议字段：

1. `job_id`
2. `document_id`
3. `file_id`
4. `job_type`
   - `register`
   - `extract`
   - `chunk`
   - `embed`
   - `reindex`
5. `status`
6. `error_code`
7. `error_message`
8. `attempt_count`
9. `started_at`
10. `finished_at`

## 切片与重排策略

“准确高召回”的关键，很多时候不在模型，而在 chunk 设计。

### 推荐做法

1. 先按结构切，不要一开始就固定字符数硬切。
   优先使用章节标题、段落边界、图表说明边界。
2. 对正文段落做二次切分。
   当段落过长时，再按句子边界或语义边界切成检索片段。
3. 保留适度 overlap。
   让跨句关系不要被硬截断。
4. 抽象、引言、结果、讨论要单独标记。
   这些区段在不同查询意图里权重不同。
5. 参考文献区要单独识别。
   默认不参与常规正文检索，避免高频术语把召回拉偏。
6. 图表标题和表注单独成块。
   论文里很多关键信息只出现在 figure legend 或 table note。

### 第一版参数建议

可先从保守参数开始：

1. 目标片段大小：约 `250-450` 英文 token，或中文相近信息量
2. overlap：`15%-20%`
3. 邻域扩展：命中后默认带上前后各 `1` 个 passage
4. 单个 section 内过长内容允许继续拆分，但不要跨 section 合并

### 为什么要同时存“原始顺序”和“规范顺序”

因为 PDF 提取常见问题包括：

1. 双栏顺序错乱
2. 页眉页脚混入正文
3. 公式和图注打断段落
4. 跨页段落断裂

如果只存最终 chunk，很难回头排查是哪一步清洗出了问题；保留 `raw_blocks` 后，后续可以单独优化结构恢复逻辑，而不用重新定义整套数据模型。

## 入库流程

### 触发方式

建议支持三种入口：

1. PDF 下载成功后自动入库
2. 手动选择本地 PDF 导入
3. 针对已有文献执行“重新建索引”

第一阶段最值得先接的是第 `1` 条，因为当前工作台已经有稳定的 PDF 下载入口。

### 任务步骤

建议每个入库任务按下面的阶段推进：

1. `register`
   记录文件路径、文件哈希、元数据和去重键。
2. `extract`
   提取页面文本、段落、标题、图注等。
3. `normalize`
   去噪、合并断行、修正顺序、识别 section。
4. `chunk`
   生成 `passages` 和邻接关系。
5. `embed`
   批量生成向量。
6. `index`
   写入词法索引和向量索引。
7. `verify`
   抽样验证页码、章节和内容覆盖率。

### 去重策略

建议至少组合以下键：

1. `doi`
2. `file_sha256`
3. `normalized(title) + first_author + year`

这样能覆盖：

1. 同文件重复下载
2. 同文献不同下载路径
3. 没 DOI 但元数据相同的预印本或网页导出 PDF

## 检索与重排流程

### 1. 查询理解

用户的写作查询通常不是单纯问答，而是以下几类之一：

1. 概念定义
2. 方法比较
3. 结果证据
4. 争议点/局限性
5. 指定术语或 DOI 精确查找

建议先做轻量查询理解，提取：

1. 关键词
2. 同义表达
3. 过滤条件
   例如年份、期刊、作者、指定文献
4. 查询意图
   例如偏“overview”还是偏“evidence”

### 2. 高召回候选

建议并行走三路：

1. 词法检索
   用于命中专有名词、缩写、精确短语、DOI。
2. 向量检索
   用于命中语义相近表达。
3. 元数据过滤召回
   用于限定年份范围、期刊、作者、文献集合。

这里的目标不是“直接给最终答案”，而是把候选集尽量补全。

### 3. 候选融合

候选融合建议做这些事：

1. 按 `document_id + passage_id` 去重
2. 合并词法分数和向量分数
3. 对 `abstract`、`results`、`discussion`、`caption` 等不同 `section_kind` 做轻量加权
4. 对过于密集来自同一篇文献的结果做适度截断，保留文献多样性

### 4. 邻域扩展

只靠单个命中 passage 往往上下文不够。建议在融合后做邻域扩展：

1. 取命中块前后相邻块
2. 同 section 内向外扩一小段
3. 对图注命中时把图前后正文一并纳入候选

### 5. reranker 精排

reranker 的作用是从高召回候选里选出最适合写作的证据。

reranker 重点判断：

1. passage 是否真正回答当前写作意图
2. 是否比其他候选更具体、更可引用
3. 是否需要偏向结果、方法或讨论部分

### 6. 证据包组装

最终返回给写作层的，不应只是裸文本，而应是 `evidence bundle`：

1. `passage text`
2. `document title`
3. `authors`
4. `journal`
5. `year`
6. `doi`
7. `section_path`
8. `page_start-page_end`
9. `source_url`
10. `file_path`
11. `score`
12. `why_matched`

这样后续无论是“生成草稿”还是“手工写作辅助”，都能保持可追溯。

## 为什么不建议只做向量检索

如果只做向量检索，会很容易丢掉这些高价值命中：

1. 基因、药物、蛋白、数据集、方法缩写
2. DOI、PMID、具体型号、实验条件
3. 专用术语的精确短语

而论文写作对这些点非常敏感，所以混合检索是更稳妥的默认方案。

## 建议的本地存储形态

### 权威存储

建议新增一个知识库主存储，例如：

1. `~/.reader/data/library.sqlite`

用途：

1. 文献元数据
2. 文件注册
3. raw blocks
4. passages
5. 索引任务状态

### 受管文件目录

如果后续选择“复制一份进知识库”，可以预留：

1. `~/.reader/data/library-files/`

但第一阶段也可以先只记录原始下载路径，不强制复制文件。

### 缓存目录

建议为解析与向量构建留单独缓存目录，例如：

1. `~/.reader/cache/rag/`

用于：

1. 页面提取中间结果
2. OCR 临时文件
3. 向量批处理缓存

## 技术选型决策

### 1. 为什么第一阶段不选 PostgreSQL

当前项目是本地单机 Electron 应用，不是天然的服务端系统。对这个阶段来说，`PostgreSQL` 并不是最优默认选项，原因主要有：

1. 它会引入额外的安装、启动、升级、迁移和备份复杂度。
2. 桌面应用分发时，需要额外处理数据库服务依赖，不利于开箱即用。
3. 当前场景主要是个人知识库，不是多用户并发写入，也不是远程共享服务。
4. 当前真正的难点首先是 PDF 提取、chunk 设计、检索策略和可追溯性，而不是数据库横向扩展。

因此，第一阶段更合理的选择是：

1. 原始文件放文件系统
2. 结构化数据放 `SQLite`
3. 检索索引按需要内嵌在 `SQLite` 或以 sidecar index 形式存在

只有在下面这些条件逐渐成立时，才建议重新评估 `PostgreSQL + pgvector` 一类方案：

1. 需要多设备同步
2. 需要团队共享知识库
3. 需要把检索与写作能力服务端化
4. 单机本地库规模和任务并发已经明显超出桌面应用舒适区

### 2. 文献应该怎么存

“一篇文献内容很多”这个判断是对的，但这不等于“必须把原始 PDF 二进制塞进数据库”。更推荐的是分层存储：

1. 原始 PDF
   放文件系统，数据库里只记录 `file_path`、`file_sha256`、大小、来源和注册状态。
2. 文献元数据
   放数据库，包括标题、作者、DOI、期刊、年份、来源 URL 等。
3. 解析结果
   放数据库，包括 `raw_blocks`、`passages`、页码锚点、章节结构、任务状态。
4. 检索索引
   词法索引可以依附数据库；向量索引可以先随数据库版本化管理，后续再按性能需要拆分。

这样做的原因是：

1. 原始文件最适合文件系统管理，不需要为 BLOB 存储支付额外复杂度。
2. 真正要参与检索和重排的是“解析后的文本单元”，这些结构化内容非常适合数据库。
3. 对个人文献库来说，全文纯文本和 passage 级数据量通常远小于原始 PDF 二进制体积，本地数据库完全可以承载第一阶段和后续相当长一段时间的需求。

换句话说，应该进数据库的是：

1. 文献元数据
2. 文件登记记录
3. 全文解析结果
4. passage 级切片
5. 检索与索引状态

不建议第一阶段直接进数据库的是：

1. 原始 PDF 文件本体

### 3. ranking / reranking 是否需要云端模型

这里建议把问题拆开看：

1. `retrieval`
   负责高召回地找候选。
2. `reranking`
   负责从候选里把最相关、最可引用的证据排到前面。

对这个项目来说，我不建议一开始就把效果希望押在“本地 reranker 足够强”这个假设上。原因是学术场景对模型要求比较苛刻：

1. 文本里会有术语、缩写、公式残留和 PDF 噪声
2. 查询经常是中英混合或学术表达改写
3. 结果不仅要相关，还要适合写作和引用

因此，更稳的判断是：

1. 本地模型可以做离线 fallback
2. 云端模型更适合作为高质量基线
3. 第一阶段先不强依赖模型 reranker 也完全可以开始做

更具体地说：

1. 第一阶段
   不强依赖云端 reranker。先把 `PDF 解析 + chunk + 页码锚点 + FTS/BM25 + 邻域扩展` 做好，先拿到可用基线。
2. 第二阶段
   把 reranker 接口做成可插拔，并优先支持云端高质量模式。
3. 第三阶段
   再评估本地 reranker，作为离线模式、低成本模式或隐私优先模式。

### 4. 为什么不建议过早争论“本地模型能不能打平云端模型”

在 RAG 里，排序效果不只由 reranker 决定。更常见的瓶颈顺序其实是：

1. PDF 提取质量不够
2. chunk 设计不合理
3. section / page anchor 丢失
4. 候选召回不完整
5. 最后才是 reranker 质量

所以更稳妥的路线是：

1. 先把“证据质量”和“候选质量”做对
2. 再引入云端 reranker 作为质量上限
3. 最后再看本地模型是否能在你的语料上达到可接受替代效果

### 5. 当前建议的明确选型

为了让后续实现不摇摆，这里把建议说得更具体一些：

1. 知识库主存储：`SQLite`
2. 原始 PDF：文件系统，不直接存数据库 BLOB
3. 第一阶段数据库内容：文献元数据、文件登记、解析块、passages、任务状态
4. 检索基线：先做 `FTS/BM25 + metadata + 邻域扩展`
5. rerank 策略：接口先预留，质量模式优先支持云端，离线模式再支持本地
6. 是否上 PostgreSQL：当前不作为默认方案

## 与当前仓库的接入点

### 1. 环境路径

建议在 [`environmentMainService.ts`](../src/ls/platform/environment/electron-main/environmentMainService.ts) 增加：

1. `libraryDbFile`
2. `libraryFilesDir`
3. `ragCacheDir`

### 2. StorageService

建议把当前 `StorageService` 拆成“现有轻存储 + 新知识库存储”两层，至少新增这些能力：

1. `registerLibraryDocument`
2. `enqueueIndexJob`
3. `getIndexJobStatus`
4. `searchLibrary`
5. `listLibraryDocuments`
6. `reindexDocument`
7. `removeLibraryDocument`

### 3. IPC 命令

参考当前 [`ipc.ts`](../src/ls/code/electron-main/ipc.ts) 的模式，建议后续新增：

1. `import_local_pdf`
2. `index_downloaded_pdf`
3. `get_library_document_status`
4. `search_library`
5. `reindex_library_document`
6. `list_library_documents`

第一阶段里，`preview_download_pdf` 成功后可以选择：

1. 直接同步触发轻量注册
2. 然后异步排队后台索引

这样用户下载 PDF 后不需要二次操作。

### 4. 设置项

当前设置页已经有很好的模型：渲染层 `settingsModel` 管状态，主进程 `save_settings` 做持久化。RAG 也建议沿用这个模式。

可新增设置项：

1. `ragEnabled`
2. `autoIndexDownloadedPdf`
3. `libraryStorageMode`
   - `linked-original`
   - `managed-copy`
4. `libraryDirectory`
5. `embeddingProvider`
6. `embeddingModel`
7. `rerankProvider`
8. `rerankModel`
9. `maxConcurrentIndexJobs`

### 5. 模块目录建议

建议新增目录：

1. `src/ls/code/electron-main/rag/`

下面再按职责拆分：

1. `registry/`
2. `ingest/`
3. `extract/`
4. `chunk/`
5. `retrieve/`
6. `rerank/`
7. `jobs/`
8. `citation/`

## 后台执行模型

PDF 解析、OCR、embedding 都属于长耗时或重 CPU/重 I/O 任务，不建议直接堆在 Electron 主线程里。

建议：

1. 主进程负责接收命令、更新状态、发起任务
2. 真正的解析与索引构建放到后台 worker
3. 渲染层通过 IPC 订阅任务状态

第一阶段如果想先快一点落地，可以：

1. 先做单并发后台任务队列
2. 再在第二阶段把重任务迁到独立 worker

但长期看，RAG 这层最好从一开始就按“后台任务”思路建模。

## 评估与优化指标

如果我们后续要持续做“推理优化”，那第一天就要想好怎么评估，不然只能凭感觉调。

### 入库质量指标

1. 文本提取成功率
2. 平均页码覆盖率
3. section 识别成功率
4. chunk 平均长度与离散度
5. OCR 回退比例

### 检索效果指标

1. `document recall@k`
2. `passage recall@k`
3. `MRR`
4. `nDCG`
5. 命中文献多样性

### 写作效果指标

1. 证据支持率
   生成句子是否都能被证据包支撑
2. 引用可追溯率
   返回片段是否能定位回页码/章节
3. 无依据陈述率
4. 单次检索延迟

### 建议尽早建立的小型评测集

建议先人工整理一个小而稳的 benchmark：

1. `20-50` 篇已下载文献
2. `30-100` 条典型写作查询
3. 每条查询标出应命中的文献和关键段落

后面每次调这些参数时，都回归测试：

1. chunk 大小
2. overlap
3. section 加权
4. 候选数
5. rerank 截断数
6. query rewrite 策略

## 分阶段实施建议

### Phase 1：知识库骨架

目标：先把“下载 PDF -> 登记文献 -> 可追踪状态”打通。

包含：

1. 新增知识库存储
2. 文献/文件注册表
3. PDF 下载成功后的自动登记
4. 入库任务状态模型
5. 设置项和基础状态展示

### Phase 2：全文提取与基础检索

目标：先做可用的本地全文搜索，不急着一上来追求最强模型。

包含：

1. PDF 文本提取
2. raw blocks 与 passages 落库
3. 基础 chunking
4. 词法检索
5. 命中结果页码回显

### Phase 3：混合检索与高召回优化

目标：把“词法可用”升级到“语义 + 词法混合”的写作级召回。

包含：

1. embedding 接口抽象
2. passage 向量化
3. 混合检索融合
4. 邻域扩展
5. section 权重调优

### Phase 4：rerank 与写作证据包

目标：让结果从“能搜到”变成“适合直接写”。

包含：

1. reranker
2. evidence bundle
3. 查询意图识别
4. 去重与多样性控制
5. 引用格式化

### Phase 5：论文写作集成

目标：把知识库真正接到后续写作流程里。

包含：

1. 内部知识库搜索面板
2. 写作时的主题检索与证据插入
3. 按 claims 组织的引用建议
4. 生成内容与证据的绑定关系

## 推荐的实现顺序

如果要控制风险，推荐按下面顺序推进：

1. 先做知识库数据模型和任务状态，不急着接复杂模型。
2. 先打通 PDF 注册和基础全文入库。
3. 先上词法检索，拿到第一版“可定位全文搜索”。
4. 再加 embedding 和混合检索。
5. 最后再做 rerank、query rewrite 和写作集成。

这条路线的好处是：

1. 每一步都能独立验收
2. 不会因为 embedding 或 rerank 方案还没定就卡住整个项目
3. 很适合当前仓库“先把本地工作台能力一层层补齐”的节奏

## 当前建议的默认决策

为了减少前期讨论成本，我建议先默认下面这些选择：

1. 文件格式：先只支持 PDF
2. 存储形态：`SQLite + 文件系统`，知识库单独存储，不复用 `history.json`，第一阶段不选 PostgreSQL
3. 下载接入：PDF 下载成功后自动入库
4. 检索策略：从第一天就按“词法 + 语义 + rerank”的架构预留接口，但先落地 `FTS/BM25 + metadata + 邻域扩展`
5. rerank 策略：先做可插拔接口，高质量模式优先云端，本地模型作为可选 fallback
6. 证据模型：必须带页码、章节、DOI、来源 URL
7. 执行方式：后台任务队列，而不是同步阻塞主线程

## 后续可以直接拆的实现任务

文档落地后，下一轮可以直接按下面的顺序拆开发任务：

1. 扩展环境路径与设置模型，为知识库预留文件位置和开关
2. 设计并实现知识库存储接口
3. 在 PDF 下载成功后登记文献与文件记录
4. 补一个“手动导入本地 PDF”命令
5. 接入 PDF 提取与基础 chunking
6. 做第一版全文检索与状态 UI

## 一句话总结

对当前项目来说，最稳妥的路线不是“先塞一个向量库试试看”，而是先把“文献注册、全文解析、规范切片、混合检索、证据追溯”这条链路搭成一个真正的本地知识库系统。这样后面无论做推理优化、写作辅助还是自动引用，都会有稳定地基。
