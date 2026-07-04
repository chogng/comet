# Source Extractors

`sourceExtractors/` 只服务于列表页抓取流程。

它们的职责不是直接抓正文，也不是决定调度，而是告诉 `fetchListing.ts`:

- 当前列表页 URL 是否命中某个专用 extractor
- 应该优先提取哪些候选文章链接
- 候选在页面里的顺序 `order`
- 是否能顺手提取 `dateHint`、`articleType`、`scoreBoost`
- 是否能找到下一页
- 是否需要做一次轻量补全 `refineExtraction()`

## 当前分层

- `detect.ts`: 检测入口页是 `detail` 还是 `listing`
- `dispatch.ts`: 调度入口，决定走 `fetchDetail` 还是 `fetchListing`
- `fetchDetail.ts`: 单文章页抓取
- `fetchListing.ts`: 列表页抓取
- `sourceExtractors/*`: 列表页专用候选提取器

所以这里的 extractor 只参与 `listing` pipeline，不参与 `detail` pipeline。

## Extractor 边界

在主流程里，extractor 的职责保持克制：

1. `matches(page)`
判断当前 URL 是否命中这个 extractor。

2. `extract(context)`
从列表页 DOM 中提取 `ListingCandidateSeed[]`。

3. `refineExtraction(context)`
可选。在已有 candidates 基础上补充信息，比如日期。

4. `findNextPageUrl(context)`
可选。告诉 `fetchListing` 如何翻到下一页。

5. `evaluatePaginationStop(context)`
可选。给出“是否应该停止翻页”的策略判断。

下面这些事情仍然由统一的 listing 流程负责：

- URL 归一化
- 同域过滤
- 日期范围过滤
- candidate 打分与预算控制
- 并发抓取正文页
- 文章正文解析与验收

也就是说，extractor 负责“更准确地指出该先试哪些链接”，而不是重写整条抓取链路。

## 什么时候值得写专用 Extractor

通常满足下面条件，才值得新增专用 extractor：

- 这是稳定入口页，用户会频繁从这里抓最新文章
- 通用列表提取不够准，或者顺序不稳定
- 页面上存在明显的结构化信号，值得利用
- 分页规则或日期信号比较稳定

如果页面结构变化很大、没有明显规律，优先继续依赖通用逻辑。

## 推荐实现顺序

1. 先写 `matches()`
优先使用稳定的 URL 信号：`host`、`pathname`，必要时再加 `query`。

2. 再写 `extract()`
先明确 candidate root 和顺序来源，不要一上来堆 selector。

3. 优先提取 `dateHint`
只要页面里有可信日期信号，就尽量提取出来，这会直接影响日期过滤和提前停止翻页。

4. 有需要时再加 `refineExtraction()`
适合用轻量外部信号补齐缺失字段，例如 RSS 或页面隐藏元数据。

5. 最后再实现 `findNextPageUrl()`
能复用通用分页逻辑就复用，不要为了“专用”而重写一遍。

## 推荐模式

### 1. Shared Only

只实现 `matches()`，其余尽量复用共享 extractor。

适合：

- 页面价值一般
- 结构不够稳定
- 暂时不值得维护定制 selector

### 2. Custom Extract + Shared Fallback

先做定制 DOM 提取，失败时回退到共享 extractor。

这是当前最推荐的默认模式。

### 3. Custom Extract + Fallback + Refine

在上面的基础上，再通过 `refineExtraction()` 引入轻量补充信号。

适合：

- 列表 DOM 经常不给全信息
- 但存在稳定的外部补充源

## 设计原则

- extractor 应该尽量小，只做页面专属知识
- 通用能力优先沉到共享层
- diagnostics 要保留，方便页面改版后排查
- 专用 extractor 的价值在于“稳定提高候选质量”，不是“接管整个抓取流程”
