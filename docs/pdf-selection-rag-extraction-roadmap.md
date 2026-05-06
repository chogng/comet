# PDF 选区与 RAG 提取路线

## 背景

这份文档记录一次 PDF 阅读器选区问题的架构判断，并把后续 RAG、文档解析、MinerU 参考边界放在同一条路线里考虑。

当前问题不是单个交互 bug。截图中的论文首页 affiliation 行属于典型难例：小字号、斜体、上标编号、无框空格、视觉行与 PDF 内部字符框不完全一致。用户看到的是一整行，但当前实现看到的是一组高度不稳定、中心线漂移、部分字符缺少几何框的 PDFium char boxes。继续在 `PdfSelectionController` 里堆局部容差，会让问题越来越碎。

因此后续目标应该是：

1. PDF 阅读器选区要有稳定的文本命中、range、rect 与 anchor 模型。
2. PDF 全文提取要能服务 RAG，不只服务屏幕选区。
3. 交互阅读和离线解析可以共享页码、坐标、文本范围、段落结构等概念，但不要互相绑死。
4. 后续参考 MinerU 这类文档解析工具的设计思路，建立我们自己的 Markdown / JSON / layout blocks / OCR / table / formula 提取管线。

## 决策摘要

这份文档较长，先把核心决策收束如下：

1. Reader selection 走 PDFium text index + PDF-space rect，不走 DOM selection 作为事实来源。
2. Reader selection 和 document parsing 分成两条链路；前者低延迟，后者异步、可重建。
3. 基础 selection 门禁先用自建 smoke PDF，文本固定为 `Literature Studio PDF smoke`。
4. `pdfium-lite` 是第一阶段 ingest 后端，只做轻量文本、行、段落、证据回指。
5. `ls-structured` 是后续自研结构化解析器，不直接引入 MinerU。
6. MinerU、Edge、MuPDF、PDF.js 都是参考对象；其中 MinerU 只参考输出形态和评测思路，不进入运行时依赖。
7. 所有 RAG passage 必须带 evidence pointer，可以回到 document、page、bbox/rect、quote。
8. 所有 parser artifact 和 index 都是派生数据，可 stale、可重建、可清理。
9. 默认开启功能必须通过 license、schema、selection、parser、RAG evidence、performance、privacy、UX gate。

## 文档结构

建议按这个顺序阅读：

1. `核心判断`：先看两条链路和共同证据坐标。
2. `推荐架构`：看核心数据模型。
3. `具体优化方案`：看 reader、ingest、RAG、CI、fixture、artifact、job 的落地方案。
4. `阶段路线`：看先后顺序。
5. `实施 Checklist`：拆任务用。
6. `门禁策略`：决定能否合入、能否默认开启。

## 当前实现的风险

现有 PDF reader 主要由这些模块承担：

1. `src/ls/editor/browser/pdf/pdfDocumentReader.ts`
   负责 PDFium 加载、页面渲染、文本字符提取、highlight overlay。
2. `src/ls/editor/browser/pdf/pdfLayoutModel.ts`
   根据 PDFium 字符框重建行、排序、选区矩形。
3. `src/ls/editor/browser/pdf/pdfSelectionController.ts`
   根据 pointer 事件查找文本边界并生成 selection。

主要风险：

1. `FPDFText_GetCharBox` 是字符内部框，不等于用户肉眼看到的可选中区域。
2. 空格、换行、上标、脚注编号可能没有稳定 char box，导致同一视觉行被拆开。
3. 起选依赖 strict hit test 时，短距离横拖很容易因为第一下没命中而完全失败。
4. 选区几何、复制文本、标注 anchor、后续 RAG chunk 如果各自建立模型，会产生互相对不上的证据链。
5. 现有布局模型更偏 reader interaction，还没有完整的文档解析语义，例如标题、段落、图表、公式、引用、阅读顺序置信度。

## 外部参考

### PDF.js

PDF.js 的典型思路是 canvas 渲染 PDF，再叠加透明 text layer。text layer 由绝对定位的 DOM span 组成，让浏览器原生 selection 参与文本选择。

启发：

1. 视觉渲染和文本命中层分离。
2. selection 需要一个覆盖在 canvas 上的文本语义层。
3. 坐标、缩放、字体度量要被系统化处理，不能靠零散 DOM 事件。

不建议直接照搬：

1. Literature Studio 需要稳定 annotation anchor 和 RAG 证据回指，DOM selection 不是足够稳定的事实来源。
2. 浏览器 selection 很难直接给出跨渲染、跨缩放、跨解析后端稳定的 PDF-space range。

参考：

- https://github.com/mozilla/pdf.js
- https://github.com/mozilla/pdf.js/blob/master/src/display/text_layer.js

### PDFium / Chromium

Chromium PDF viewer 基于 PDFium，核心模式更接近：

```text
screen point
  -> page index
  -> PDF page coordinate
  -> text index / char boundary
  -> selected text range
  -> PDF-space rects
  -> viewer overlay
```

启发：

1. selection 的事实来源应该是 page + text index range，而不是 DOM range。
2. highlight rect 应尽量由 PDF 引擎对文本 range 生成，再做轻量归并。
3. 坐标系需要以 PDF page coordinate 为中心，viewport 只是渲染映射。

参考：

- https://pdfium.googlesource.com/pdfium/
- https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_text.h

### Microsoft Edge PDF Reader

Edge 的 PDF 阅读器是很重要的产品体验参考。它的价值不只是“能打开 PDF”，而是把 PDF 当成一类完整文档工作台：阅读、搜索、缩放、目录、页视图、highlight、text notes、ink、表单、Read Aloud、翻译、保存，以及企业级安全可靠性。

对 Literature Studio 的启发：

1. PDF reader 应该有稳定的基础阅读体验：zoom、rotate、fit to width/page、jump to page、search、TOC/page view。
2. selection 后应该能自然衔接 highlight、comment、translate、explain、copy、evidence capture。
3. annotation 不只是画 overlay，还要能保存、回显、编辑、删除，并和原 PDF 坐标长期绑定。
4. accessibility 是阅读器基础能力，不是最后补丁：键盘、caret mode、高对比度、screen reader 都要进入长期计划。
5. 安全可靠性必须是 reader 设计的一部分，PDF 文件来自本地、网络、嵌入页面时都可能是不可信输入。
6. Read Aloud / 当前朗读文本高亮给了一个很好的参考：非鼠标工作流也应该使用同一套 text range 和 overlay pipeline。

不直接照搬：

1. Edge 的目标是通用 PDF reader，Literature Studio 的重点是科研阅读、标注、翻译、RAG evidence 和写作回指。
2. Edge 能保存 PDF 本身的批注；我们短期更应该先稳定内部 annotation store，是否写回 PDF 文件另行评估。
3. Edge 的云端能力和 Copilot 能力不能作为默认前提；我们必须保留本地优先和显式授权。

参考：

- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-pdf
- https://www.microsoft.com/en-us/edge/features/pdf-reader

### MuPDF

MuPDF 的 structured text 思路是将页面解析成 blocks、lines、spans、chars，并提供文本、坐标、quad、高亮等结构化能力。

启发：

1. PDF reader 不应该只关心字符框，还要形成稳定的文档结构。
2. 选区、标注、搜索、翻译、RAG 都可以建立在统一 structured text model 上。
3. 对论文类 PDF，阅读顺序、分栏、图表、公式、脚注是核心能力，不是边缘能力。

参考：

- https://mupdf.readthedocs.io/
- https://mupdf.readthedocs.io/en/latest/reference/common/stext-options.html

### MinerU

MinerU 当前定位是面向 LLM / RAG / Agent workflow 的文档解析工具，官方描述包括将 PDF、图片、DOCX、PPTX、XLSX 转成 Markdown / JSON，处理阅读顺序、页眉页脚、表格、公式、OCR、多格式输出等。

它对 Literature Studio 的价值不在于替代 reader 的实时选区，也不在于作为可直接引入的依赖，而在于提供一个可参考的产品形态和解析目标：

1. Markdown：适合作为阅读、摘要、LLM 输入和基础 chunk 来源。
2. JSON / intermediate format：适合保存 layout blocks、bbox、page、span、table、formula、image 等结构。
3. OCR：适合扫描 PDF、乱码 PDF、图片型论文。
4. 表格和公式解析：适合科学文献 RAG，避免纯文本抽取丢失关键证据。
5. 可视化结果：适合做解析质量检查与回归测试。

