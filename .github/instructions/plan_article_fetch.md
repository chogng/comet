# Plan：多期刊 Article Fetch 重构

## 0. 结论

本次重构只暴露一个文章抓取服务：

~~~ts
IFetchService
~~~

不同出版商家族通过内部 Provider 扩展：

~~~ts
IFetchProvider
~~~

公共领域不再使用 Nature 专属的固定层级：

~~~text
ExploreContentItem
└── ArticleTypeItem
~~~

最终公共主链为：

~~~text
Journal
└── ArticleListSource
    └── Article
~~~

完整抓取结构允许来源目录和抓取结果拥有不同的可选分组：

~~~text
Journal
├── ArticleListSourceGroup      来源发现阶段的可选分组
│   └── ArticleListSource       实际可抓取的叶子入口
└── ArticleListSource           未分组的实际抓取入口
    └── ArticlePage
        ├── ArticleGroup        结果页面中的可选展示分组
        │   └── ArticleListItem
        └── ArticleListItem
            └── ArticleRecord
                └── ArticleDetail
~~~

Nature 与 Science 的映射不同：

~~~text
Nature
Journal
└── ArticleListSourceGroup      Explore content
    └── ArticleListSource       Article type
        └── Article

Science
Journal
└── ArticleListSource           Current Issue / First Release
    └── ArticlePage
        └── ArticleGroup        Section
            └── Article
~~~

Nature 的 Article type 决定抓取哪个文章列表。Science 的 Article type 通常只是文章元数据，可能在列表卡片中出现，也可能直到详情页才被发现。

---

## 1. 目标

建立支持多出版商、多期刊、多来源、期次、结果分组、分页和文章详情抓取的统一架构。

核心目标：

1. 调用方只依赖 IFetchService。
2. 每个期刊拥有稳定 JournalId。
3. JournalDescriptor 保存 homeUrl 作为官网快速访问入口。
4. JournalDescriptor 保存 discoveryUrl 作为 Provider 发现文章列表来源的起点。
5. Nature 的 Explore content、Article type 和 Science 的 Current Issue、Section 均由页面动态解析。
6. Publisher 专属术语不进入公共领域模型。
7. Article list 与 Article detail 分阶段抓取，但由同一个服务管理。
8. ArticleListItem、ArticleRecord、ArticleDetail 保持独立语义。
9. FetchPageSession 复用 IPlaywrightService 获取类型化 HTML Snapshot；Fetch Provider 负责出版商解析。
10. 公共资源使用 URI；href 只存在于 HTML Parser 局部。
11. 所有长时间运行的抓取 API 接收 CancellationToken。
12. 不保留旧接口、兼容别名、Facade、Adapter 或 Re-export。

第一版只定义规范化运行时状态，不承诺持久化存储。若未来需要跨启动恢复，必须单独设计存储版本、失效和迁移协议。

---

## 2. 架构边界

~~~text
Contribution
├── 注册 JournalDescriptor
└── 注册 FetchProviderDescriptor

IFetchService
├── 发现期刊的 ArticleListSource Catalog
├── 抓取 ArticleListSource
├── 抓取下一页
├── 抓取 Article detail
├── 管理状态、并发、缓存和错误
└── 发布变化事件

IFetchProvider
├── NatureFetchProvider
├── ScienceFetchProvider
├── AcsFetchProvider
└── ...

IFetchPageSession
├── 目标页面导航
├── 导航成功验证
├── readiness
├── 调用 IPlaywrightService.captureSnapshot()
└── Snapshot URI admission

IPlaywrightService
├── BrowserView Page tracking
├── Playwright session routing
├── Playwright Page 生命周期
├── ARIA Snapshot
└── 类型化 HTML Snapshot

Parser
├── 只读取 detached Document
├── 不创建 BrowserView
├── 不管理 Cookie
├── 不发起网络请求
└── 不写入 Fetch 状态
~~~

运行链路：

~~~text
IFetchService
    ↓
IFetchProvider
    ↓
IFetchPageSession
    ↓
IPlaywrightService.captureSnapshot()
    ↓
IBrowserPageSnapshot
    ↓
DOMParser
    ↓
Provider-owned Parser Resolver
    ↓
Publisher Parser
    ↓
Parsed Result
    ↓
ID Factory + normalization
    ↓
FetchService state
~~~

进程边界固定为：

~~~text
electron-browser
├── IFetchService 运行时状态与编排
├── IFetchPageSession
├── Provider / Parser / Registry
├── 通过 IBrowserViewService 创建、导航和销毁 BrowserView
└── 通过 IPlaywrightService remote service 读取 Snapshot

shared process
└── IPlaywrightService 的 PlaywrightService / PlaywrightSession / PlaywrightTab

electron-main
└── BrowserView WebContentsView 实现与主进程 IPC
~~~

现有 `src/cs/workbench/services/fetch/electron-main` 的抓取编排必须直接迁移到 electron-browser service，不保留主进程 Facade、Adapter 或双轨状态。Contribution 只负责 Action、Menu 和注册，不拥有 Fetch 业务状态。

---

## 3. Stable IDs

~~~ts
export type JournalId = string;
export type FetchProviderId = string;
export type ArticleListSourceId = string;
export type ArticlePageId = string;
export type ArticleGroupId = string;
export type ArticleListItemId = string;
export type ArticleId = string;
~~~

所有 ID 必须通过统一 Factory 生成。Parser、Provider 和 Service 不得各自拼接 ID。

JournalId 显式声明：

~~~text
journal.nature.nature
journal.nature.nature-communications
journal.science.science
journal.science.science-advances
~~~

动态 ID 规则：

~~~ts
createArticleListSourceId(journalId, canonicalSourceUri);
createArticlePageId(sourceId, canonicalPageUri);
createArticleGroupId(pageId, groupIndex);
createArticleId(journalId, canonicalArticleUri);
createArticleListItemId(pageId, articleId, providerOccurrenceKey);
~~~

ArticleListSourceGroup 是 Catalog Snapshot 内的嵌套展示结构，没有独立查询、刷新或变化事件，因此不分配长期 ID。它的 label 变化或 Source 成员增减只表示新 Catalog Snapshot，不需要推导 providerGroupKey。

providerOccurrenceKey 表示文章在某个 Page Snapshot 中的一次具体出现。Provider 应使用稳定卡片 key；页面没有稳定 key 时，使用明确的 `groupKey + occurrenceIndex`。同一文章在 featured 区域和普通 Section 同时出现时必须产生不同 ArticleListItemId。结果页面中的 ArticleGroup 只在所属 Page Snapshot 内需要稳定，因此使用 pageId 和页面顺序生成。

ArticleId 始终基于 journalId 和 canonical article URI，首次创建后不改变。DOI 是可补充的外部标识，不参与后续身份升级。

同一文章在详情页发现 DOI 时：

~~~text
ArticleId 保持不变
ArticleRecord.doi 更新
DOI 二级索引更新
~~~

禁止把 url:... 身份替换为 doi:... 身份。

### 3.1 Canonical URI

稳定 ID 依赖的 canonical URI 必须由 Provider 通过明确方法生成：

~~~ts
canonicalizeSourceUri(uri: URI): URI;
canonicalizePageUri(uri: URI): URI;
canonicalizeArticleUri(uri: URI): URI;
~~~

通用层只处理 URI 语法级规范化，包括 scheme/host 大小写、默认端口和空 fragment。Provider 负责 Publisher 语义：

1. 删除已明确证明只用于追踪的参数。
2. 保留会改变 Source、分页、排序、日期范围或文章身份的 query。
3. 移除不参与服务端资源身份的 fragment。
4. 只根据明确的 Publisher 规则合并 redirect 后的等价 URL。
5. 不允许“删除全部 query”或“尝试多套 canonicalization”。

每个 Provider 必须用 Fixture 分别验证等价 URL 生成相同 ID，以及非等价 URL 不被合并。

---

## 4. JournalDescriptor

~~~ts
export interface JournalDescriptor {
	readonly id: JournalId;
	readonly title: string;

	/**
	 * 官网快速访问入口。
	 */
	readonly homeUrl: URI;

	/**
	 * Provider 发现 ArticleListSource 的起始页面。
	 *
	 * Nature 可以是 articles 根页面。
	 * Science 可以是包含 Current Issue 入口的期刊主页。
	 */
	readonly discoveryUrl: URI;

	readonly providerId: FetchProviderId;
}
~~~

JournalDescriptor 不包含：

~~~text
Explore content
Article type
Current Issue
First Release
Section
Parser ID
Menu ID
~~~

