# PDF 内部版面模型方案

## 目的

这份文档用于约束后续 PDF 阅读器的演进方向：PDF 仍然负责提供原始视觉事实，我们在它之上构建一套自己的版面模型，用这套模型承接选择、高亮、批注、搜索、翻译、AI 定位和缩放同步。

核心目标不是把 PDF 彻底重排成另一份可见文档，而是生成一份和 PDF 坐标严格绑定的内部排版文件。用户看到的仍然像原始 PDF，交互层则完全由我们掌控。

## 先说结论

默认采用混合架构：

1. PDFium 渲染页面 bitmap/canvas，保证视觉永远和原 PDF 一致。
2. 我们从 PDFium 抽取文字、字符框、字体信息、坐标和页面信息。
3. 我们把抽取结果整理成 `PdfLayoutModel`，包含 page、block、line、span、char、reading order 和 normalized rects。
4. 选择、高亮、批注、搜索和翻译不直接依赖临时字符框，而是走 `PdfLayoutModel`。
5. 缩放只改变 viewport scale；layout model 保持 PDF 坐标不变，所有 overlay rect 在渲染时再映射到 viewport。

不建议第一阶段直接“用 HTML/CSS 复刻 PDF 页面并替代 PDF canvas”。论文 PDF 中的字体嵌入、连字、字距、公式、裁剪、透明、图片和双栏排版很容易让复刻结果出现细小偏差，而这些偏差会破坏用户对 PDF 阅读器的信任。

## 当前问题

当前 PDF 交互的主要问题来自一件事：我们直接把 PDFium 的字符框当作交互事实。

这会带来几个问题：

1. `FPDFText_GetCharBox` 返回的是 PDF 内部字符框，不等于视觉字形框。
2. 单个字符框在斜体、上标、下标、连字、不同字体大小混排时高度不稳定。
3. 多行选择时，如果每一行单独扩展高亮 rect，相邻行之间容易发生覆盖。
4. 双栏、页眉、脚注、图注和正文之间缺少稳定 reading order。
5. 批注只锚定 rect 和 quote 时，后续缩放、重渲染、局部卸载页面都容易让交互逻辑变散。

因此后续不应该继续在 `PdfSelectionController` 里堆越来越多临时几何规则，而应该把规则下沉到稳定的 layout 层。

## 架构分层

### 1. PDF 渲染层

职责：

1. 加载 PDF 数据。
2. 使用 PDFium 渲染页面 canvas。
3. 管理页面虚拟化、bitmap 输出倍率和 zoom rerender。

典型落点：

1. `src/ls/editor/browser/pdf/pdfDocumentReader.ts`
2. `src/ls/editor/browser/pdf/vendor/pdfium/`

不负责：

1. 决定 selection 的语义边界。
2. 决定批注 anchor 的稳定结构。
3. 推断段落、双栏、reading order。

### 2. 文本抽取层

职责：

1. 从 PDFium 抽取 page size、char text、char index、char box。
2. 尽量补充 font size、font weight、char angle、origin 等低层信息。
3. 输出尽量原始、可缓存、可测试的数据。

建议落点：

1. `src/ls/editor/browser/pdf/pdfTextExtractor.ts`
2. `src/ls/editor/browser/pdf/pdfReviewerTypes.ts`

输出对象应保持接近 PDFium 事实，不做过多交互策略。

### 3. 版面模型层

职责：

1. 将字符聚合成 line。
2. 将 line 聚合成 block。
3. 推断 column 和 reading order。
4. 为每个 line 生成稳定的 selection rect。
5. 为 char offset、line offset、page coord、viewport coord 提供转换 API。

建议落点：

1. `src/ls/editor/browser/pdf/pdfLayoutModel.ts`
2. `src/ls/editor/browser/pdf/pdfLayoutGeometry.ts`
3. `src/ls/editor/browser/pdf/tests/pdfLayoutModel.test.ts`

这是后续 PDF 交互的中心。

### 4. 交互层

职责：

1. pointer 命中 layout model。
2. 将 anchor/focus 转成稳定 selection range。
3. 创建高亮、批注、搜索命中和翻译范围。

典型落点：

1. `src/ls/editor/browser/pdf/pdfSelectionController.ts`
2. `src/ls/editor/browser/pdf/pdfAnnotationStore.ts`
3. `src/ls/editor/browser/pdf/pdfAnnotationPersistence.ts`

原则：

1. 交互层不直接重新发明行合并算法。
2. 交互层只调用 layout model 的命中、range、rect API。
3. 鼠标、触控板、键盘选择应共享同一套 range 语义。

### 5. Overlay 渲染层

职责：

1. 根据 layout model 或 annotation anchor 绘制 selection/highlight/note/search overlay。
2. 将 PDF 坐标 rect 映射到当前 viewport。
3. 保证缩放、页面重绘和虚拟化后 overlay 仍可恢复。

典型落点：

1. `src/ls/editor/browser/pdf/pdfDocumentReader.ts`
2. `src/ls/editor/browser/pdf/media/pdfDocumentReader.css`

原则：