协议边界必须明确。MinerU 曾长期以 AGPL-3.0 传播，近期又出现向 Apache-based custom license 迁移的记录；无论具体版本如何变化，Literature Studio 都不能在没有独立 license review 的情况下直接引入、链接、分发或默认调用它。

1. 不直接复制 MinerU 源码。
2. 不把 MinerU 包、模型、CLI、SDK、Docker 镜像或二进制作为 Literature Studio 的内置依赖。
3. 不默认调用 MinerU API 作为产品功能的一部分。
4. 不让本项目的核心 schema、索引格式或运行时链路被 MinerU license 约束。
5. 即使 MinerU 后续协议发生变化，也需要重新做 license review 后才能讨论任何形式的集成。

可参考的内容仅限设计层面：

1. 输出形态：Markdown、结构化 JSON、layout block、中间格式、可视化 QA。
2. 任务拆分：layout detection、OCR、table recognition、formula recognition、reading-order reconstruction。
3. 质量目标：去页眉页脚、保留章节结构、表格公式可追踪、复杂双栏论文保持阅读顺序。
4. 评测方法：用可视化结果和样本文档做 parser 回归，而不是只看纯文本是否能抽出来。

参考：

- https://opendatalab.github.io/MinerU/
- https://github.com/opendatalab/MinerU
- https://github.com/opendatalab/MinerU-Ecosystem

## 核心判断

PDF 相关能力应该分成两条链路：

```text
实时阅读链路
PDFium page render
  -> text hit test
  -> selection range
  -> overlay rects
  -> annotation anchor

离线解析链路
PDF file
  -> parser backend, initially PDFium light extraction, later in-house advanced parser
  -> structured document JSON
  -> canonical passages
  -> RAG index
  -> evidence back-reference
```

两条链路共享同一套证据坐标：

1. document id
2. file version / hash
3. page number
4. PDF-space bbox / quad
5. text index 或 parser span id
6. quote / normalized text
7. parser backend 与 parser version

但两条链路不能互相阻塞。reader 需要轻量、快速、可随缩放重绘；离线解析可以慢一些、异步、带任务队列和缓存。

## 推荐架构

### 1. Reader Text Model

为阅读器建立 `PdfTextPageModel`：

```ts
export type PdfTextPageModel = {
  page: number;
  width: number;
  height: number;
  text: string;
  chars: readonly PdfTextCharModel[];
  lines: readonly PdfTextLineModel[];
  backend: 'pdfium';
  backendVersion?: string;
};
```

原则：

1. 保留 PDFium text index 作为 reader selection 的主锚点。
2. 视觉排序只用于交互和显示，不覆盖原始 index。
3. 行模型提供 hit-test 辅助，但不独占事实来源。
4. selection、search、annotation 都通过同一个 text range API。

### 2. Hit Test Service

将当前 pointer 命中逻辑从 controller 中下沉：

```ts
export interface PdfTextHitTestService {
  hitTestPoint(page: number, point: PdfPoint, options: PdfHitTestOptions): PdfTextBoundary | null;
  getRange(anchor: PdfTextBoundary, focus: PdfTextBoundary): PdfTextRange | null;
  getRangeRects(range: PdfTextRange): readonly PdfRect[];
  getRangeText(range: PdfTextRange): string;
}
```

命中策略：

1. 优先使用 PDFium text index hit-test 能力。
2. 失败时按行带吸附，而不是立即返回 null。
3. 横向拖选启用 sticky line，避免同一行选择时上下抖动导致跳行。
4. pointerup 必须 finalize selection，不能只依赖 pointermove。
5. tolerance 根据页面字号、行高、缩放动态计算。

### 3. Selection Range Model

selection 存成稳定结构：

```ts
export type PdfSelectionAnchor = {
  page: number;
  textIndex: number;
  affinity: 'before' | 'after';
};

export type PdfSelectionRangeV2 = {
  page: number;
  startTextIndex: number;
  endTextIndex: number;
  text: string;
  rects: readonly PdfRect[];
  lineIds?: readonly string[];
};
```

原则：

1. 单页、多页选区都由 range 列表表示。
2. rect 是派生结果，可以重算。
3. quote 是校验和回显用，不是唯一定位依据。
4. annotation anchor 保存 text index、quote、rect、parser version，后续可 reanchor。

### 4. Document Extraction Model

为 RAG ingest 建立和 reader 解耦的文档解析模型：

```ts
export type ParsedDocument = {
  documentId: string;
  fileHash: string;
  parser: {
    name: 'pdfium-lite' | 'ls-structured' | 'manual';
    version: string;
    optionsHash?: string;
  };
  pages: readonly ParsedPage[];
  blocks: readonly ParsedBlock[];
  assets: readonly ParsedAsset[];
};
```

`ParsedBlock` 至少包含：

1. block id
2. page range
3. bbox / quads
4. block type: title / paragraph / list / table / formula / figure / caption / reference / footnote
5. raw text
6. normalized text
7. reading order
8. confidence
9. source backend metadata

### 5. RAG Passage Model

RAG 不直接索引 PDF 原始字符，也不只索引 Markdown 文本。建议分两层：

1. `raw blocks`
   由 parser 输出，尽量忠实保留位置和结构。
2. `canonical passages`
   面向检索，合并断行、去页眉页脚、处理标题层级、拆分表格说明、保留公式占位。

passage 必须能回指：

```ts
export type EvidencePointer = {
  documentId: string;
  fileHash: string;
  parserName: string;
  parserVersion: string;
  page: number;
  blockIds: readonly string[];
  rects: readonly PdfRect[];
  quote: string;
};
```

### 6. Data Ownership Model

需要明确哪些数据是事实，哪些是派生结果，避免 reader、annotation、parser、index 互相乱写。

```text
Document registry
  owns: document id, source path/copy, file hash, metadata

Reader session
  owns: transient viewport, zoom, active page, current selection gesture

Annotation store
  owns: user-created highlights, notes, quotes, anchors

Parser artifact
  owns: parsed pages, blocks, passages, assets, diagnostics
  property: derived, versioned, rebuildable

Index store
  owns: FTS/vector rows, retrieval metadata
  property: derived from parser artifact, rebuildable

Job store
  owns: parse/index job state, progress, retry/error metadata
```

规则：

1. Reader session 不写长期 RAG 数据。
2. Parser artifact 不修改用户 annotation。
3. Index store 不成为 evidence 的唯一来源；它只保存可回指的 passage metadata。
4. Annotation anchor 可以引用 parser / text index 信息，但 annotation store 仍是用户数据事实源。
5. 删除 source document 时，必须通过 document registry 统一清理 annotation、artifact、index、job。

## MinerU 参考边界

### 不把 MinerU 作为运行时依赖

Reader selection 是实时交互，必须低延迟、跟随缩放、跟随虚拟滚动。MinerU 这类工具的价值是给我们提供离线解析的能力参照，而不是成为 Literature Studio 的运行时组件。

第一原则：

1. PDFium 继续负责 reader render 和即时选区。
2. 高质量 document parsing 由 Literature Studio 自己的 parser adapter / artifact schema 承担。
3. MinerU 只作为外部参考，不进入默认依赖、默认任务队列或默认 API 调用。
4. 不以 MinerU schema 作为内部长期 schema；我们只吸收其输出形态和评测思路。

### 允许参考的形态

优先参考三种产品形态，但实现必须自研或使用协议清晰、可接受的替代组件：

1. `pdfium-lite`
   内置轻量抽取，只做 text / page / rect / basic lines，作为最小可用 RAG。
2. `ls-structured`
   自研结构化解析器，逐步补齐 reading order、header/footer removal、table、formula、figure caption。
3. `external-artifact-import`
   只允许导入用户已经生成的 Markdown / JSON / layout artifact。导入的是数据文件，不是运行或链接外部受限协议代码。

### 任务队列

解析任务应该异步：

```text
PDF downloaded
  -> register document file
  -> enqueue parse job
  -> parser backend runs
  -> store parsed document artifact
  -> build canonical passages
  -> update search index
  -> expose evidence pointers
```