这些数据均由 Provider 运行时发现。

---

## 5. ArticleListSource Catalog

Catalog 描述某个 Journal 当前可用的实际文章列表入口。

~~~ts
export interface ArticleListCatalog {
	readonly journalId: JournalId;
	readonly entries: readonly ArticleListCatalogEntry[];
}

export type ArticleListCatalogEntry =
	| ArticleListSourceGroup
	| ArticleListSource;

export interface ArticleListSourceGroup {
	readonly kind: 'group';
	readonly label: string;
	readonly sources: readonly ArticleListSource[];
}

export interface ArticleListSource {
	readonly kind: 'source';
	readonly id: ArticleListSourceId;
	readonly journalId: JournalId;
	readonly label: string;
	readonly url: URI;
}
~~~

ArticleListSourceGroup 只组织可抓取 Source，不允许嵌套 Group。

Nature 示例：

~~~text
ArticleListSourceGroup: Research articles
├── ArticleListSource: Article
├── ArticleListSource: Matters Arising
└── ArticleListSource: Registered Report

ArticleListSourceGroup: Reviews & Analysis
├── ArticleListSource: Review Article
└── ArticleListSource: Perspective
~~~

Science 示例：

~~~text
ArticleListSource: Current Issue
ArticleListSource: First Release
~~~

Science 不创建虚假的 Source Group。

Videos、Collections、Subjects 等入口只有在其 URL 实际返回文章列表时才注册为 ArticleListSource。不能为了补齐层级创建空 Source。

---

## 6. ArticlePage 与 ArticleGroup

ArticlePage 表示 ArticleListSource 的一次真实页面结果。

~~~ts
export interface ArticlePage {
	readonly id: ArticlePageId;
	readonly sourceId: ArticleListSourceId;
	readonly url: URI;

	/**
	 * Science Current Issue 等页面的期次信息。
	 */
	readonly issue?: IssueMetadata;

	/**
	 * 页面存在 Section 时按页面顺序保存。
	 */
	readonly groups: readonly ArticleGroup[];

	/**
	 * 页面不存在 Section 时使用。
	 */
	readonly ungroupedItemIds: readonly ArticleListItemId[];

	readonly nextPageUrl?: URI;
}

export interface IssueMetadata {
	readonly volume?: string;
	readonly issue?: string;
	readonly publishedAt?: string;
	readonly canonicalUrl?: URI;
}

export interface ArticleGroup {
	readonly id: ArticleGroupId;
	readonly label: string;
	readonly itemIds: readonly ArticleListItemId[];
}
~~~

ArticleGroup 是抓取结果分组，不是来源入口。

Science 示例：

~~~text
ArticleGroup: Commentary
├── Expert Voices article
└── Perspectives article

ArticleGroup: Research
└── Research articles
~~~

Nature 的普通 Article type 列表没有 Section 时：

~~~text
groups: []
ungroupedItemIds: [...]
~~~

分页身份必须保留 page、cursor、start、date、sort 等会改变结果的参数。不能只使用数字页码。

同一个页面 URL 被重新抓取时，替换该 Page 的当前内容，不得因为 PageId 已存在就忽略更新。

---

## 7. ArticleListItem 与 ArticleRecord

ArticleListItem 表示某篇文章在特定列表页面中的卡片快照。

~~~ts
export interface ArticleListItem {
	readonly id: ArticleListItemId;
	readonly articleId: ArticleId;

	readonly title: string;
	readonly description?: string;

	/**
	 * 只有列表 DOM 中存在真实 Abstract 内容时才保存。
	 */
	readonly abstract?: string;

	/**
	 * 列表卡片中显示的类型。Science 中可能不存在。
	 */
	readonly articleType?: string;

	readonly subject?: string;
	readonly publishedAt?: string;
	readonly pageRange?: string;
	readonly isOpenAccess?: boolean;

	/**
	 * 列表页显示的作者，可能被截断。
	 */
	readonly authors: readonly ArticleAuthorRef[];

	readonly image?: ArticleImage;
	readonly pdfUrl?: URI;
	readonly relatedArticles: readonly RelatedArticleRef[];
}

export interface RelatedArticleRef {
	readonly relationLabel: string;
	readonly url: URI;
	readonly articleType?: string;
	readonly title: string;
	readonly authors: readonly ArticleAuthorRef[];
	readonly journalTitle?: string;
	readonly publishedAt?: string;
}

export interface ArticleAuthorRef {
	readonly name: string;
	readonly url?: URI;
}

export interface ArticleImage {
	readonly url: URI;
	readonly alt?: string;
}
~~~

description 与 abstract 是不同字段。abstract 缺失时保持 undefined，不得使用 description 作为替代。

ArticleRecord 表示稳定文章身份：

~~~ts
export interface ArticleRecord {
	readonly id: ArticleId;
	readonly journalId: JournalId;
	readonly url: URI;
	readonly doi?: string;
}
~~~

同一 ArticleRecord 可以被多个 ArticleListItem 引用。不同列表中的 description、截断作者、图片和 article type 不互相覆盖。

ArticleRecord 的合并规则：

1. 第一个 ArticleListItem 创建 ArticleRecord。
2. 列表 title 只属于 ArticleListItem，不写入 ArticleRecord。
3. 详情页权威 title 只属于 ArticleDetail。
4. ArticleDetail 可以补充 ArticleRecord.doi 和 DOI 二级索引。
5. ArticleId 和 canonical article URI 不随字段更新而改变。

---

## 8. ArticleDetail

~~~ts
export interface ArticleDetail {
	readonly articleId: ArticleId;
	readonly journalId: JournalId;
	readonly url: URI;

	readonly doi?: string;
	readonly title: string;
	readonly description?: string;
	readonly editorsSummary?: string;
	readonly abstract?: string;
	readonly articleType?: string;
	readonly subjects: readonly string[];
	readonly publishedAt?: string;
	readonly isOpenAccess?: boolean;

	readonly authors: readonly ArticleAuthor[];
	readonly publication: ArticlePublication;

	readonly pdfUrl?: URI;
	readonly citationUrl?: URI;
}

export interface ArticleAuthor extends ArticleAuthorRef {
	/**
	 * undefined 表示页面没有提供可靠证据。
	 */
	readonly isCorresponding?: boolean;
}

export interface ArticlePublication {
	readonly journalId?: JournalId;
	readonly title: string;
	readonly url?: URI;
	readonly volume?: string;
	readonly issue?: string;
	readonly articleNumber?: string;
	readonly pageRange?: string;
	readonly year?: number;
}
~~~

类似 href="#con3" 的作者锚点不能单独证明 corresponding author。只有明确语义标记存在时才写入 true 或 false。

Science 的 Article type 可能直到详情页才被发现。ArticleListItem.articleType 和 ArticleDetail.articleType 均为可选字段。

---

## 9. Browser Page Snapshot 依赖

Browser Page Snapshot 是独立平台能力，详细方案见：

~~~text
.github/instructions/plan_browser_page_snapshot.md
~~~

Fetch 不在 IBrowserViewService 上增加 Snapshot API，也不直接使用 Playwright Page 或 invokeFunctionRaw()。

Fetch 内部只依赖：

~~~ts
export type FetchPageOwnership = 'owned-background' | 'borrowed-interactive';

export interface IFetchPageSession {
	readonly sessionId: string;
	readonly pageId: string;
	readonly ownership: FetchPageOwnership;

	navigateAndCapture(
		uri: URI,
		readiness: IPageSnapshotReadiness | undefined,
		token: CancellationToken
	): Promise<IBrowserPageSnapshot>;

	dispose(): Promise<void>;
}
~~~

IFetchPageSession 负责：

1. 在 electron-browser 中创建并持有一个稳定 sessionId。
2. `owned-background` 通过 IBrowserViewService 创建使用 `BrowserViewStorageScope.Global` 的后台 BrowserView，以复用 Integrated Browser 的 Cookie 和登录状态。不使用 `IPlaywrightService.openPage()` 创建隔离 BrowserContext。
3. `borrowed-interactive` 只引用用户已打开或明确选择的 BrowserView，不取得其销毁所有权。
4. 调用 `IPlaywrightService.startTrackingPage(pageId)` 后才允许 Snapshot。
5. 通过 BrowserView 导航 API 导航到目标 URI。
6. 导航 Promise 失败时直接终止，不读取旧页面。
7. 导航成功后调用 `IPlaywrightService.captureSnapshot(sessionId, pageId, ...)`。
8. 验证 Snapshot URI 满足目标 URI 和 redirect policy。
9. 返回 IBrowserPageSnapshot。