1. selection 和 annotation 可以共享 rect 渲染管线，但视觉样式要分开。
2. selection 不建议使用 `mix-blend-mode: multiply`，避免轻微重叠被视觉放大。
3. annotation 可以保留更强的可见性，但仍应避免多层叠色造成误读。

## 数据模型草案

### PdfLayoutModel

```ts
export type PdfLayoutModel = {
  pages: readonly PdfLayoutPage[];
  version: number;
};
```

### PdfLayoutPage

```ts
export type PdfLayoutPage = {
  page: number;
  width: number;
  height: number;
  chars: readonly PdfLayoutChar[];
  lines: readonly PdfLayoutLine[];
  blocks: readonly PdfLayoutBlock[];
  columns: readonly PdfLayoutColumn[];
};
```

### PdfLayoutChar

```ts
export type PdfLayoutChar = {
  index: number;
  text: string;
  rect?: PdfRect;
  origin?: { x: number; y: number };
  fontSize?: number;
  angle?: number;
  lineId?: string;
  blockId?: string;
};
```

### PdfLayoutLine

```ts
export type PdfLayoutLine = {
  id: string;
  page: number;
  blockId?: string;
  startCharOffset: number;
  endCharOffset: number;
  text: string;
  baselineY?: number;
  rect: PdfRect;
  selectionRect: PdfRect;
  readingOrder: number;
};
```

约定：

1. `rect` 表示原始行内容的紧包围盒。
2. `selectionRect` 表示交互选区应该使用的行框。
3. `selectionRect` 必须裁剪到相邻行中线以内，避免多行选区重叠。
4. `startCharOffset` inclusive，`endCharOffset` exclusive。

### PdfLayoutBlock

```ts
export type PdfLayoutBlock = {
  id: string;
  page: number;
  kind: 'text' | 'title' | 'heading' | 'caption' | 'footnote' | 'header' | 'footer' | 'unknown';
  lineIds: readonly string[];
  rect: PdfRect;
  readingOrder: number;
  columnId?: string;
};
```

### PdfLayoutSelectionRange

```ts
export type PdfLayoutSelectionRange = {
  page: number;
  startCharOffset: number;
  endCharOffset: number;
  text: string;
  rects: readonly PdfRect[];
  lineIds: readonly string[];
};
```

后续 `PdfSelectionRange` 可以逐步向这个结构靠拢，或者直接由 layout range 生成。

## 核心 API 草案

### 命中

```ts
findTextBoundaryAtPoint(
  page: PdfLayoutPage,
  point: { x: number; y: number },
  options?: { strict?: boolean },
): PdfTextBoundary | null;
```

规则：

1. 先命中 line，再在线内命中 char boundary。
2. strict 模式用于 pointerdown，避免空白区域误吸附。
3. 非 strict 模式用于拖拽过程，允许拖出行尾、行首后吸附到边界。

### 范围生成

```ts
createSelectionRange(
  page: PdfLayoutPage,
  startCharOffset: number,
  endCharOffset: number,
): PdfLayoutSelectionRange | null;
```

规则：

1. range text 来自 chars。
2. range rects 来自 line selectionRect 和选中字的左右边界。
3. 多行 rect 不允许相互覆盖。
4. 空白字符可以参与 text，但不应该制造异常宽的 rect。

### 坐标转换

```ts
pdfRectToViewportRect(
  page: PdfLayoutPage,
  rect: PdfRect,
  scale: number,
): PdfRect;
```

规则：

1. layout model 永远保存 PDF 坐标。
2. DOM 绘制时才转换到 viewport 坐标。
3. zoom 不应改变 layout model，只改变映射 scale。

## Selection Rect 规则

这是解决当前选取框问题的关键。

### 行框生成

每一行应同时维护两个盒子：

1. `contentRect`：字符真实 bbox 的 union。
2. `selectionRect`：用于交互显示的稳定行框。

`selectionRect` 的生成建议：

1. 基于本行 `contentRect` 适度上下扩展。
2. 上边界不得超过本行和上一行中线。
3. 下边界不得超过本行和下一行中线。
4. 左右边界由选中字符决定，而不是整行决定。
5. 如果字符 bbox 异常高或异常低，应使用该行的中位高度参与计算，而不是直接信任极值。

### 多行选择

多行选择时：

1. 第一行左边界从 start char 开始，右边界到行尾。
2. 中间行使用该行完整文本边界。
3. 最后一行左边界从行首开始，右边界到 end char。
4. 每一行的上下边界来自该行 `selectionRect`。
5. 相邻行之间允许有空隙，不允许互相叠色。

### 视觉样式

selection 建议：

```css
.pdf-reader-highlight.is-selection {
  background: rgba(69, 135, 236, 0.26);
}
```

annotation 建议：

```css
.pdf-reader-highlight.is-annotation {
  background: rgba(255, 211, 61, 0.44);
  outline: 1px solid rgba(188, 140, 0, 0.32);
}
```

默认不要给 selection 加 outline。outline 会把字符框误差放大成明显的矩形问题。

## Reading Order 规则

论文 PDF 常见双栏，不能只按 PDF 字符流顺序使用。