任务状态至少包括：

1. pending
2. parsing
3. parsed
4. indexing
5. indexed
6. failed
7. stale, file changed or parser upgraded

## 具体优化方案

### A. 先做观测与样本集

在改架构前，先把问题变成可观察数据。选区失败不能只靠肉眼判断，否则后续很难防回归。

需要建立一组 PDF selection fixtures：

0. smoke PDF：使用 `scripts/electron-smoke-pdf-preview.mjs` 里自建的 `PDF Preview Smoke.pdf`，文本固定为 `Literature Studio PDF smoke`，作为基础 selection 门禁。
1. affiliation / author line：小字号、斜体、上标、脚注编号。
2. title：大字号、跨行、粗体。
3. abstract：连续正文、普通段落。
4. double-column body：双栏正文、栏间距、跨栏标题。
5. references：密集文本、编号、DOI、URL。
6. formula-adjacent text：公式上下文、上下标。
7. table caption / figure caption：图表标题、跨页表格说明。
8. scanned / image-only PDF：无原生文本层，确认 reader selection 降级行为。

为 reader 加 diagnostic snapshot：

```ts
export type PdfSelectionDiagnosticSnapshot = {
  page: number;
  viewportPoint: { x: number; y: number };
  pdfPoint: { x: number; y: number };
  source: 'engine-hit' | 'line-snap' | 'layout-fallback' | 'miss';
  textIndex?: number;
  affinity?: 'before' | 'after';
  lineId?: string;
  lineDeltaY?: number;
  tolerance: { x: number; y: number };
  reason?: string;
};
```

验收方式：

1. 第一层门禁使用自建 smoke PDF 模拟 pointerdown / move / up，不只测 DOM 是否出现 highlight。
2. smoke PDF 必须断言 selection text 包含 `Literature Studio PDF smoke`，并检查 rect count、page、状态 dataset。
3. 第二层门禁再使用复杂 PDF fixtures，断言 selection text、start/end text index、rect count、page、line id。
4. 对样本文档记录失败原因，例如 `miss-outside-line-band`、`engine-no-char`、`empty-final-range`。

### B. Reader selection 优化

#### B1. 后端边界

先把 PDFium 文本能力从 `pdfDocumentReader.ts` 中抽成后端对象。reader 只调用稳定接口，不直接散落调用 PDFium API。

```ts
export interface PdfTextBackend {
  getPageText(page: number): PdfTextPageModel | null;
  hitTest(page: number, point: PdfPoint, options: PdfHitTestOptions): PdfTextBoundary | null;
  getText(range: PdfTextRange): string;
  getRects(range: PdfTextRange): readonly PdfRect[];
  disposePageText(page: number): void;
}
```

PDFium adapter 职责：

1. 缓存 `FPDFText_LoadPage` 的结果，控制生命周期。
2. 暴露 char index、unicode、char box、range rect。
3. 负责 PDFium text index 与内部 model 的映射。
4. 不负责 selection 状态机，不负责 annotation store，不负责 DOM overlay。

#### B2. 坐标体系

统一三类坐标：

1. `client point`：浏览器事件坐标。
2. `viewport point`：page canvas wrap 内坐标，单位 CSS px。
3. `pdf point`：PDF page coordinate，单位 PDF point，左下角为原点。

所有选区事实只保存 PDF coordinate 或 text index。viewport coordinate 只在渲染 overlay 时临时计算。

坐标转换 API：

```ts
export interface PdfPageCoordinateMapper {
  clientToViewport(page: number, point: ClientPoint): ViewportPoint | null;
  viewportToPdf(page: number, point: ViewportPoint): PdfPoint;
  pdfRectToViewport(page: number, rect: PdfRect): ViewportRect;
}
```

要求：

1. canvas 被虚拟卸载时，也必须能用 page wrapper geometry 做转换。
2. zoom preview 和 rerender 期间，selection 暂停或使用明确的 rendered scale。
3. 所有 rect 渲染前统一 clamp 到 page bounds。

#### B3. 命中算法

命中流程：

```text
client point
  -> resolve page
  -> convert to pdf point
  -> engine hit test with dynamic tolerance
  -> if hit, convert char index to boundary
  -> if miss, try line snap
  -> if still miss, return miss diagnostic
```

动态 tolerance：

```ts
const yTolerance = clamp(lineMedianHeight * 0.55, 3, lineMedianHeight * 1.2);
const xTolerance = clamp(lineMedianHeight * 0.45, 2, lineMedianHeight * 1.0);
```

如果无法得到 line height：

1. 用 page median char height。
2. 再失败用当前 zoom 下换算后的最小 PDF tolerance。

boundary affinity：

```ts
type PdfTextBoundary = {
  page: number;
  textIndex: number;
  affinity: 'before' | 'after';
  source: 'engine-hit' | 'line-snap' | 'layout-fallback';
};
```

同一字符命中后：

1. 鼠标在字符中心左侧，取 `before`。
2. 鼠标在字符中心右侧，取 `after`。
3. 对 RTL / vertical writing 暂不优化，但数据结构保留扩展空间。

#### B4. 行吸附和 sticky line

line snap 不是无限吸附，只在合理区域内生效：

1. `point.y` 落在 line band 上下扩展范围内。
2. `point.x` 允许在行首前、行尾后一定距离，用于从行外拖入。
3. 多条 line band 重叠时，选中心线距离最近的一条。
4. 当前 selection 已进入 sticky line 后，横向拖选优先保持该 line，除非垂直偏移超过相邻行间距的一定比例。

sticky line 状态：

```ts
export type PdfSelectionGesture = {
  anchor: PdfTextBoundary;
  focus: PdfTextBoundary;
  stickyLineId?: string;
  mode: 'char' | 'word' | 'line';
  phase: 'idle' | 'pending' | 'dragging' | 'finalized';
};
```

退出 sticky line 的条件：

1. pointer 垂直移动超过当前行到相邻行中心距离的 0.65。
2. pointer 跨页。
3. selection range 已覆盖多行。

#### B5. Pointer 状态机

当前最重要的是不要让 selection 依赖某一次 `pointermove` 是否发生。

状态机：

```text
idle
  -> pointerdown hit: pending(anchor)
  -> pointermove beyond threshold: dragging(range preview)
  -> pointerup: finalize(anchor, release point)
  -> pointercancel/escape: cancel
```

规则：

1. `pointerdown` 成功后记录 anchor，不立即清掉已有 selection，除非开始 drag。
2. `pointermove` 超过 2-3 CSS px 后进入 dragging。
3. `pointerup` 必须用释放点重新 hit test 并 finalize。
4. 如果 down/up 在同一 boundary，视为 caret click 或清选区，不生成空 selection。
5. double click 使用 word expansion，triple click 预留 line expansion。
6. pointer capture 失败时降级到 window-level listeners。

#### B6. Range rect 生成

rect 来源优先级：

1. PDFium text range rects。
2. structured line model rects。
3. char boxes fallback。

后处理：

1. 按行聚类，不按字符逐个画。
2. 同一行相邻 rect gap 小于 1.5 CSS px 时合并。
3. 大于列间距阈值的 gap 保留，避免跨栏错误合并。
4. 行高使用 line band，而不是单个 glyph box 高度。
5. selection 和 annotation 可共享几何 pipeline，但样式和 pointer events 分离。

#### B7. Annotation anchor 迁移

新 anchor：

```ts
export type PdfAnnotationAnchorV2 = {
  version: 2;
  documentId: string;
  fileHash: string;
  page: number;
  ranges: readonly {
    page: number;
    startTextIndex?: number;
    endTextIndex?: number;
    quote: string;
    rects: readonly PdfRect[];
    lineIds?: readonly string[];
  }[];
};
```

迁移策略：

1. 老 annotation 仍能用 rect + quote 显示。
2. 页面加载时尝试通过 quote + rect proximity reanchor 到 text index。
3. 成功后写入 v2 anchor。
4. 失败时保持 legacy anchor，不丢用户数据。

### C. `pdfium-lite` ingest 优化

`pdfium-lite` 是最小可用 RAG，不追求表格/公式完美，但必须有稳定 evidence。

输出：

1. document metadata
2. pages
3. text lines
4. basic blocks
5. raw text
6. normalized passages
7. evidence pointers

