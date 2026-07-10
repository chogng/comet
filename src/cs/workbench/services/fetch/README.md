# Fetch architecture

Fetch 对外提供两条意图明确的 workflow，不根据 URL 猜页面角色：

```text
fetchFromArticleList(listUri)
  → Site
  → ArticleListSource
  → FetchPageSession
  → exactly one ArticleListParser proof
  → FetchArticleCandidate[]
  → fetchArticleDetail(candidate.sourceUri)
  → FetchArticle[]
```

```text
fetchArticleDetail(articleUri)
  → Site
  → optional site article identity
  → FetchPageSession
  → exactly one ArticleDetailParser proof
  → DOI / Publication / ArticleKind reconciliation
  → FetchArticleProof
  → FetchArticle
```

批量入口只能调用 article-list workflow；单篇入口只能调用 article-detail workflow。代码中不得恢复“不是 article 就默认 listing”的分流。

## Model and result boundaries

`FetchArticle`、`FetchArticleCandidate`、`FetchArticleKind`、`FetchArticlePublication` 和 `FetchArticleProof` 是跨 Electron IPC 与历史 JSON 的 wire model，因此位于 `cs/base/parts/sandbox/common/`。URI 字段保存为 `UriComponents`，业务代码通过 `URI.revive()` 或 `fetchArticle.ts` 中的领域函数读取。

Workflow 结果位于 `services/fetch/common/`：

- `FetchArticleListRunResult` 只包含候选统计、分页和列表 diagnostics。
- `FetchArticleDetailFetchResult` 只包含 article、article proof 和详情 diagnostics。

不得重新引入同时承载列表与详情字段的通用结果。

## Resolution

所有选择都执行严格的 0/1/>1 检查：

```text
URI → exactly one Site
list URI → exactly one ArticleListSource
loaded list snapshot → exactly one allowed ArticleListParser proof
loaded article snapshot → exactly one ArticleDetailParser proof
```

零个匹配表示 unsupported，多个匹配表示 ambiguous。禁止通过注册顺序、priority 或 preferred parser ID 消解重叠；重叠必须通过修正 matcher 消除。

## ArticleListSource and ArticleListParser

`ArticleListSource` 回答“这是哪个列表入口”，拥有：

- URI matcher；
- 允许使用的 parser IDs；
- pagination policy；
- RSS 等显式 enrichment policy。

`ArticleListParser` 回答“这个 snapshot 的列表结构是什么”，只负责：

- 返回结构证据；
- 从稳定容器提取文章 URI 与 metadata hints；
- 返回 candidates 和 diagnostics。

Parser 不加载网页、不执行翻页、不请求 RSS、不抓取详情页。稳定容器不匹配时必须报告 unsupported structure；不得扫描全页 article anchor 作为 fallback。

## ArticleDetailParser

Article detail parser 按“同一发布平台、同一代页面系统、同一内容载体”复用，而不是按 Publication 或 ArticleKind 拆分。

Nature 当前只有一套有结构证据的详情 parser：`nature.article.v1`。`s*` / `d*` URL identity 仍保留 page-family、DOI 和 Publication hints；其中 page-family 只用于同一 parser 内的显式抽取策略，不能伪造两套没有互斥 DOM 证据的 parser。

Publication 和 ArticleKind 是 parser 输出后的语义分类。它们可以影响 proof 要求，但不得参与 parser 选择。

DOI 只从明确 metadata、JSON-LD article identifier、限定的 citation 区域和站点 article URL identity 收集。强证据冲突必须失败；不得扫描正文或 references 中的 DOI。

## FetchPageSession

`FetchPageSession` 是唯一拥有 BrowserView 页面生命周期的 Fetch 层：

- 创建或复用 BrowserView resource；
- 导航、readiness、settle 和 HTML snapshot；
- background 与 browser editor presentation；
- 结束时释放仍由 Fetch 拥有的后台页面。

Site、Source 和 Parser 不得操作 BrowserView、WebContents、Editor 或 CDP。Parser 的唯一页面输入是已获取的 HTML snapshot。

## Site providers

`fetchSitesProvider.ts` 只注册普通 site provider 对象。Site 内部 Source、Parser、identity resolver、publication resolver 和 classifier 不注册为 DI singleton；共享 DI 边界只保留顶层 Fetch service 与 PageSession service。

当前注册的 evidence-backed 支持：

- Nature：research/reviews archive、latest news、opinion 列表；统一的当前代 article 详情。
- Science：Science current 与 Science Advances current 列表；Science 详情。
- ACS、Wiley：详情。

新增 Issue、News landing、Legacy 或其他页面族之前，必须先加入真实 fixture 并证明 matcher 与现有 parser 结构互斥。