所有权和清理规则：

~~~text
owned-background
├── FetchPageSession 创建 BrowserView
├── FetchPageSession 负责 stopTrackingPage
└── dispose 时销毁 BrowserView

borrowed-interactive
├── FetchPageSession 只保存引用
├── Page 被用户关闭时明确失败
├── 仅在本 Session 负责添加 tracking 时才 stopTrackingPage
└── 永远不销毁用户 BrowserView
~~~

`disposeSession(sessionId)` 只清理本 FetchPageSession 创建的 Playwright session routing，不得关闭借用页面。每个终端路径（成功、失败、取消、页面关闭）都必须经过同一 dispose 逻辑。

IFetchProvider 负责为页面提供 Publisher-specific readiness 和 admission，但不管理 BrowserView、Playwright Page、Cookie 或 Session。

Parser 只接收由 snapshot.html 创建的 detached Document。第一版不自行引入 navigationId 或 pageVersion。

---

## 10. IFetchService

~~~ts
export interface IFetchService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeCatalog: Event<JournalId>;
	readonly onDidChangeSource: Event<ArticleListSourceId>;
	readonly onDidChangeArticle: Event<ArticleId>;

	getJournals(): readonly JournalDescriptor[];
	getJournal(journalId: JournalId): JournalDescriptor | undefined;

	getArticleListCatalog(
		journalId: JournalId
	): ArticleListCatalog | undefined;

	getArticlePage(
		pageId: ArticlePageId
	): ArticlePage | undefined;

	getArticlePages(
		sourceId: ArticleListSourceId
	): readonly ArticlePage[];

	getArticleListItem(
		itemId: ArticleListItemId
	): ArticleListItem | undefined;

	getArticle(
		articleId: ArticleId
	): ArticleRecord | undefined;

	getArticleDetail(
		articleId: ArticleId
	): ArticleDetail | undefined;

	getCatalogLoadState(journalId: JournalId): FetchLoadState;
	getSourceLoadState(sourceId: ArticleListSourceId): FetchLoadState;
	getArticleLoadState(articleId: ArticleId): FetchLoadState;

	discoverArticleListSources(
		journalId: JournalId,
		token: CancellationToken
	): Promise<void>;

	fetchArticleListSource(
		sourceId: ArticleListSourceId,
		token: CancellationToken
	): Promise<void>;

	fetchNextPage(
		sourceId: ArticleListSourceId,
		token: CancellationToken
	): Promise<void>;

	fetchArticle(
		articleId: ArticleId,
		token: CancellationToken
	): Promise<ArticleDetail>;

	refreshJournal(
		journalId: JournalId,
		token: CancellationToken
	): Promise<void>;

	refreshArticleListSource(
		sourceId: ArticleListSourceId,
		token: CancellationToken
	): Promise<void>;
}
~~~

`getArticlePages(sourceId)` 是 Source 到有序 Page Snapshot 的唯一查询入口；调用方不得从 PageId、URL 或本地数组重建分页顺序。三个 LoadState 查询与对应变化事件配套使用。

变化事件同时覆盖数据 Snapshot 和 LoadState：

1. 操作进入 loading 后触发一次对应 ID 事件。
2. 成功时先原子提交数据与 ready LoadState，再触发一次事件；监听器在事件回调中必须能读到最终一致的 Snapshot。
3. 失败时先提交 error LoadState，再触发事件；取消时先提交 idle LoadState，再触发事件。
4. 事件触发后不再静默修改同一操作的 LoadState。
5. Catalog、Source、Article 事件只携带稳定 ID，不携带对象或错误副本。

FetchService 负责：

~~~text
JournalDescriptor 读取
Provider 实例解析
Catalog 状态
Source/Page/Group/ListItem 状态
ArticleRecord 与 ArticleDetail
任务调度和取消
并发控制
分页追加
文章身份和去重
详情缓存
加载状态
错误隔离
过期结果拒绝
变化事件
~~~

调用方不得自行：

~~~text
根据 URL 猜 Provider
解释 Explore content 或 Section
拼接分页 URL
选择 Publisher Parser
合并 Parser 结果
维护 ArticleDetail 缓存
~~~

---

## 11. Refresh 与并发语义

refreshJournal：

1. 重新发现该 Journal 的 Catalog。
2. 原子替换 Catalog。
3. SourceId 未变化时保留其已加载页面。
4. 删除已消失 Source 的 Page、Group、ListItem 和 LoadState。
5. 保留仍被其他页面引用的 ArticleRecord。
6. 保留 ArticleDetail 缓存。
7. 不影响其他 Journal。

refreshArticleListSource：

1. 重新抓取第一页。
2. 替换第一页当前内容。
3. 清除该 Source 后续已加载分页。
4. 不影响其他 Source。

并发规则：

1. 同一个 Catalog、Source 或 Article 同时只保留一个底层活动任务。
2. 同目标的普通请求加入现有任务；每个调用者的 CancellationToken 只取消自己的等待，所有等待者都取消后才取消底层任务。
3. 新 refresh 创建新 generation，取消同目标的旧底层任务；旧任务的所有等待者收到 CancellationError。
4. 取消后的结果不得写入状态。
5. 任务 generation 不匹配或 Snapshot URI admission 失败的结果必须丢弃并报告过期。
6. 一个 Source 失败不能污染同 Journal 的其他 Source。
7. `fetchArticle()` 在 ready Detail 已缓存时直接返回当前 ArticleDetail，不重新导航；第一版不提供静默刷新详情。未来需要刷新时新增显式 `refreshArticle()`，不得改变 `fetchArticle()` 的缓存语义。

---

## 12. 运行时状态

内部状态使用 Map，公共 API 通过查询方法返回只读 Snapshot。

~~~ts
export interface FetchLoadState {
	readonly status: 'idle' | 'loading' | 'ready' | 'error';
	readonly error?: string;
	readonly updatedAt?: string;
}
~~~

状态至少按以下键隔离：

~~~text
JournalId                 Catalog discovery
ArticleListSourceId       Page loading
ArticleId                 Detail loading
~~~

updatedAt 使用 ISO 8601 UTC 字符串。错误对象在内部保留，公共 LoadState 只暴露安全消息。

---

## 13. IFetchProvider

~~~ts
export interface IFetchProvider {
	readonly id: FetchProviderId;

	canonicalizeSourceUri(uri: URI): URI;
	canonicalizePageUri(uri: URI): URI;
	canonicalizeArticleUri(uri: URI): URI;

	discoverArticleListSources(
		journal: JournalDescriptor,
		token: CancellationToken
	): Promise<ParsedArticleListCatalog>;

	fetchArticleListPage(
		journal: JournalDescriptor,
		source: ArticleListSource,
		url: URI,
		token: CancellationToken
	): Promise<ParsedArticleListPage>;

	fetchArticleDetail(
		journal: JournalDescriptor,
		article: ArticleRecord,
		token: CancellationToken
	): Promise<ParsedArticleDetail>;
}
~~~

Parsed 类型只包含解析值和规范化 URI，不包含应用状态写入。

~~~ts
export interface ParsedArticleListCatalog {
	readonly entries: readonly ParsedArticleListCatalogEntry[];
}

export type ParsedArticleListCatalogEntry =
	| ParsedArticleListSourceGroup
	| ParsedArticleListSource;

export interface ParsedArticleListSourceGroup {
	readonly kind: 'group';
	readonly label: string;
	readonly sources: readonly ParsedArticleListSource[];
}

export interface ParsedArticleListSource {
	readonly kind: 'source';
	readonly label: string;
	readonly url: URI;
}

export interface ParsedArticleListPage {
	readonly url: URI;
	readonly issue?: IssueMetadata;
	readonly groups: readonly ParsedArticleGroup[];
	readonly ungroupedItems: readonly ParsedArticleListItem[];
	readonly nextPageUrl?: URI;
}

export interface ParsedArticleGroup {
	readonly label: string;
	readonly items: readonly ParsedArticleListItem[];
}

export interface ParsedArticleListItem
	extends Omit<ArticleListItem, 'id' | 'articleId'> {
	readonly providerOccurrenceKey: string;
	readonly articleUrl: URI;
	readonly doi?: string;
}

export type ParsedArticleDetail =
	Omit<ArticleDetail, 'articleId' | 'journalId'>;
~~~

边界：

~~~text
FetchService
    状态、身份、工作流、并发和缓存

FetchProvider
    Publisher 流程、readiness、admission、Parser Resolver 和 URI 规范化