basic block 规则：

1. 同一栏内相邻行按 y 间距和缩进合并为 paragraph。
2. 大字号 / 粗体 / 孤立短行候选为 title。
3. 页眉页脚通过重复文本、页面边缘位置、字号较小来识别。
4. references 区域可先只作为普通 paragraph，但保留 section hint。
5. 表格区域先标记 `unknown-table-like`，不强行转 HTML。

artifact 存储建议：

```text
library/
  documents/{documentId}/
    source.pdf
    artifacts/
      pdfium-lite.v1/
        parsed-document.json
        passages.jsonl
        diagnostics.json
```

### D. `ls-structured` 自研解析器路线

`ls-structured` 不一次做完。先复用 `pdfium-lite` 的事实数据，然后逐步增加结构识别。

模块：

1. layout detection：页眉页脚、栏、标题、段落、脚注、图表区域。
2. reading-order reconstruction：单栏、双栏、跨栏标题、caption。
3. table candidate detection：线框表、密集对齐文本、跨页表。
4. formula candidate detection：行内公式、独立公式、公式编号。
5. OCR adapter boundary：只定义接口，不先绑定具体 OCR。
6. visual QA renderer：输出 block overlay PNG / HTML 方便检查。

核心原则：

1. 自研 schema，不承接外部工具 schema。
2. 每个 block 都有 page、bbox、reading order、confidence。
3. 每次 parser 版本升级可重建 artifact。
4. 低置信度 block 不能静默进入高置信 RAG passage。

### E. RAG 优化

RAG 的关键不是“把 PDF 文字塞进向量库”，而是证据可追溯。

chunk 策略：

1. 先按 section 分层，再按 paragraph 合并。
2. 每个 passage 目标 300-900 中文字或 200-500 English tokens。
3. 保留 title path，例如 `Introduction > Contact engineering`。
4. 表格、公式、图注单独 passage，并与邻近正文互链。
5. references 默认不参与普通语义检索，但参与 DOI / author / title 检索。

检索策略：

1. 第一阶段：SQLite FTS / BM25，保证术语、材料名、缩写可命中。
2. 第二阶段：向量召回，覆盖语义表达差异。
3. 第三阶段：融合去重，按 document diversity 和 section diversity 约束。
4. 第四阶段：rerank。
5. 返回结果必须带 evidence pointer。

LLM 上下文组装：

1. 不只取 top-k。
2. 同一文献最多占用一定比例上下文。
3. 相邻 passage 可扩展，但必须标记扩展来源。
4. 生成引用时只允许引用带 evidence pointer 的内容。

### F. Edge Reader 对照体验

Edge PDF Reader 可以作为 reader UX 的对照标尺。我们的目标不是复制 Edge，而是确保科研阅读的基础手感不要低于成熟阅读器太多。

#### 基础阅读

需要对照：

1. zoom in / out。
2. fit to width / fit to page。
3. rotate。
4. jump to page。
5. search。
6. TOC / outline。
7. page thumbnails 或 page view。

其中 TOC、thumbnail 可以后置，但数据结构要预留。

#### Selection action surface

选中文本后，动作应该形成稳定模型：

1. copy。
2. highlight。
3. add note。
4. translate。
5. explain / summarize selection。
6. capture as RAG evidence。

动作来源可以是 context menu、toolbar、floating selection menu。无论入口如何，都必须使用同一套 `PdfSelectionRangeV2`。

#### Annotation UX

参考 Edge 的 highlight + text notes，但服务 Literature Studio 的知识工作流：

1. highlight 和 note 使用同一 anchor。
2. 点击 annotation 能定位到 comment。
3. hover 可以预览 comment。
4. annotation panel 显示 quote、page、source document。
5. 删除 annotation 不影响 parser artifact。
6. 是否写回 PDF 文件单独评估，不进入 selection v2 的第一阶段。

#### Read Aloud / Non-pointer range

Read Aloud 的当前朗读高亮说明：range 不只来自鼠标，也可以来自系统播放进度、搜索结果、键盘导航、RAG evidence。

因此 overlay pipeline 必须支持这些 range source：

1. user selection。
2. search match。
3. annotation。
4. read aloud current sentence。
5. RAG evidence result。

不同 source 使用不同样式和层级，但共享 PDF-space rect 渲染。

#### Accessibility

长期要补：

1. keyboard navigation。
2. caret mode / keyboard selection。
3. high contrast highlight style。
4. screen reader 读取当前页文本。
5. focus order：toolbar、page, annotation, search result。

这部分不阻塞 selection v2，但进入 release gate。

#### Security / Reliability

Edge 文档强调安全可靠性，这一点应进入我们的 reader 设计：

1. PDF 是不可信输入。
2. parser artifact 是不可信输入，尤其 external artifact import。
3. 渲染、解析、索引都要有资源上限。
4. 损坏、加密、超大 PDF 必须优雅失败。

### G. CI / Regression Gate

CI 要分层，避免所有重测试都压在每次提交上。

#### PR 必跑

目标是阻止基础能力回退：

1. TypeScript typecheck。
2. PDF layout / selection 单元测试。
3. 自建 smoke PDF selection 测试，断言 `Literature Studio PDF smoke` 可选中。
4. annotation anchor migration 单元测试。
5. license keyword scan，阻止 AGPL / GPL / unknown / custom 风险依赖静默进入。
6. schema snapshot test，阻止 artifact schema 无版本变更。

PR 必跑失败时直接 block merge。

#### Nightly / 手动门禁

目标是发现复杂样本回退：

1. 复杂 PDF fixtures：affiliation、双栏、公式、表格、references、caption、扫描 PDF。
2. parser regression：block count、reading order、text coverage、header/footer leakage。
3. RAG evidence regression：passage 是否都能回指 page + rect + quote。
4. performance probe：hit-test latency、overlay DOM count、parse job throughput。
5. cross-platform smoke：Windows 为主，macOS / Linux 作为定期验证。

Nightly 失败不一定阻塞所有开发，但不能发布 `default-on` 功能。

#### 本地开发命令

建议后续形成这些命令：

```text
npm run test:pdf-selection
npm run test:pdf-fixtures
npm run test:pdf-parser
npm run test:rag-index
npm run check:licenses
```

其中 `test:pdf-selection` 必须包含自建 smoke PDF，保证任何人本地都能跑。

### H. PDF Fixture Strategy

复杂论文 PDF 不适合直接提交到仓库：有版权风险，也不稳定。因此 fixture 分三层。

#### 1. Generated fixtures

优先使用脚本生成，可提交、可复现、无版权问题。

建议新增：

```text
scripts/create-pdf-fixtures.mjs
```

生成：

1. `selection-smoke.pdf`：单行普通文本，等价当前 `PDF Preview Smoke.pdf`。
2. `selection-superscript.pdf`：正文 + 上标编号。
3. `selection-small-italic.pdf`：小字号斜体 affiliation。
4. `selection-tight-lines.pdf`：行间距很小。
5. `selection-two-column.pdf`：双栏文本。
6. `selection-hyphenation.pdf`：断词和换行。
7. `selection-caption-table.pdf`：caption 和表格样式文本。
8. `selection-rotated-page.pdf`：旋转页或 landscape 页。
9. `selection-image-only.pdf`：只有图片，无 text layer。

生成器要求：

1. 每个 fixture 固定文本和坐标。
2. 输出对应 JSON manifest，记录预期选区。
3. 不依赖网络。
4. 不使用受版权保护内容。

manifest 示例：

```json
{
  "file": "selection-smoke.pdf",
  "cases": [
    {
      "name": "select full smoke text",
      "page": 1,
      "start": { "x": 48, "y": 88 },
      "end": { "x": 270, "y": 88 },
      "expectedText": "Literature Studio PDF smoke"
    }
  ]
}
```

#### 2. Local-only real fixtures

真实论文样本可以放本地，不提交仓库。

规则：

1. 路径通过环境变量配置，例如 `LS_PDF_FIXTURE_DIR`。
2. 测试发现本地样本时运行增强测试，否则跳过。
3. 不把真实论文 PDF 复制到 artifact、日志或截图里。
4. 只记录失败摘要和页码，不记录大段原文。

#### 3. Synthetic OCR fixtures