第一阶段只需要保守推断：

1. 按 y 方向聚行。
2. 检测每页主要文本列的 x 分布。
3. 如果出现两个稳定 column，则按左栏从上到下、右栏从上到下排序。
4. 页眉页脚、页码、侧边标签可以先标为 `header/footer/unknown`，不参与正文连续选择的优先路径。
5. 图注和表注暂时允许作为独立 block，不强行并入正文。

后续可以引入更复杂规则：

1. 标题/作者/摘要识别。
2. 图表区域识别。
3. 参考文献区域识别。
4. 跨页段落延续。

## 批注 Anchor 规则

批注不应该只存 rect。建议逐步变成多重 anchor：

```ts
export type PdfAnnotationAnchor = {
  kind: 'pdf';
  page: number;
  ranges: readonly PdfLayoutSelectionRange[];
  quote: string;
  fingerprint?: {
    beforeText?: string;
    afterText?: string;
    pageTextHash?: string;
    layoutVersion?: number;
  };
};
```

恢复优先级：

1. 优先用 page + char range + layout version 恢复。
2. 如果 layout version 不匹配，用 quote + before/afterText 在同页搜索。
3. 如果同页搜索失败，再用 rect 做近似恢复。
4. 如果全部失败，保留批注但标记为需要重新定位。

## 缓存策略

layout model 可以按文档目标缓存。

建议 key：

1. `targetId`
2. PDF 文件大小
3. PDF 修改时间或内容 hash
4. layout algorithm version

缓存内容：

1. page size
2. chars
3. lines
4. blocks
5. reading order

不缓存：

1. viewport rect
2. zoom 后的 CSS 坐标
3. 当前 selection 状态

## 实施路线

### Phase 1：抽出布局模型

目标：

1. 新增 `pdfLayoutModel.ts`。
2. 把当前 `PdfSelectionController` 内的行聚合逻辑迁进去。
3. `PdfSelectionController` 改成调用 layout API。
4. 保持视觉渲染和现有 annotation 格式基本不变。

验收：

1. 单行选择稳定。
2. 多行选择不重叠。
3. 空白区 pointerdown 不误选。
4. 缩放后 selection/annotation 仍对齐。

### Phase 2：稳定 range 与 annotation

目标：

1. `PdfSelectionRange` 增加 line ids / char offsets。
2. annotation persistence 存储多重 anchor。
3. 批注恢复从 rect 优先改成 char range 优先。

验收：

1. 切换 tab 后批注位置稳定。
2. zoom rerender 后批注位置稳定。
3. 页面虚拟化卸载再加载后批注位置稳定。

### Phase 3：双栏和 block

目标：

1. 推断 column。
2. 推断 block。
3. selection text 按 reading order 输出。
4. 搜索、翻译、AI 引用使用 reading order。

验收：

1. 双栏论文复制文本顺序合理。
2. 跨栏选择不会跳到页眉、侧边标签。
3. 摘要、正文、参考文献可以作为独立块被识别或近似识别。

### Phase 4：语义阅读层

目标：

1. 在保持 PDF 原始视觉页面的基础上，提供结构导航和 AI 上下文。
2. 可以新增“重排阅读模式”，但不替代默认 PDF 页面。

验收：

1. 用户默认看到原始 PDF。
2. 结构导航和正文抽取有稳定来源。
3. 移动端或窄屏场景可以选择进入重排阅读。

## 不做什么

第一阶段明确不做：

1. 不用 HTML/CSS 完整复刻 PDF 页面。
2. 不把 PDF canvas 移除。
3. 不尝试完美识别所有论文结构。
4. 不把 selection 样式问题继续堆在 CSS 上解决。
5. 不用 OCR 替代 PDFium 文本抽取。

## 测试要求

至少覆盖：

1. 单行选择。
2. 多行选择。
3. 行距很紧的多行选择。
4. 斜体、上标、下标混排。
5. 双栏 reading order。
6. 页眉页脚不干扰正文选择。
7. zoom 前后 rect 映射稳定。
8. annotation restore。

测试文件建议：

1. `src/ls/editor/browser/pdf/tests/pdfLayoutModel.test.ts`
2. `src/ls/editor/browser/pdf/tests/pdfSelectionController.test.ts`
3. 必要时增加小型 fixture，不依赖真实大 PDF。

## 代码落点建议

建议最终拆成这些文件：

1. `pdfReviewerTypes.ts`：共享基础类型，如 `PdfRect`、page info、char info。
2. `pdfTextExtractor.ts`：PDFium text page 抽取。
3. `pdfLayoutModel.ts`：char -> line -> block -> column。
4. `pdfLayoutGeometry.ts`：rect 合并、裁剪、坐标转换。
5. `pdfSelectionController.ts`：pointer/keyboard selection orchestration。
6. `pdfAnnotationStore.ts`：运行时 selection/annotation state。
7. `pdfAnnotationPersistence.ts`：批注持久化与恢复。

## 一句话原则

PDF canvas 保证“看起来是真的”，`PdfLayoutModel` 保证“交互起来是我们的”。