FetchPageSession
    页面导航和 IPlaywrightService Snapshot 调用

Parser
    detached Document 到 Parsed Result 的纯解析
~~~

---

## 14. Registry 与 DI

Registry 只保存静态 JournalDescriptor 和 Provider 构造描述符，不直接保存模块加载阶段创建的 Provider 实例。

~~~ts
export interface FetchProviderDescriptor {
	readonly id: FetchProviderId;
	readonly ctor: IConstructorSignature<IFetchProvider>;
}

export interface IFetchRegistry {
	registerJournal(
		descriptor: JournalDescriptor
	): IDisposable;

	registerProvider(
		descriptor: FetchProviderDescriptor
	): IDisposable;

	getJournal(
		journalId: JournalId
	): JournalDescriptor | undefined;

	getJournals(): readonly JournalDescriptor[];

	getProviderDescriptor(
		providerId: FetchProviderId
	): FetchProviderDescriptor | undefined;
}
~~~

FetchService 通过 DI 创建 Provider。

重复 JournalId 或 FetchProviderId 必须直接报错。注册返回 IDisposable，测试和生命周期可以撤销注册。

---

## 15. Parser Resolver

Provider 持有 Parser Descriptor：

~~~ts
export interface ParserDescriptor<TParser> {
	readonly id: string;
	readonly matches: (context: ParseContext) => boolean;
	readonly parser: TParser;
}
~~~

Resolver 规则：

~~~text
0 matches
    → 明确报错

1 match
    → 执行 Parser

multiple matches
    → 明确歧义错误
~~~

禁止：

~~~text
专用 Parser 优先、普通 Parser 随后
默认 Parser
catch 后尝试另一个 Parser
unknown 页面走 generic Parser
~~~

Parser 匹配依据可以包含 DOM 标记、HTML 结构和必要 URL 特征。URL 只能作为辅助证据。

---

## 16. Nature Provider

### 16.1 Catalog discovery

Nature Catalog Parser 从 discoveryUrl 解析：

~~~text
Explore content
└── Article type
~~~

映射为：

~~~text
Explore content
    → ArticleListSourceGroup

Article type
    → ArticleListSource
~~~

示例：

~~~text
Research articles
├── Article
├── Matters Arising
└── Registered Report
~~~

其中 Research articles 是 Group，三个 Article type 是实际 Source。

### 16.2 List parsing

Nature 第一版保留：

~~~text
NatureArticleListParser
NatureNewsOpinionListParser
~~~

两者输出 ParsedArticleListPage，不输出 ArticleDetail。

News / Opinion 是 Nature 主刊特殊列表结构，不是公共分类轴，也不建立 Standard / NewsOpinion 通用枚举。

### 16.3 Detail parsing

先实现：

~~~text
NatureArticleDetailParser
~~~

只有 Fixture 证明 News / Opinion 详情主结构无法由同一 Parser 清楚覆盖时，才增加：

~~~text
NatureNewsOpinionArticleDetailParser
~~~

不得为了与 List Parser 形式对称而创建第二个 Detail Parser。

---

## 17. Science Provider

### 17.1 Catalog discovery

Science Provider 从 discoveryUrl 发现：

~~~text
ArticleListSource: Current Issue
ArticleListSource: First Release
~~~

不创建 Source Group。

### 17.2 Current Issue parsing

Current Issue Parser 输出：

~~~text
IssueMetadata
ArticleGroup[]
ArticleListItem[]
~~~

Science：

~~~text
ArticleGroup: Commentary
ArticleGroup: Research
...
~~~

Science Advances：

~~~text
ArticleGroup: Focus
ArticleGroup: Neuroscience
ArticleGroup: Social and Interdisciplinary Sciences and Public Health
...
~~~

Section label 动态解析，禁止写入 JournalDescriptor。

Science 列表卡片中的 article type 是可选字段，例如 Expert Voices、Perspectives。Science Advances 通常不在列表卡片直接显示 article type。

列表 Parser 还需区分：

~~~text
description
abstract
PDF URL
access status
related article
~~~

Related article 是包含它的 ArticleListItem 的嵌套关系，不是当前 ArticleGroup 的普通 ArticleListItem。

### 17.3 Detail parsing

Science 与 Science Advances 共享基础字段，但只有 Fixture 证明 DOM 主结构和匹配条件一致时才共用 Parser。

详情字段包括：

~~~text
article type
subject / discipline
title
complete authors
publication
DOI
Editor's Summary
abstract
PDF
citation
access status
~~~

作者 href="#con3" 不证明 corresponding author。

---

## 18. Menu 与 homeUrl

homeUrl 只用于官网快速访问、菜单和标题链接。

使用 Action2 注册通用命令：

~~~text
fetch.openJournalHome
~~~

命令根据 journalId 查询 JournalDescriptor，并通过 IOpenerService 打开 homeUrl。

discoveryUrl 只用于 Provider 发现 ArticleListSource，不用于菜单。

MenuId 不进入 JournalDescriptor。

---

## 19. 下游消费模型

FetchService 是文章抓取状态的唯一真相。工作台、聊天、导出、下载和知识库不得保存第二份完整文章聚合，也不得把 `ArticleDetail` 转换为旧 `FetchArticle` 后继续流转。

Sessions 不保存文章领域状态或文章 View 状态。当前 `activeJournalId` 和 `activeSourceId` 只属于 ChatInputPart context view；关闭该 View 即释放。未来若新增独立 Article Detail View，其 `activeArticleId` 由该 View 自己持有。Tree 的 row selection、focus、展开 Group 和滚动位置同样属于对应 View。Catalog 中可见的 Source、Page、Group、ListItem 和 Detail 均在渲染时查询，不写入 Session。

文章 checkbox 的勾选状态只有一个 Owner：由 `chatResource` 寻址的 Chat 模型。当前 checkbox 位于 ChatListRenderer / ChatListWidget 渲染的聊天文章列表中，不属于 Tree selection 或 focus。Sessions 不保存 `checkedArticleIds`；下载和导出命令接收对应 Chat 模型在命令触发时生成的只读 ID Snapshot，也不取得勾选状态所有权。

ChatService 复用现有 store-style 订阅契约，不新增平行的 checkbox Event：

~~~ts
export interface ChatServiceSnapshot {
	readonly checkedArticleIds: readonly ArticleId[];
	// existing chat state...
}

subscribe(chatResource: URI, listener: () => void): DisposableHandle;
getSnapshot(chatResource: URI): ChatServiceSnapshot;
isArticleChecked(chatResource: URI, articleId: ArticleId): boolean;
setArticleChecked(chatResource: URI, articleId: ArticleId, checked: boolean): void;
~~~

ChatListWidget 直接注入 IChatService，并使用 Sessions 传入的明确 `chatResource` 注册 `subscribe(chatResource, ...)`。渲染 checkbox 时按 `chatResource + ArticleId` 查询 ChatService，`Checkbox.onChange` 把组件的 checked 值传给 `setArticleChecked(chatResource, ...)`；ChatService 更新该 Chat Snapshot 并通知其订阅者后，ChatListWidget 重新渲染当前消息。`isArticleSelected(href)`、`toggleArticleSelected(href)` 以及由 Shell / SessionChatView 透传的 checkbox Props 直接迁移并删除，不保留 URL 兼容入口或专用 checkbox 事件。

每个 Chat 的 `checkedArticleIds` 都是无重复、按勾选先后排序的只读数组。`setArticleChecked(chatResource, id, true)` 只在该 Chat 缺失时追加，`setArticleChecked(chatResource, id, false)` 从该 Chat 移除该 ID；状态未变化时不发布订阅通知。该顺序可作为一次命令的输入顺序，但不得写入 ArticleRecord、ArticleDetail 或 ArticleListItem。

聊天中的文章结果不能只保存 Markdown href 后再由 DOM 反解析身份。内部生成的文章结果消息增加结构化 `articleList: { articleIds: readonly ArticleId[] }`，顺序与消息展示项一一对应；展示文本属于聊天记录，ArticleId 是操作身份，ArticleRecord / ArticleDetail 的当前数据仍通过 IFetchService 查询。Renderer 必须验证展示项与 ArticleId 数量一致，不一致时明确报错，不回退到 href。`insertArticles(FetchArticle[])` 直接迁移为接收 ArticleId Snapshot 的操作，旧的 `includeInAgentHistory === false` + `li a[data-href]` 身份推导路径删除。