扫描 PDF 需要单独生成：

1. 用 canvas / SVG / image 生成一页图片。
2. 嵌入 PDF，但不放文本层。
3. 验证 reader selection 明确失败并提示需要 OCR。
4. 后续 OCR parser 可用它做最小门禁。

### I. Artifact Storage / Migration / Cleanup

RAG 和 parser 一旦落盘，必须有生命周期管理。

#### 存储布局

建议：

```text
library/
  documents/{documentId}/
    source.pdf
    document.json
    annotations.json
    artifacts/
      pdfium-lite.v1/
        parsed-document.json
        passages.jsonl
        diagnostics.json
      ls-structured.v1/
        parsed-document.json
        passages.jsonl
        visual-qa/
    indexes/
      fts.v1/
      vector.v1/
```

`document.json` 记录：

1. document id
2. source path
3. file hash
4. imported at
5. active parser artifact
6. active index version
7. stale flags

#### Versioning

每个 artifact 必须记录：

1. schema version
2. parser name
3. parser version
4. options hash
5. source file hash
6. created at

parser 升级策略：

1. parser version 变化后，旧 artifact 标记 stale。
2. 旧 artifact 不立即删除，直到新 artifact 和 index 成功生成。
3. annotation anchor 迁移失败时，旧 artifact 可作为 reanchor 参考。
4. 用户可以手动回滚 active artifact。

#### Cleanup

清理规则：

1. 删除文献时，删除 source copy、artifacts、indexes、jobs、derived assets。
2. 清缓存时，只删除可重建 artifact，不删除 source PDF 和 annotations。
3. parser artifact 最多保留最近 N 个成功版本。
4. failed / partial artifact 定期清理。
5. vector index 必须能按 document id 删除。

#### Migration

迁移原则：

1. schema migration 必须幂等。
2. migration 失败不能破坏 source PDF 和 annotations。
3. 长期索引可重建，优先重建而不是复杂迁移。
4. 每次 migration 写入 before / after schema version。

### J. Parse Job Scheduler

解析任务必须在后台异步运行，不能阻塞 reader。

#### Job model

```ts
export type PdfParseJob = {
  id: string;
  documentId: string;
  fileHash: string;
  parserName: 'pdfium-lite' | 'ls-structured';
  parserVersion: string;
  status: 'pending' | 'parsing' | 'parsed' | 'indexing' | 'indexed' | 'failed' | 'cancelled' | 'stale';
  priority: 'interactive' | 'background';
  progress: {
    phase: string;
    currentPage?: number;
    pageCount?: number;
  };
  attempts: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

#### 调度规则

1. reader 打开 PDF 时，不等待 parse job。
2. 新下载 PDF 进入低优先级后台队列。
3. 用户打开某篇 PDF 时，可提高该文档 parse priority。
4. 同一 document 同一 parser 同一 file hash 只能有一个 active job。
5. app 退出时持久化 pending / running job，重启后恢复为 pending。
6. failed job 保留错误摘要和 retry 入口。

#### 并发与资源

建议默认：

1. `pdfium-lite` 并发 1-2。
2. `ls-structured` 并发 1。
3. OCR / heavy parser 默认不自动跑，必须用户开启或 behind flag。
4. 大 PDF 分页 yield，避免长时间占用 renderer。
5. Electron main 只调度，不做重 CPU 解析；重任务放 worker / child process。

#### Cancel / Retry

取消：

1. 用户手动取消。
2. 文档删除。
3. 文件 hash 变化。
4. parser version 变化导致旧 job stale。

重试：

1. transient IO error 可重试。
2. parser crash 可重试一次。
3. unsupported / encrypted / no text layer 不自动重试。
4. retry backoff，避免循环失败。

#### 错误分类

至少区分：

1. `unsupported-format`
2. `encrypted-pdf`
3. `damaged-pdf`
4. `no-text-layer`
5. `parser-crash`
6. `out-of-memory`
7. `artifact-write-failed`
8. `index-write-failed`

错误分类要映射到 UI 操作：重试、跳过、需要 OCR、需要密码、查看日志。

### K. Feature Flags / Rollout

复杂能力必须分期开关，不直接默认打开。

建议 flag：

```text
pdf.selection.v2
pdf.annotation.anchorV2
pdf.parser.pdfiumLite
pdf.parser.lsStructured
pdf.rag.indexPdf
pdf.rag.evidenceJump
pdf.externalArtifactImport
```

flag 分级：

1. `dev-only`
   只给开发调试，不写长期数据，允许破坏性实验。
2. `behind-flag`
   可选启用，artifact 有 version，可重建，可回滚。
3. `default-on`
   通过 release gate 后默认启用。

默认值建议：

1. `pdf.selection.v2` 先 behind-flag，smoke PDF 和复杂 fixtures 稳定后 default-on。
2. `pdf.annotation.anchorV2` 先 behind-flag，迁移和 fallback 稳定后 default-on。
3. `pdf.parser.pdfiumLite` 可较早 behind-flag，索引写入前必须过 schema / evidence gate。
4. `pdf.parser.lsStructured` 长期 dev-only / behind-flag，不默认开启。
5. `pdf.externalArtifactImport` behind-flag，并受 license / provenance gate 约束。

### L. Security / Abuse Cases

PDF 和外部 artifact 都是不可信输入，需要单独规划安全边界。

输入限制：

1. PDF 文件大小上限。
2. 页数上限或大文件 warning。
3. 单页 bitmap pixel 上限。
4. parser object count / text char count 上限。
5. artifact JSON 文件大小上限。

路径安全：

1. 所有 artifact 写入必须限制在 document directory 内。
2. external artifact import 必须防路径穿越。
3. derived assets 不允许覆盖 source PDF、annotations、config。
4. 清理任务必须只删除 registry 记录内的路径。

数据安全：

1. renderer 不直接信任 parser JSON。
2. imported artifact 需要 schema validate。
3. HTML table / formula / caption 展示前必须 sanitize。
4. job log 不记录大段原文。

失败策略：

1. encrypted PDF：提示需要密码或跳过解析。
2. damaged PDF：阅读失败和解析失败分开呈现。
3. oversized PDF：允许阅读，但解析进入手动确认。
4. image-only PDF：reader selection 明确不可用，提示 OCR。

### M. Observability / Diagnostics

没有诊断包，PDF 问题会很难复现。

需要记录：

1. selection diagnostic：hit source、pdf point、tolerance、line id、miss reason。
2. parse job diagnostic：phase、page progress、duration、error code。
3. parser quality metrics：text coverage、block count、unknown block ratio、header/footer leakage。
4. index metrics：passage count、indexed document count、stale index count。
5. performance metrics：hit-test latency、overlay DOM count、parse throughput。

脱敏原则：

1. 默认不导出 PDF 原文。
2. 默认不导出用户 annotation 正文。
3. quote 只导出短片段，或由用户显式确认。
4. 日志使用 document id、file hash、page、block id 代替全文。

诊断包建议：

```text
diagnostics/
  environment.json
  pdf-reader-status.json
  selection-diagnostics.jsonl
  parse-jobs.jsonl
  parser-quality.json
  index-status.json
```

### N. Backward Compatibility

迁移必须保护用户标注和已有工作区状态。

兼容策略：

1. 老 annotation anchor 继续显示。
2. v2 reanchor 成功后再写入新 anchor。
3. reanchor 失败保留 legacy，不删除用户数据。
4. feature flag 关闭后，旧 selection / annotation 路径仍能工作。
5. workspace 中旧 PDF tab state 不能因为 parser artifact 缺失而打不开。
6. statusbar 老字段保留兼容期，再迁移到新 selection dataset。

迁移门槛：

1. migration 幂等。
2. migration 可中断，重启后可继续。
3. migration 失败只影响新能力，不影响 PDF 阅读和老标注显示。

## 阶段路线

### Phase 1: 稳定 reader selection 的事实模型

目标：

1. 把 hit-test、range、rect 生成从 controller 中拆出。
2. selection 以 page + text index range 为主。
3. overlay rect 支持由 PDFium range rect 生成，再做轻量归并。
4. 保留现有 layout model 作为 fallback 和交互辅助。

验收：

1. 小字号 affiliation 行可稳定横向选中。
2. 上标附近拖选不会频繁断。
3. 快速短拖也能生成最终 selection。
4. 缩放后 selection 和 annotation 仍能对齐。

### Phase 2: 建立 PDF ingest 最小链路

目标：

1. 对下载 PDF 建立 file hash、document id、parse job。
2. 用 PDFium light extraction 生成最小 `ParsedDocument`。
3. 生成 canonical passages。
4. 支持全文搜索和基本 evidence pointer。

验收：

1. 下载后的 PDF 可进入知识库索引。
2. 搜索结果能回指页码和原 PDF 位置。
3. passage 能追踪到原始 block 和 quote。

### Phase 3: 参考 MinerU 的自研解析器验证

目标：

1. 参考 MinerU 的 Markdown / JSON / intermediate artifact 形态，设计 `ls-structured` 输出。
2. 将自研 parser block 映射到 `ParsedDocument`。
3. 支持表格、公式、图片 caption、OCR 文档的 ingest。
4. 建立解析质量对比样本集。
5. 可选支持用户手动导入外部工具生成的 artifact，但不内置、不调用、不链接外部受限协议工具。

验收：

1. 同一 PDF 可以比较 `pdfium-lite` 与 `ls-structured` 的 block / passage 差异。
2. 复杂论文的阅读顺序明显优于轻量抽取。
3. RAG evidence 可以回指自研 parser block，同时尽量回到 PDF 页码和 bbox。

### Phase 4: RAG 深化

目标：

1. BM25 / FTS + vector hybrid retrieval。
2. reranker。
3. section-aware chunking。
4. table / formula / figure-aware retrieval。
5. 写作引用时强制带 evidence pointer。

验收：

1. 检索结果不是孤立 chunk，而是带标题路径、页码、证据框和原文 quote。
2. 同一主题能召回多篇文献，避免单篇长文献霸占上下文。
3. LLM 生成层可以引用 evidence，而不是凭空总结。

## 设计原则

1. Reader selection 要快，document parsing 要准，二者目标不同。
2. PDF-space coordinate 是跨缩放、跨渲染、跨后端的公共语言。
3. text index、bbox、quote、parser version 必须一起保存。
4. Markdown 适合给人和 LLM 看，JSON 才适合作为长期结构化证据。
5. RAG 的 chunk 不能脱离原始页面证据。
6. MinerU 是后续重点参考对象，但不能作为直接依赖；知识库 schema 不能被单一外部工具锁死。
7. 每次 parser 升级都要允许重建 parsed artifact 和 index。

## 需要单独验证的问题

1. 哪些协议清晰、可接受的 OCR / table / formula 组件可以作为自研 parser 的候选。
2. 参考 MinerU 类输出时，我们自己的 JSON schema 如何保持稳定和坐标精度。
3. 科学论文公式、表格、跨页表格、双栏正文的实际效果。
4. 扫描 PDF 和原生 PDF 的识别路径是否应拆开。
5. RAG index 是否先用本地 SQLite FTS，再接向量索引。
6. 用户是否需要手动触发“重新解析 / 重新索引”。
7. 解析结果、图片、表格 HTML、公式 LaTeX 的存储目录布局。

## 实施 Checklist

### 0. 准备与基线

- [ ] 将 `scripts/electron-smoke-pdf-preview.mjs` 的自建 `PDF Preview Smoke.pdf` 作为基础 selection fixture。
- [ ] 基础 fixture 断言选中文本包含 `Literature Studio PDF smoke`。
- [ ] 收集 8 类复杂 PDF 样本文档：affiliation、小字号脚注、双栏正文、abstract、references、公式、表格、扫描 PDF。
- [ ] 为每个样本记录至少 3 个固定选区用例：起点、终点、预期文本、预期页码。
- [ ] 增加 PDF selection diagnostic dataset 字段，能在测试和调试时读取命中来源。
- [ ] 给当前实现跑一轮基线，记录 miss、empty selection、wrong line、wrong text、wrong rect。
- [ ] 明确所有样本文档的存放策略，避免提交有版权风险的完整论文原文；必要时使用本地 fixture 或生成 PDF。

### 1. Reader Text Backend

- [ ] 新建 `PdfTextBackend` 接口。
- [ ] 将 PDFium text page load / close 从 `pdfDocumentReader.ts` 中抽离。
- [ ] 将 char extraction、range text、range rect 放到 PDFium adapter。
- [ ] 增加 text page cache，按 page + file hash + parser version 失效。
- [ ] 明确虚拟滚动卸载 canvas 后，text backend 仍可命中已加载文本页。
- [ ] 给 backend 增加单元测试：char count、text index、rect count、range text。

### 2. Coordinate Mapper

- [ ] 新建 page coordinate mapper。
- [ ] 覆盖 client -> viewport -> PDF point。
- [ ] 覆盖 PDF rect -> viewport rect。
- [ ] 处理 canvas 已卸载但 page wrapper 仍存在的情况。
- [ ] 处理 zoom preview / rerender 期间的 scale 来源。
- [ ] 增加测试：不同 zoom、不同 DPR、滚动偏移、页面居中布局。

### 3. Hit Test Service

- [ ] 新建 `PdfTextHitTestService`。
- [ ] 实现 engine hit test 优先路径。
- [ ] 实现 dynamic tolerance，来源为 line median height / char median height。
- [ ] 实现 line snap fallback。
- [ ] 实现 boundary affinity：before / after。
- [ ] 实现 hit diagnostic reason。
- [ ] 测试 affiliation 行、上标附近、空格附近、行首前、行尾后。

### 4. Selection Gesture State Machine

- [ ] 将 pointer gesture 状态从 controller 中拆清楚：idle / pending / dragging / finalized。
- [ ] pointerdown 只建立 anchor，不立即破坏已有 selection。
- [ ] pointermove 超过阈值后进入 dragging。
- [ ] pointerup 必须用释放点 finalize。
- [ ] pointercancel / Escape 能取消 gesture。
- [ ] double click 使用 word expansion。
- [ ] triple click 预留 line expansion。
- [ ] pointer capture 失败时降级到 window listeners。
- [ ] 增加测试：快速短拖、无 move 拖选、跨行拖选、跨页拖选、取消拖选。

### 5. Sticky Line

- [ ] 为 gesture 增加 `stickyLineId`。
- [ ] 横向拖选时优先保持 anchor 所在行。
- [ ] 垂直移动超过阈值后释放 sticky line。
- [ ] 多行 range 后不再强制 sticky。
- [ ] 测试同一行上下抖动、相邻行距离很近、上标导致行带重叠。

### 6. Range Rect Pipeline

- [ ] 统一 rect 来源优先级：PDFium range rect -> line model -> char boxes。
- [ ] 实现 rect 行聚类。
- [ ] 实现小 gap 合并。
- [ ] 实现列间大 gap 保留。
- [ ] 实现 line band height 统一。
- [ ] selection 与 annotation 共享几何 pipeline，但分离样式和事件。
- [ ] 测试 rect 不重叠、不漏字、不跨栏误合并。

### 7. Annotation Anchor V2

- [ ] 定义 `PdfAnnotationAnchorV2`。
- [ ] 保存 text index、quote、rects、file hash、anchor version。
- [ ] 老 annotation 继续用 legacy rect 显示。
- [ ] 实现 quote + rect proximity reanchor。
- [ ] 成功 reanchor 后写入 v2。
- [ ] 失败时保留 legacy，不丢数据。
- [ ] 增加迁移测试和缩放回显测试。

### 8. `pdfium-lite` Ingest

- [ ] 定义 `ParsedDocument` / `ParsedPage` / `ParsedBlock` / `ParsedAsset`。
- [ ] 建立 file hash、document id、parser version。
- [ ] 从 PDFium 文本页生成 raw lines。
- [ ] 合并 basic paragraphs。
- [ ] 识别重复页眉页脚候选。
- [ ] 生成 canonical passages。
- [ ] 生成 evidence pointer。
- [ ] 将 artifact 写入文档目录。
- [ ] 增加 parse job 状态：pending / parsing / parsed / indexing / indexed / failed / stale。

### 9. `ls-structured` 自研解析器

- [ ] 定义 `ls-structured.v1` artifact schema。
- [ ] 设计 block confidence 字段。
- [ ] 实现单栏 / 双栏 reading order。
- [ ] 实现跨栏标题识别。
- [ ] 实现 figure caption / table caption 候选。
- [ ] 实现 table-like block 标记，不急于转换 HTML。
- [ ] 实现 formula-like block 标记，不急于 LaTeX OCR。
- [ ] 实现 visual QA overlay 输出。
- [ ] 建立 parser regression snapshot。

### 10. External Artifact Import

- [ ] 定义外部 artifact 导入入口，只导入数据文件。
- [ ] 禁止在导入流程中执行外部工具二进制、CLI、SDK。
- [ ] 为导入 artifact 标记 source tool、source version、import time。
- [ ] 将外部 schema 映射到内部 `ParsedDocument`，不直接持久化为核心 schema。
- [ ] 对 license / provenance 增加 UI 或日志提示。

### 11. RAG Index

- [ ] 先接 SQLite FTS / BM25。
- [ ] passage 写入必须带 evidence pointer。
- [ ] 支持按 document、section、page 过滤。
- [ ] 支持 title path 和 block type 加权。
- [ ] 增加 references 的特殊检索模式。
- [ ] 设计向量索引 adapter，但不阻塞 FTS 版本。
- [ ] 设计 reranker adapter。
- [ ] 增加检索结果去重和 document diversity。

### 12. UI 与用户工作流

- [ ] PDF status 显示当前是否已解析 / 已索引 / 解析失败。
- [ ] 支持手动重新解析。
- [ ] 支持手动重新索引。
- [ ] 搜索结果点击后能跳到 PDF 页码和 evidence rect。
- [ ] annotation 与 RAG evidence 共用回指展示组件。
- [ ] 对扫描 PDF 明确提示“需要 OCR 解析”而不是假装可选中。

### 13. Edge Reader 对照体验

- [ ] 对齐基础阅读动作：zoom、fit width/page、rotate、jump to page、search。
- [ ] 规划 TOC / outline 数据来源。
- [ ] 规划 page thumbnail / page view，不阻塞 selection v2。
- [ ] 选区动作统一走 `PdfSelectionRangeV2`：copy、highlight、note、translate、explain、capture evidence。
- [ ] annotation 支持点击定位、hover 预览、panel 展示 quote/page/source。
- [ ] overlay pipeline 支持 user selection、search match、annotation、read aloud range、RAG evidence。
- [ ] 高对比度和键盘导航进入 release gate。
- [ ] 是否写回 PDF 批注单独评估，不进入第一阶段默认范围。

### 14. 质量门槛

- [ ] 自建 smoke PDF 选区测试通过，文本包含 `Literature Studio PDF smoke`。
- [ ] affiliation 行短拖成功率在样本集中稳定通过。
- [ ] 选区文本与 highlight 覆盖范围一致。
- [ ] annotation 缩放后不漂移。
- [ ] 双栏正文 reading order 不左右交错。
- [ ] 页眉页脚不进入普通 RAG passage，或至少以低权重进入。
- [ ] 每个 RAG result 都能回指到 PDF page + rect + quote。
- [ ] parser 升级后能标记 stale 并重建 artifact。

### 15. CI / Regression

- [ ] 增加 `test:pdf-selection`，必跑自建 smoke PDF selection。
- [ ] 增加 license keyword scan，阻止高风险协议依赖静默进入。
- [ ] 增加 schema snapshot test，阻止无版本 schema 变更。
- [ ] 将复杂 PDF fixtures 放到 nightly / 手动门禁。
- [ ] nightly 输出 parser regression 指标：text coverage、reading order、header/footer leakage。
- [ ] performance probe 记录 hit-test latency、overlay DOM count、parse job throughput。

### 16. PDF Fixture Generator

- [ ] 新增 `scripts/create-pdf-fixtures.mjs`。
- [ ] 生成 `selection-smoke.pdf`。
- [ ] 生成 `selection-superscript.pdf`。
- [ ] 生成 `selection-small-italic.pdf`。
- [ ] 生成 `selection-tight-lines.pdf`。
- [ ] 生成 `selection-two-column.pdf`。
- [ ] 生成 `selection-hyphenation.pdf`。
- [ ] 生成 `selection-caption-table.pdf`。
- [ ] 生成 `selection-rotated-page.pdf`。
- [ ] 生成 `selection-image-only.pdf`。
- [ ] 每个 fixture 输出 JSON manifest，记录预期选区。
- [ ] 支持 `LS_PDF_FIXTURE_DIR` 跑本地真实 PDF 增强测试。

### 17. Artifact Lifecycle

- [ ] 定义 document directory layout。
- [ ] `document.json` 记录 file hash、active parser artifact、active index version。
- [ ] artifact 记录 schema version、parser name、parser version、options hash、source file hash。
- [ ] parser version 变化时旧 artifact 标记 stale。
- [ ] 新 artifact 成功生成前不删除旧 artifact。
- [ ] 删除文献时清理 source copy、artifacts、indexes、jobs、derived assets。
- [ ] 清缓存时不删除 source PDF 和 annotations。
- [ ] vector / FTS index 支持按 document id 删除。
- [ ] schema migration 幂等，失败不破坏 source PDF 和 annotations。

### 18. Parse Job Scheduler

- [ ] 定义 `PdfParseJob` 模型。
- [ ] job 状态支持 pending / parsing / parsed / indexing / indexed / failed / cancelled / stale。
- [ ] 新下载 PDF 自动入低优先级后台队列。
- [ ] 打开 PDF 时提高该文档 parse priority，但不阻塞 reader。
- [ ] 同一 document / parser / file hash 只允许一个 active job。
- [ ] app 退出时持久化 pending / running job，重启后恢复。
- [ ] 支持 cancel / retry。
- [ ] 错误分类覆盖 encrypted、damaged、no-text-layer、parser-crash、OOM、artifact-write、index-write。
- [ ] 错误分类映射到 UI 操作：重试、跳过、需要 OCR、需要密码、查看日志。
- [ ] 重 CPU 解析放 worker / child process，Electron main 只调度。

### 19. Data Ownership

- [ ] 定义 document registry 的长期事实字段。
- [ ] 明确 reader session 只保存 transient selection / viewport state。
- [ ] 明确 annotation store 是用户标注事实源。
- [ ] 明确 parser artifact 是可重建派生数据。
- [ ] 明确 index store 是可重建派生数据。
- [ ] 删除 document 时通过 registry 统一清理 annotation、artifact、index、job。

### 20. Feature Flags

- [ ] 增加 `pdf.selection.v2`。
- [ ] 增加 `pdf.annotation.anchorV2`。
- [ ] 增加 `pdf.parser.pdfiumLite`。
- [ ] 增加 `pdf.parser.lsStructured`。
- [ ] 增加 `pdf.rag.indexPdf`。
- [ ] 增加 `pdf.rag.evidenceJump`。
- [ ] 增加 `pdf.externalArtifactImport`。
- [ ] 每个 flag 标记 dev-only / behind-flag / default-on 状态。

### 21. Security / Diagnostics / Compatibility

- [ ] PDF 文件大小、页数、bitmap pixel 设置上限或 warning。
- [ ] artifact 写入限制在 document directory 内。
- [ ] external artifact import 防路径穿越。
- [ ] parser JSON 做 schema validate。
- [ ] HTML table / formula / caption 展示前 sanitize。
- [ ] 增加脱敏 diagnostics export。
- [ ] 记录 selection diagnostic、parse job diagnostic、parser quality metrics、index metrics。
- [ ] 老 annotation anchor 继续显示。
- [ ] v2 reanchor 失败时保留 legacy anchor。
- [ ] feature flag 关闭后旧路径仍可工作。

## 门禁策略

PDF selection、文档解析、RAG ingest 都属于长期基础能力，不能只靠“功能看起来可用”合入。后续每一阶段都需要门禁，门禁失败时不进入主线、不默认开启、不写入长期索引。

### 1. License Gate

目标：防止受限协议污染主程序、打包产物、默认运行链路或长期 schema。

合入条件：

1. 新增 PDF / OCR / table / formula / parser 依赖前，必须记录 license、来源、版本、是否分发、是否运行时调用。
2. AGPL、GPL、未知自定义协议、带商业限制或强制开源风险的组件，默认不允许成为内置依赖。
3. 外部工具只能以 `external-artifact-import` 数据导入方式出现，不能在导入流程中执行外部 CLI、SDK、二进制或服务。
4. MinerU 只作为设计参考，不允许作为默认依赖、默认 API、默认任务队列或内置 sidecar。
5. 任何协议状态变化都必须重新 review，不能沿用旧结论。

需要产物：

1. `docs` 中记录 license review 结论。
2. dependency manifest 中标注新增依赖用途。
3. CI 或脚本检查高风险依赖关键词，例如 AGPL / GPL / unknown / custom。

### 2. Schema Gate

目标：防止外部工具或临时实现绑架长期知识库格式。

合入条件：

1. `ParsedDocument`、`ParsedBlock`、`EvidencePointer` 必须有 version。
2. artifact schema 只能由 Literature Studio 定义，外部输出必须通过 adapter 映射。
3. parser 输出必须包含 parser name、parser version、options hash、file hash。
4. schema 变更必须提供 migration 或 stale/rebuild 策略。
5. 写入长期索引前必须能从 passage 追溯到 block、page、bbox、quote。

拒绝条件：

1. 直接把第三方 JSON 原样作为核心 schema 保存。
2. passage 只有文本，没有 evidence pointer。
3. parser version 为空或不可复现。

### 3. Selection Quality Gate

目标：避免 PDF 选区体验回退。

合入条件：

1. 基础 smoke PDF 必须通过，选中文本包含 `Literature Studio PDF smoke`。
2. selection fixture 全部通过：affiliation、小字号脚注、abstract、双栏正文、references、公式上下文、caption。
3. 快速短拖、无 pointermove 拖选、同一行上下抖动、跨行拖选、跨页拖选都有自动测试。
4. selection text、text index range、highlight rect、status dataset 至少三者一致。
5. pointerup finalize 必须覆盖，不能只依赖 pointermove。
6. 失败命中必须给出 diagnostic reason，不能静默 miss。

最低门槛：

1. 自建 smoke PDF selection 成功。
2. affiliation 行短拖成功。
3. 上标附近不跳行。
4. 缩放后 selection 和 annotation 不漂移。

### 4. Parser Quality Gate

目标：防止低质量解析结果进入 RAG，并污染用户信任。

合入条件：

1. 每个 block 必须有 type、page、bbox、reading order、confidence。
2. 低置信度 block 可以存 raw artifact，但不能默认进入高置信 canonical passage。
3. 页眉页脚候选必须降权或排除。
4. 双栏 reading order 必须通过样本集。
5. parser regression snapshot 必须能比较 block count、reading order、text coverage、dropped text。

质量指标建议：

1. text coverage：原生 PDF 文本覆盖率不能异常下降。
2. reading-order violations：双栏样本不应出现左右栏交错。
3. header/footer leakage：普通 passage 中页眉页脚占比应低于阈值。
4. unknown blocks：未知类型过高时标记 parse quality warning。

### 5. RAG Evidence Gate

目标：任何被写作助手使用的证据都必须可回指。

合入条件：

1. 每个 indexed passage 必须有 `EvidencePointer`。
2. 检索结果必须带 document id、title、page、quote、rect 或 block id。
3. LLM 上下文组装时不能丢 evidence pointer。
4. 生成引用或证据说明时，只能引用带 pointer 的 passage。
5. 外部 artifact 导入的 passage 必须标记 provenance。

拒绝条件：

1. 只存 embedding，不存原文和证据位置。
2. 只返回摘要，不返回 page / quote / rect。
3. 多篇文献证据混合后无法拆回原来源。

### 6. Performance Gate

目标：reader 交互不能被离线解析拖慢。

合入条件：

1. reader selection hit-test 必须同步快速完成，不等待离线 parser。
2. PDF ingest 必须走异步 job，不阻塞 Electron 主线程和 renderer 交互。
3. 大 PDF 解析要有 progress、cancel、retry。
4. text page cache 有上限和释放策略。
5. overlay 渲染避免每次 pointermove 大量 DOM 重建。

建议门槛：

1. pointermove selection preview 目标保持在一帧预算内。
2. 首屏 PDF render 不等待 RAG parse。
3. 解析任务失败不影响 PDF 阅读。

### 7. Privacy / Locality Gate

目标：PDF 原文、论文数据、用户标注不能被意外发送到外部服务。

合入条件：

1. 默认解析链路本地运行。
2. 任何云端解析、外部 API、远程 OCR 都必须显式开关和用户确认。
3. job log 不记录完整论文正文，只记录 hash、页码、状态、错误摘要。
4. external artifact import 不自动上传源 PDF。
5. RAG 调用 LLM 时必须区分本地检索、远程模型、发送内容范围。

### 8. Security / Abuse Gate

目标：PDF、parser artifact、external artifact 都不能成为越界写入、资源耗尽或 XSS 的入口。

合入条件：

1. PDF 文件大小、页数、bitmap pixel、text char count 有上限或 warning。
2. artifact 写入路径必须限制在 document directory。
3. external artifact import 必须防路径穿越。
4. parser JSON 必须 schema validate 后才进入内部模型。
5. HTML table / formula / caption 渲染前必须 sanitize。
6. oversized / encrypted / damaged / image-only PDF 有明确错误分类。

拒绝条件：

1. 根据外部 artifact 中的路径直接写文件。
2. 在 renderer 中信任外部 HTML。
3. parser 失败导致 source PDF、annotation 或已有 index 被破坏。

### 9. Observability Gate

目标：出现 PDF 选区、解析、索引问题时可以复现和定位，同时不泄露原文。

合入条件：

1. selection miss 有 diagnostic reason。
2. parse job 有 phase、progress、duration、error code。
3. parser regression 有 text coverage、block count、unknown ratio、header/footer leakage。
4. index status 能显示 indexed / stale / failed。
5. diagnostics export 默认脱敏，不导出完整论文正文和 annotation 正文。

### 10. Backward Compatibility Gate

目标：新 selection、annotation、parser、index 能力不能破坏已有用户数据。

合入条件：

1. legacy annotation anchor 继续显示。
2. v2 reanchor 失败时保留 legacy。
3. feature flag 关闭后旧路径仍可工作。
4. workspace 中旧 PDF tab state 仍能打开。
5. migration 幂等，失败不影响 PDF 阅读和老标注显示。

### 11. UX Gate

目标：用户能理解当前 PDF 的可选中、可解析、可索引状态。

合入条件：

1. PDF 状态栏显示 selection / parse / index 的关键状态。
2. 扫描 PDF 明确提示需要 OCR，而不是表现为“坏了”。
3. 解析失败给出可操作信息：重试、查看日志、跳过索引。
4. 搜索结果点击后必须能跳回 PDF 页和证据位置。
5. annotation 与 RAG evidence 的高亮语义不能混淆。
6. 基础阅读动作不低于 Edge 对照基线：zoom、fit、rotate、jump、search 至少有清晰入口和状态反馈。
7. 选区后的 copy / highlight / note / translate / evidence capture 使用统一 selection range，不产生入口间行为差异。

### 12. Release Gate

目标：默认功能只开启已经过门禁的能力。

分级：

1. `dev-only`：实验代码，仅本地调试，不写长期数据。
2. `behind-flag`：可选启用，artifact version 明确，可重建。
3. `default-on`：通过 license、schema、selection、parser、RAG、performance、privacy、security、observability、compatibility、UX gate。

默认开启条件：

1. 无高风险协议依赖。
2. 可回滚或可重建 artifact。
3. 样本集 regression 通过。
4. 失败不会破坏原始 PDF、标注和已有索引。
5. 用户能看到状态并能手动重试。

## 结论

短期不要把 PDF 选区问题当成一个单点 fix。它暴露的是 reader selection、annotation anchor、document extraction、RAG evidence 之间还没有统一文本与坐标模型。

合理路线是：

1. 先把 reader selection 升级为 PDFium text index + PDF-space rect 的稳定模型。
2. 再建立轻量 PDF ingest，打通知识库索引和 evidence pointer。
3. 然后参考 MinerU 的模块边界和输出形态，实现我们自己的解析 adapter 和 artifact schema。
4. 最终让 PDF 阅读、标注、检索、写作引用都回到同一套可追溯证据链。