ChatInputPart 是当前文章来源菜单的 View owner，直接注入 IFetchService，读取 Journal / Catalog / LoadState、发起带 View CancellationToken 的 discovery/source 请求并订阅相关 Fetch 事件。ChatListWidget 直接注入 IFetchService 与 IChatService，订阅当前消息所引用 ArticleId 的 Article 变化和 Chat Snapshot 变化。`articleQuickSources`、`isArticleSourceFetching`、`onFetchArticleSource` 以及 checkbox 相关 Props 不再经过 WorkbenchHost、SessionChatView、ChatWidget 层层透传。

Chat 文章来源交互固定为非 Batch 流程：

1. ChatInputPart 打开文章来源菜单时读取 `getJournals()`。
2. 用户选择 Journal 后只调用 `discoverArticleListSources(journalId, token)`，并按 Catalog 的 Source Group / Source 层级渲染入口。
3. 用户选择具体 Source 后只调用 `fetchArticleListSource(sourceId, token)`，不遍历同 Journal 的其他 Source。
4. 抓取成功事件到达后通过 `getArticlePages(sourceId)` 渲染当前 Page/ListItem；需要把结果写入聊天记录时，消息保存由这些 ListItem 确定的有序 ArticleId 引用。
5. 下一页只能由该 Source 的显式“加载更多”交互调用 `fetchNextPage(sourceId, token)`，不循环抓完所有分页。
6. 列表阶段不循环调用 `fetchArticle()`；详情只在打开文章、构建 Chat/Agent 上下文、下载或导出确实需要时按 ArticleId 获取。
7. 切换 Journal/Source、关闭 context view 或 dispose ChatInputPart 时取消前一个目标请求。

因此删除 `fetchJournalArticles()` 时不得把它改名、移动或拆成另一个循环；一次用户动作不会隐式抓取整个 Journal、所有 Source、全部分页或全部 Detail。

如果未来某个独立 Article View 使用 Workbench Tree，Tree selection/focus 仍是该 View 的局部状态，不得作为 `checkedArticleIds` 的数据源；这不是当前 Chat checkbox 的实现路径。

工作台不得保存：

~~~text
FetchArticle[]
ArticleDetail[] 副本
以 URL + fetchedAt 组成的勾选键
从地址栏 URL 推导的 fetch seed
静态 BatchSource URL 表
~~~

各消费面直接读取以下模型：

~~~text
文章列表                 ArticlePage + ArticleGroup + ArticleListItem
文章身份、勾选与去重     ArticleId + ArticleRecord
详情视图与聊天上下文     ArticleDetail
PDF 下载                 ArticleDetail.pdfUrl
DOCX 摘要导出            ArticleDetail 的 title/authors/abstract/publication
知识库元数据写入         ArticleRecord + ArticleDetail
~~~

聊天只保存消息中的 ArticleId 引用和 `checkedArticleIds`，不保存文章对象。构建消息或 Agent 上下文时，通过 `IFetchService.getArticle()` 和 `getArticleDetail()` 读取当前 Snapshot。若详情尚未加载，发起 `fetchArticle(articleId, token)`；取消或失败时不得构造部分兼容对象。

PDF 与 DOCX 操作接收 `ArticleId[]`，在操作开始时解析所需的 ArticleRecord 和 ArticleDetail。下载顺序属于一次命令的局部输入，不写入 Article 模型，也不使用 `fetchOrder` 作为文章状态。

ArticleId 只在拥有 IFetchService 的 electron-browser 边界解析。跨 IPC 的 electron-main 代码不得接收 ArticleId 后反向调用 Fetch，也不得接收 FetchArticle：

1. PDF 下载 controller 在 electron-browser 查询 ArticleDetail.pdfUrl，向下载边界传 URI 和命令局部顺序。
2. DOCX 摘要导出 controller 在 electron-browser 查询 Detail，构造只含 title、authors、abstract、publication 的 `ArticleSummaryExportInput`。
3. Chat / Agent / RAG 在 ask() 开始时由 ChatService 查询 checked ArticleId Snapshot，构造明确的 `ArticleContextInput`；第一版只包含实际存在的 Detail 字段，不伪造正文 sections。
4. 知识库命令构造自己的 `LibraryArticleMetadataInput`，不让 Fetch 模型成为知识库存储模型。
5. 这些 DTO 属于各自命令或 IPC 契约，不放回 Fetch 公共模型，也不形成 ArticleDetail 的通用替代聚合。

旧 `FetchArticle` 相关持久化不迁移：第一版 Fetch 状态不跨启动恢复，因此删除 workbench session articles、saveFetchedArticles 和 historyStore 的 FetchArticle 读写。依赖 sections/figures/references 的正文翻译、旧 RAG 正文提取等能力按第一版范围删除；若产品仍需要，必须另立 Article Full Text 方案，不能把空字段带入新 DTO。

知识库不是 Fetch 状态存储。用户执行入库操作时，可以从 ArticleRecord 与 ArticleDetail 生成知识库文档元数据，但该投影只存在于知识库命令边界，不得作为 Fetch Facade、Adapter 或缓存回流到 FetchService。

第一版 `ArticleDetail` 不提供全文 `sections`、`figures` 或 `references`。依赖这些字段的旧功能必须删除或单独设计 Article Full Text 方案；禁止用空数组、description 或其他字段伪造缺失内容。

View 通过构造函数注入 `IFetchService`，并立即注册以下订阅：

~~~ts
this._register(fetchService.onDidChangeCatalog(journalId => this.onCatalogChanged(journalId)));
this._register(fetchService.onDidChangeSource(sourceId => this.onSourceChanged(sourceId)));
this._register(fetchService.onDidChangeArticle(articleId => this.onArticleChanged(articleId)));
~~~

事件只通知稳定 ID。View 判断该 ID 是否属于当前显示范围；相关时请求重新渲染或刷新组件输入，并通过 `getArticleListCatalog()`、`getArticlePages()`、`getArticleListItem()`、`getArticle()`、`getArticleDetail()` 和 LoadState 查询重新读取 Snapshot。事件 payload 不传递完整对象，View 不维护与 FetchService 同步的 Map 或数组。

订阅所有权按实际展示边界划分：

~~~text
ChatInputPart
    订阅 onDidChangeCatalog
    订阅当前 Source 的 onDidChangeSource

ChatListWidget
    订阅当前消息引用 ArticleId 的 onDidChangeArticle
    直接订阅 IChatService.subscribe(chatResource, ...)

独立 Article List View
    订阅当前 Journal 的 onDidChangeCatalog
    订阅当前 Source 的 onDidChangeSource

Article Detail View
    只响应当前 ArticleId 的 onDidChangeArticle

ChatService
    不订阅 Fetch 事件维护文章副本
    按 chatResource 保存消息中的 ArticleId 引用和 checkedArticleIds
    ask(chatResource) 时通过 IFetchService 查询 ArticleRecord / ArticleDetail
~~~

`WorkbenchHost` 不集中订阅 Fetch 事件，也不把 Catalog、ArticleListItem、ArticleDetail 或文章数组作为 Props 层层传给 Chat。负责展示 Fetch 数据的具体 View 直接注入 IFetchService、注册订阅并查询 Snapshot；父容器只传递无法由 Service 推导的布局或交互状态。

View 发起的抓取操作必须拥有明确的取消生命周期：

1. View 创建并立即注册 MutableDisposable 或 DisposableStore 来持有当前 CancellationTokenSource。
2. 切换 Journal、Source 或 Article 时，先取消同一 View 的旧目标操作，再开始新操作。
3. View dispose 时取消尚未完成的 discovery、source 或 detail 请求。
4. 取消后的完成结果由 FetchService generation 规则拒绝，View 不接收 Promise 返回值写入本地文章状态。
5. View 只通过 Service 变化事件刷新；Promise 完成不作为第二条状态提交路径。

Catalog 或文章身份变化后，交互状态按当前 Snapshot 确定性清理：

1. ChatInputPart 的 `activeJournalId` 无法通过 getJournal() 解析时，清除该 View 的 active Journal 和 Source。
2. ChatInputPart 的 `activeSourceId` 不再属于 active Journal 的 Catalog 时，只清除该 View 的 active Source。
3. 独立 Article Detail View 的 `activeArticleId` 只有在无法通过 getArticle() 解析时才清除，不因某个 Source 消失而清除仍有效的文章身份。
4. ChatService 不订阅 Fetch 事件主动同步勾选状态；指定 Chat 的 ask、下载或导出开始前解析其 checkedArticleIds，原子移除无法解析的 ID、发布一次该 Chat Snapshot 变化并向用户报告缺失项。
5. Source 暂时没有 Page 或 Detail 尚未加载不等于身份消失，不得因此清除稳定 ID。

---

## 20. 文件结构

~~~text
src/cs/workbench/services/fetch/
├── common/
│   ├── fetch.ts
│   ├── fetchErrors.ts
│   ├── fetchIds.ts
│   ├── fetchProvider.ts
│   └── fetchRegistry.ts
│
├── electron-browser/
│   ├── fetchService.ts
│   ├── fetchPageSession.ts
│   ├── fetchParserResolver.ts
│   │
│   └── providers/
│       ├── nature/
│       │   ├── natureJournals.ts
│       │   ├── natureFetchProvider.ts
│       │   ├── natureCatalogParser.ts
│       │   ├── natureArticleListParser.ts
│       │   ├── natureNewsOpinionListParser.ts
│       │   ├── natureArticleDetailParser.ts
│       │   └── nature.contribution.ts
│       │
│       └── science/
│           ├── scienceJournals.ts
│           ├── scienceFetchProvider.ts
│           ├── scienceCatalogParser.ts
│           ├── scienceCurrentIssueParser.ts
│           ├── scienceFirstReleaseParser.ts
│           ├── scienceArticleDetailParser.ts
│           └── science.contribution.ts
│
└── test/
    ├── common/
    │   ├── fetchIds.test.ts
    │   └── fetchRegistry.test.ts
    │
    └── electron-browser/
        ├── fetchPageSession.test.ts
        ├── fetchParserResolver.test.ts
        ├── fetchService.test.ts
        └── providers/
            ├── nature/
            │   ├── fixtures/
            │   └── *.test.ts
            └── science/
                ├── fixtures/
                └── *.test.ts

src/cs/workbench/contrib/fetch/
└── electron-browser/
    ├── fetchActions.ts
    ├── fetchMenus.ts
    └── fetch.contribution.ts

直接迁移的 Chat 消费面：

src/cs/workbench/contrib/chat/common/chatService/
├── chatService.ts
└── chatServiceImpl.ts

src/cs/workbench/contrib/chat/browser/widget/
├── chatListRenderer.ts
├── chatListWidget.ts
└── input/chatInputPart.ts

src/cs/workbench/contrib/chat/browser/
├── chat.ts                                 删除 Fetch/checkbox Props
└── widget/chatWidget.ts                    删除 Fetch/checkbox Props 转发

src/cs/sessions/browser/parts/sessions/chatView.ts
    删除 Fetch 数据和 checkbox 回调 Props 透传

src/cs/workbench/browser/workbench.ts
    删除 fetchJournalArticles、ArticleDetail → FetchArticle 转换和 Chat Fetch 编排

需要直接迁移或删除旧 FetchArticle 契约的消费面：

src/cs/base/parts/sandbox/common/
├── fetchArticle.ts                         删除
├── fetchArticleKind.ts                     删除
├── fetchArticleProof.ts                    删除
├── fetchPublication.ts                     删除
└── sandboxTypes.ts                         改为目标明确的 Chat / Agent 输入

src/cs/workbench/browser/
├── session.ts                              删除 articles 和 URL + fetchedAt 勾选状态
├── documentActionsModel.ts                 命令入口改收 ArticleId[]
└── workbenchContentState.ts                删除 FetchArticle 派生状态

src/cs/workbench/contrib/translation/browser/articleSummaryTranslationExport.ts
    使用 ArticleSummaryExportInput

src/cs/workbench/services/knowledgeBase/libraryMetadataService.ts
    使用 LibraryArticleMetadataInput

src/cs/workbench/services/storage/{browser,electron-browser}/storageService.ts
src/cs/platform/storage/electron-main/historyStore.ts
    删除 FetchArticle 持久化 API

src/cs/code/electron-main/{agent,rag,document,translation}/
    删除 FetchArticle IPC 输入和伪造全文依赖，改用所属功能的显式 DTO 或删除超出第一版范围的路径

上述生产文件对应的 browser、translation、document 和 model subscription 测试必须在同一步直接迁移；不得用旧类型 test fixture 保留兼容接口。
~~~

Browser Page Snapshot 契约和实现位于 IPlaywrightService，不放入 Publisher Provider：

~~~text
src/cs/platform/browserView/common/playwrightService.ts
上游参考：src/vs/platform/browserView/node/playwrightService.ts
上游参考：src/vs/platform/browserView/node/playwrightTab.ts
~~~

Fetch 侧在 `workbench/services/fetch/electron-browser` 实现 IFetchPageSession，直接使用 IBrowserViewService 和 IPlaywrightService，不创建 Fetch 私有 BrowserView Service、Playwright Facade 或主进程兼容层。

---

## 21. 实施步骤

### Step 0：读取约束与上游

修改前读取：

1. .github/instructions 下全部适用规则。
2. 当前 Fetch、IPlaywrightService、BrowserView 和调用面。
3. /Users/lance/Desktop/vscode 中的 Registry、Service、Playwright Snapshot、Contribution、CancellationToken 和进程实现。

### Step 1：完成 Browser Page Snapshot 前置方案

按 plan_browser_page_snapshot.md 完成 IPlaywrightService.captureSnapshot()。Fetch Plan 不重复实现该平台能力。

### Step 2：迁移 Fetch 运行进程

将现有 `workbench/services/fetch/electron-main` 的抓取编排、PageSession、Provider 和 Parser 直接迁移到 `workbench/services/fetch/electron-browser`。同时迁移所有调用点和 IPC 入口，删除旧 electron-main Fetch 运行时，不保留转发 Facade。

完成 IFetchPageSession 的 owned-background / borrowed-interactive、Global storage scope、tracking 和 dispose 契约后，才进入领域模型实现。

### Step 3：建立新公共模型

新增：

~~~text
ArticleListCatalog
ArticleListSourceGroup
ArticleListSource
ArticlePage
IssueMetadata
ArticleGroup
ArticleListItem
ArticleRecord
ArticleDetail
~~~

不创建 ExploreContentItem 或 ArticleTypeItem 公共类型。

### Step 4：实现 ID Factory

集中实现所有稳定 ID。ArticleId 不因详情页发现 DOI 而改变。

### Step 5：实现 Registry 与 Provider DI

Registry 注册 JournalDescriptor 和 Provider 构造描述符，重复 ID 报错，注册返回 IDisposable。

### Step 6：实现 FetchService

完成 Catalog、Source、Page、Group、ListItem、Record、Detail 和 LoadState，以及分页查询、详情缓存、共享任务 waiter 取消、refresh 和提交状态后再通知的事件语义。

### Step 7：实现 Nature Provider

先完成 Catalog discovery，再完成普通列表、News/Opinion 列表和详情 Parser。

### Step 8：实现 Science Provider

完成 Current Issue、First Release、动态 Section、可选 article type、Related Article 和详情 Parser。

### Step 9：迁移调用方

调用方改为：

~~~ts
fetchService.discoverArticleListSources(journalId, token);
fetchService.fetchArticleListSource(sourceId, token);
fetchService.fetchNextPage(sourceId, token);
fetchService.fetchArticle(articleId, token);
~~~

同时迁移所有下游消费面：

1. Sessions 会话删除 articles、checked/selected keys 和 active Journal/Source/Article；当前导航 ID 归具体 View 局部持有，checkedArticleIds 唯一归由 chatResource 寻址的 Chat 模型。
2. 当前 Chat 消费面由 ChatInputPart 和 ChatListWidget 直接注入 IFetchService；未来新增独立列表或详情 View 时也各自直接注入。
3. 各 View 只订阅其当前 Journal、Source 或 ArticleId 的相关变化，并在变化后重新查询 Snapshot。
4. 删除 WorkbenchHost 集中订阅和文章 Props 透传。
5. 列表 UI 通过 Page、Group 和 ListItem 查询渲染，不保存 visibleSourceIds 或文章对象数组。
6. 每个由 chatResource 寻址的 ChatService Snapshot 只保存该 Chat 消息中的 ArticleId 引用和 checkedArticleIds；ChatListWidget 复用 `IChatService.subscribe(chatResource, ...)`，不新增 checkbox 专用事件。
7. ChatInputPart 与 ChatListWidget 直接注入 IFetchService；删除 WorkbenchHost、SessionChatView 和 ChatWidget 的 Fetch/checkbox Props 透传。
8. 删除 Markdown href/DOM 反解析文章身份、`isArticleSelected(href)` 和 `toggleArticleSelected(href)`，checkbox 直接读写 ArticleId。
9. PDF 下载和 DOCX 摘要导出接收 `ArticleId[]` 并按需读取详情。
10. electron-browser 在 IPC 前把 ArticleId 解析为 PDF、DOCX、Agent/RAG 或知识库各自的最小输入 DTO；electron-main 不接收 ArticleId 或 FetchArticle。
11. 删除旧 FetchArticle 的 workbench session、storage/history、sandbox 和 IPC 契约；删除依赖伪造全文字段的超范围功能。
12. 知识库入库从 ArticleRecord 与 ArticleDetail 生成一次性元数据。
13. 删除地址栏 fetch seed、BatchSource、BatchFetch 状态机和静态来源 URL 设置。
14. 为各 View 增加目标切换和 dispose 取消，并在 Catalog/Article 变化后清理无法解析的 active ID。

调用方不得引入 FetchArticle 替代聚合、ArticleDetail 副本、URL 身份或本地详情缓存。

### Step 10：增加菜单

通过 Action2、MenuRegistry 和 IOpenerService 打开 JournalDescriptor.homeUrl。

### Step 11：删除旧结构

删除：

~~~text
ExploreContentItem 公共类型
ArticleTypeItem 公共类型
JournalArticles 旧聚合
ArticleBrowse*
ArticleDetailService
FetchArticle 旧应用聚合
FetchArticleKind、FetchArticleProof、FetchArticlePublication 旧辅助类型
工作台 articles: FetchArticle[] 状态
URL + fetchedAt 勾选键
fetchOrder 文章状态
saveFetchedArticles 与 FetchArticle historyStore
isArticleSelected(href) 与 toggleArticleSelected(href)
Fetch/checkbox Workbench Props 透传
Markdown href/DOM 反解析文章身份
BatchSource 与默认来源 URL 表
BatchFetch Controller 与状态机
地址栏 fetch seed
按 DOI 升级 ArticleId
公共模型中的 href
静态 Nature Explore content
静态 Science Section
Parser 默认分支
兼容别名
Facade
Adapter
Re-export
~~~

迁移所有调用点，不保留旧接口包装。

---

## 22. 测试计划

### 22.1 Browser Page Snapshot 集成

验证：

1. IFetchPageSession 使用 IPlaywrightService.captureSnapshot()。
2. 导航失败后不调用 captureSnapshot()。
3. Snapshot URI admission 失败时不进入 Parser。
4. readiness 由 Provider 提供并传递给 Snapshot API。
5. CancellationToken 可终止 PageSession。
6. Parser 只接收 detached Document。
7. Snapshot 平台层完整测试由 plan_browser_page_snapshot.md 验收。
8. owned-background 使用 Global storage scope，完成后 stop tracking 并销毁自有 BrowserView。
9. borrowed-interactive 被用户关闭时明确失败，dispose 不销毁用户 BrowserView。
10. 成功、失败和取消路径均清理本 Session 拥有的 tracking 和 Playwright session routing。

### 22.2 ID

验证：

1. 相同输入生成相同 ID。
2. Source Group 不分配长期 ID，label 变化只替换 Catalog Snapshot。
3. 相同 Source 的不同分页 URL 不冲突。
4. ArticleId 基于 journalId 和 canonical URI。
5. 详情发现 DOI 不改变 ArticleId。
6. 同一 Page 中同一 Article 的不同 occurrence 生成不同 ListItemId。
7. 相同 providerOccurrenceKey 稳定生成相同 ListItemId。
8. 等价 canonical URI 生成相同 ID，非等价 URL 不被合并。
9. Source Group 成员增减不改变其中 canonical Source URI 未变的 SourceId。

### 22.3 Registry

验证：

1. 注册和读取 Journal。
2. 注册和读取 Provider Descriptor。
3. 重复 ID 报错。
4. dispose 后撤销注册。
5. 注册顺序不改变最终结果。

### 22.4 Nature

验证：

1. Explore content 解析为 Source Group。
2. Article type 解析为 Source。
3. 不存在 Article type 的非文章入口不创建空 Source。
4. 普通列表和 News/Opinion 列表匹配范围明确。
5. 0 个 Parser 匹配时报错。
6. 多个 Parser 匹配时报错。
7. 列表 Parser 不输出 ArticleDetail。
8. Detail Parser 不处理列表页面。

### 22.5 Science

验证：

1. Current Issue 和 First Release 是直接 Source。
2. Current Issue 解析 IssueMetadata。
3. Science Section 动态解析为 ArticleGroup。
4. Science Advances 学科 Section 动态解析为 ArticleGroup。
5. Section 不写入 articleType。
6. 列表 articleType 缺失时保持 undefined。
7. description 与 abstract 分开。
8. Abstract 控件没有内容时不创建 abstract。
9. PDF 和 access status 为可选。
10. Related Article 保存在所属 ListItem 内。
11. href="#con3" 不产生 corresponding author。
12. 两个 Journal 共用 Detail Parser 前必须通过双 Fixture。

### 22.6 FetchService

验证：

1. Nature 与 Science Catalog 可同时加载。
2. Source Group 和 Result Group 不混用。
3. 一个 Source 失败不影响其他 Source。
4. 同 URL 第一页重新抓取时替换内容。
5. fetchNextPage 只追加目标 Source。
6. 同一 ArticleRecord 可被多个 ListItem 引用。
7. 不同 ListItem 的卡片字段不互相覆盖。
8. ArticleDetail 独立缓存。
9. refreshJournal 只影响目标 Journal。
10. refreshArticleListSource 清除目标 Source 后续页。
11. 取消和过期结果不能写入状态。
12. 事件只携带受影响的 JournalId、SourceId 或 ArticleId。
13. loading、ready、error 和取消后的 idle 均在对应事件前提交，事件监听器读取到一致 Snapshot。
14. `getArticlePages(sourceId)` 保持分页提交顺序，页面替换后不遗留旧 PageId。
15. ready ArticleDetail 被 fetchArticle 直接复用，不再次调用 Provider。
16. 同目标普通请求共享底层任务，但单个等待者取消不取消其他等待者；全部取消后底层任务取消。

### 22.7 下游消费

验证：

1. 工作台会话不保存文章对象、文章 ID 或文章 View 状态；active Journal/Source/Article 归具体 View 局部持有。
2. ChatInputPart 和 ChatListWidget 直接注入 IFetchService；未来新增独立列表或详情 View 时各自直接注入。
3. 各 View 只响应当前 Journal、Source 或 ArticleId 的相关事件。
4. 相关事件发生后，View 重新查询 Snapshot，不维护同步副本。
5. WorkbenchHost 不集中订阅 Fetch，也不向 Chat 透传文章对象数组。
6. ChatService 不订阅 Fetch 事件维护文章副本，只按 chatResource 保存消息中的 ArticleId 引用和 checkedArticleIds。
7. ChatListWidget 直接订阅 `IChatService.subscribe(chatResource, ...)`，不增加 checkbox 专用事件。
8. Checkbox 通过 chatResource + ArticleId 读写 ChatService；不存在 href 身份、DOM 反解析或 Tree selection 映射。
9. checkedArticleIds 无重复并保持勾选顺序；重复设置相同状态不发布通知。
10. ChatInputPart 与 ChatListWidget 直接注入 IFetchService，Fetch/checkbox Props 不经过 WorkbenchHost、SessionChatView 或 ChatWidget 透传。
11. 列表渲染直接读取 ArticlePage、ArticleGroup 和 ArticleListItem。
12. 同一 ArticleId 在多个列表出现时，勾选状态只保留一份文章身份。
13. 聊天勾选和上下文构建使用 ArticleId，不使用 URL 或 fetchedAt 身份。
14. 未加载详情时，聊天和导出通过 fetchArticle 获取详情；已缓存 ready Detail 时不重复导航。
15. PDF 下载只使用 ArticleDetail.pdfUrl，不从文章页 URL 猜 PDF URL。
16. DOCX 摘要导出只消费 ArticleDetail 已定义字段。
17. 知识库写入使用 ArticleRecord 与 ArticleDetail，不保存 Fetch 状态副本。
18. 下载顺序是命令局部状态，不写入 ArticleRecord 或 ArticleDetail。
19. 不存在 FetchArticle 转换、空 sections/figures/references 或其他兼容填充。
20. 每个 Chat 的 checkedArticleIds 只有对应 Chat 模型一个 Owner，Sessions、下载和导出不保存副本。
21. View 切换目标或 dispose 时取消其未完成的 Fetch 操作。
22. Promise 完成不直接写入 View 文章状态，View 只响应 Service 变化事件。
23. loading、ready、error 和取消后的 idle 均在对应事件前提交，监听器读到一致 Snapshot。
24. Catalog 刷新后，不可解析的 active Journal/Source/Article ID 被确定性清理。
25. Chat 操作开始前移除无法解析的 checkedArticleIds，并报告缺失项。
26. Source 暂无 Page 或 Detail 未加载时保留稳定 ID。
27. 选择 Journal 只 discovery；选择 Source 只抓该 Source 第一页；显式加载更多只抓该 Source 下一页。
28. 列表展示不会隐式遍历 Journal 的其他 Source、全部分页或全部 ArticleDetail。
29. electron-browser 在 IPC 前解析 ArticleId；electron-main 输入不存在 ArticleId、FetchArticle 或通用 ArticleDetail 替代聚合。
30. DOCX、Agent/RAG 和知识库 DTO 只包含各自实际需要且由 ArticleDetail 提供的字段。
31. 第一版不存在 FetchArticle session/history 持久化，也不存在用空全文字段维持旧正文翻译或 RAG 路径。

所有 Parser 测试使用固定 HTML Fixture，不依赖在线网页。

---

## 23. 验收条件

1. 调用方只依赖 IFetchService。
2. JournalDescriptor 使用 URI 类型的 homeUrl 和 discoveryUrl。
3. homeUrl 只用于快速访问。
4. discoveryUrl 只用于 Source discovery。
5. 公共模型不存在 ExploreContentItem。
6. 公共模型不存在 ArticleTypeItem。
7. Nature Explore content 映射为 ArticleListSourceGroup。
8. Nature Article type 映射为 ArticleListSource。
9. Science Current Issue 和 First Release 映射为直接 ArticleListSource。
10. Science Section 映射为 ArticleGroup。
11. Source Group 和 Result Group 是不同类型。
12. Science articleType 是可选 Article 元数据，不是 Source 层级。
13. ArticleListItem、ArticleRecord、ArticleDetail 保持独立。
14. ArticleId 不因 DOI 出现而改变。
15. description 不作为 abstract fallback。
16. corresponding author 无证据时保持 undefined。
17. Fetch 通过 IPlaywrightService 获取 IBrowserPageSnapshot，不在 IBrowserViewService 创建平行 API。
18. Fetch 不直接使用 Playwright Page 或 invokeFunctionRaw()。
19. 所有异步抓取 API 接收 CancellationToken。
20. Parser Resolver 对 0、1、多个匹配有明确行为。
21. 不存在默认 Parser 或 Parser fallback。
22. Registry 保存 Provider 构造描述符并通过 DI 创建实例。
23. 注册返回 IDisposable。
24. 同 URL 页面重新抓取可以更新内容。
25. Refresh、取消和过期结果语义有测试。
26. 公共模型中不存在 href。
27. 不存在兼容别名、Facade、Adapter 或 Re-export。
28. Nature 和 Science 均有 Catalog、List、Detail Fixture 测试。
29. Fetch 业务运行时位于 `workbench/services/fetch/electron-browser`，Contribution 只负责 UI 注册。
30. 旧 `workbench/services/fetch/electron-main` 抓取编排被直接删除，不存在主进程转发 Facade。
31. IFetchPageSession 明确区分 owned-background 和 borrowed-interactive 所有权。
32. Provider 显式实现 Source、Page 和 Article canonicalization，不删除会改变资源身份的 query。
33. ArticleRecord 不保存列表 title，列表 title 与详情 title 分别属于 ArticleListItem 和 ArticleDetail。
34. ArticleListItemId 包含 providerOccurrenceKey，不合并同页不同位置的卡片。
35. 工作台会话不存在文章状态，不保存 active/checked/selected Article ID、visibleSourceIds、FetchArticle[] 或 ArticleDetail[] 副本。
36. View 直接订阅 IFetchService 变化事件，并在相关 ID 变化后重新查询 Snapshot。
37. `getArticlePages(sourceId)` 和三个 LoadState 查询存在，View 不自行维护分页顺序或加载状态。
38. 每次 LoadState 转换先提交状态再触发对应 ID 事件，事件回调读取到一致 Snapshot。
39. ChatInputPart 与 ChatListWidget 各自拥有订阅，不由 WorkbenchHost 集中代理。
40. ChatService 不订阅 Fetch 事件维护文章副本，只按 chatResource 保存消息中的 ArticleId 引用和 checkedArticleIds，并在 ask(chatResource) 时查询 IFetchService。
41. ChatListWidget 直接复用 `IChatService.subscribe(chatResource, ...)`，不存在 checkbox 专用事件或 checkbox Props 透传。
42. 当前 Chat checkbox 直接以 chatResource + ArticleId 读写 ChatService，不通过 href、DOM 反解析或 Tree selection/focus 建模。
43. WorkbenchHost 不向 Chat 或其他 View 透传 Catalog、ListItem、Detail、文章数组、Fetch 操作或 checkbox 回调。
44. View 不维护与 FetchService 同步的文章 Map、数组或详情缓存。
45. 列表 UI 直接消费 ArticlePage、ArticleGroup 和 ArticleListItem。
46. 聊天勾选使用 ArticleId，不使用 URL + fetchedAt 勾选键。
47. 聊天、PDF、DOCX 和知识库通过 IFetchService 查询 ArticleRecord 与 ArticleDetail。
48. ready ArticleDetail 被 fetchArticle 直接复用，不进行隐式详情刷新。
49. PDF 下载只使用 ArticleDetail.pdfUrl。
50. 下载顺序不进入 ArticleRecord、ArticleDetail 或 ArticleListItem。
51. 第一版不存在伪造的 sections、figures 或 references 空数组。
52. 不存在 BatchSource、BatchFetch Controller、默认来源 URL 表或地址栏 fetch seed。
53. 不存在 FetchArticle 旧应用聚合或 ArticleDetail 到 FetchArticle 的转换。
54. 每个 Chat 的 checkedArticleIds 只有对应 Chat 模型一个 Owner；下载和导出只接收命令时的只读 ID Snapshot。
55. View 切换目标和 dispose 均取消未完成的 Fetch 操作。
56. 同目标普通请求共享底层任务但各自响应 CancellationToken；所有等待者取消后底层任务取消。
57. View 不使用 Promise 完成结果建立第二条本地状态提交路径。
58. Catalog 或 Article 变化后，不可解析的 active ID 被确定性清理。
59. Chat 操作开始前原子移除无法解析的 checkedArticleIds，并报告缺失项。
60. Source 暂无 Page 或 Detail 尚未加载时不清除稳定 ID。
61. Chat 文章来源交互按 Journal discovery、Source fetch 和显式 next page 分步执行，不存在抓取整个 Journal 的循环。
62. 列表阶段不预抓全部 ArticleDetail；详情按打开、Chat/Agent 上下文、下载或导出的实际需求获取。
63. ArticleId 在 electron-browser 的 IFetchService owner 边界解析；electron-main 不接收 ArticleId 后反查 Fetch。
64. 跨 IPC 使用 DOCX、Agent/RAG、知识库各自的最小 DTO，不存在 FetchArticle 或通用兼容聚合。
65. 旧 FetchArticle 的 session、storage/history、sandbox 和 IPC 类型已删除。
66. 每个 Chat 的 checkedArticleIds 无重复、保持勾选顺序，重复设置相同状态不产生 ChatService 通知。

---

## 24. 最终命名

~~~text
对外服务
    IFetchService

服务实现
    FetchService

出版商契约
    IFetchProvider

静态期刊
    JournalDescriptor

来源目录
    ArticleListCatalog

来源目录分组
    ArticleListSourceGroup

实际可抓取来源
    ArticleListSource

真实分页结果
    ArticlePage

期次元数据
    IssueMetadata

结果页面分组
    ArticleGroup

列表卡片快照
    ArticleListItem

稳定文章身份
    ArticleRecord

文章详情
    ArticleDetail

浏览器页面快照
    IBrowserPageSnapshot

Fetch 页面会话
    IFetchPageSession
~~~

最终主链：

~~~text
JournalDescriptor.discoveryUrl
          ↓
     IFetchService
          ↓
    IFetchProvider
          ↓
 IFetchPageSession
          ↓
IPlaywrightService.captureSnapshot()
          ↓
IBrowserPageSnapshot
          ↓
 ArticleListCatalog
          ↓
ArticleListSourceGroup? → ArticleListSource
                              ↓
                         ArticlePage
                              ↓
                         ArticleGroup?
                              ↓
                       ArticleListItem
                              ↓
                        ArticleRecord
                              ↓
                        ArticleDetail
~~~
