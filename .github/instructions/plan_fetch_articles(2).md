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
9. BrowserView 负责页面加载和 HTML Snapshot；Fetch Provider 负责出版商解析。
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

BrowserView / PageSession
├── 页面导航
├── Cookie 和 Session
├── 页面加载状态
├── readiness
└── 序列化 HTML Snapshot

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
BrowserView / PageSession
    ↓
BrowserPageSnapshot
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

---

## 3. Stable IDs

~~~ts
export type JournalId = string;
export type FetchProviderId = string;
export type ArticleListSourceGroupId = string;
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
createArticleListSourceGroupId(journalId, providerGroupKey);
createArticleListSourceId(journalId, canonicalSourceUri);
createArticlePageId(sourceId, canonicalPageUri);
createArticleGroupId(pageId, groupIndex);
createArticleId(journalId, canonicalArticleUri);
createArticleListItemId(pageId, articleId);
~~~

providerGroupKey 由 Provider 从稳定 DOM key、分组 URL 或所属 Source URI 集合生成，禁止直接使用显示 label。结果页面中的 ArticleGroup 只在所属 Page Snapshot 内需要稳定，因此使用 pageId 和页面顺序生成。

ArticleId 始终基于 journalId 和 canonical article URI，首次创建后不改变。DOI 是可补充的外部标识，不参与后续身份升级。

同一文章在详情页发现 DOI 时：

~~~text
ArticleId 保持不变
ArticleRecord.doi 更新
DOI 二级索引更新
~~~

禁止把 url:... 身份替换为 doi:... 身份。

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
	readonly id: ArticleListSourceGroupId;
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
	readonly title: string;
	readonly doi?: string;
}
~~~

同一 ArticleRecord 可以被多个 ArticleListItem 引用。不同列表中的 description、截断作者、图片和 article type 不互相覆盖。

ArticleRecord 的合并规则：

1. 第一个 ArticleListItem 创建 ArticleRecord。
2. 后续列表卡片不覆盖已有 ArticleRecord.title。
3. ArticleDetail 可以用详情页权威 title 和 DOI 更新 ArticleRecord。
4. ArticleId 和 canonical article URI 不随字段更新而改变。

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

## 9. BrowserView Page Snapshot

Fetch 不接收跨进程 DOM 对象。BrowserView 返回可序列化 HTML Snapshot。

~~~ts
export interface BrowserPageSnapshot {
	readonly browserViewId: string;
	readonly navigationId: number;
	readonly uri: URI;
	readonly title: string;
	readonly html: string;
	readonly capturedAt: number;
}
~~~

BrowserView 侧提供直接请求方法：

~~~ts
capturePageSnapshot(
	id: string,
	expectedNavigationId: number,
	token: CancellationToken
): Promise<BrowserPageSnapshot>;
~~~

规则：

1. Snapshot 来自当前实际 WebContents。
2. html 使用 document.documentElement.outerHTML 序列化。
3. 返回最终 URI 和 navigationId。
4. expectedNavigationId 不匹配时明确报错。
5. 页面加载、Cookie、Session、重定向和 readiness 由 BrowserView/PageSession 管理。
6. Fetch 只在本地使用 DOMParser 创建 detached Document。
7. detached Document 中的脚本不得执行。
8. 第一版只抓取 main frame；iframe 支持必须单独设计。
9. Snapshot 必须设置大小限制并记录明确错误。

BrowserView 的导航和 loading 事件只用于状态通知。获取 Snapshot 使用直接方法调用，不通过事件请求和事件回传。

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

	getArticleListItem(
		itemId: ArticleListItemId
	): ArticleListItem | undefined;

	getArticle(
		articleId: ArticleId
	): ArticleRecord | undefined;

	getArticleDetail(
		articleId: ArticleId
	): ArticleDetail | undefined;

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

1. 同一个 Catalog、Source 或 Article 同时只保留一个活动任务。
2. 新 refresh 取消同目标的旧任务。
3. 取消后的结果不得写入状态。
4. navigationId 或任务 generation 不匹配的结果必须丢弃并报告过期。
5. 一个 Source 失败不能污染同 Journal 的其他 Source。

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
	readonly providerKey: string;
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
    Publisher 流程、Snapshot 请求、Parser Resolver 和 URI 规范化

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

## 19. 文件结构

~~~text
src/cs/workbench/contrib/fetch/
├── common/
│   ├── fetch.ts
│   ├── fetchIds.ts
│   ├── fetchProvider.ts
│   ├── fetchRegistry.ts
│   └── fetchService.ts
│
├── electron-browser/
│   ├── fetchService.ts
│   ├── fetchActions.ts
│   ├── fetchMenus.ts
│   ├── fetch.contribution.ts
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
        ├── fetchService.test.ts
        └── providers/
            ├── nature/
            │   ├── fixtures/
            │   └── *.test.ts
            └── science/
                ├── fixtures/
                └── *.test.ts
~~~

BrowserView Snapshot 契约和实现位于 BrowserView 平台层，不放入 Publisher Provider：

~~~text
src/cs/platform/browserView/common/
src/cs/platform/browserView/electron-main/
~~~

实际路径以当前 BrowserView 服务边界为准，不创建 Fetch 私有的 BrowserView Facade。

---

## 20. 实施步骤

### Step 0：读取约束与上游

修改前读取：

1. .github/instructions 下全部适用规则。
2. 当前 Fetch、BrowserView、IPC 和调用面。
3. /Users/lance/Desktop/vscode 中的 Registry、Service、Contribution、CancellationToken 和进程实现。

### Step 1：增加 BrowserView Page Snapshot

实现可取消的 capturePageSnapshot，并验证 navigationId、最终 URI、HTML 序列化、大小限制和销毁行为。

### Step 2：建立新公共模型

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

### Step 3：实现 ID Factory

集中实现所有稳定 ID。ArticleId 不因详情页发现 DOI 而改变。

### Step 4：实现 Registry 与 Provider DI

Registry 注册 JournalDescriptor 和 Provider 构造描述符，重复 ID 报错，注册返回 IDisposable。

### Step 5：实现 FetchService

完成 Catalog、Source、Page、Group、ListItem、Record、Detail 状态，以及取消、并发、refresh 和事件。

### Step 6：实现 Nature Provider

先完成 Catalog discovery，再完成普通列表、News/Opinion 列表和详情 Parser。

### Step 7：实现 Science Provider

完成 Current Issue、First Release、动态 Section、可选 article type、Related Article 和详情 Parser。

### Step 8：迁移调用方

调用方改为：

~~~ts
fetchService.discoverArticleListSources(journalId, token);
fetchService.fetchArticleListSource(sourceId, token);
fetchService.fetchNextPage(sourceId, token);
fetchService.fetchArticle(articleId, token);
~~~

### Step 9：增加菜单

通过 Action2、MenuRegistry 和 IOpenerService 打开 JournalDescriptor.homeUrl。

### Step 10：删除旧结构

删除：

~~~text
ExploreContentItem 公共类型
ArticleTypeItem 公共类型
JournalArticles 旧聚合
ArticleBrowse*
ArticleDetailService
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

## 21. 测试计划

### 21.1 BrowserView Snapshot

验证：

1. 返回当前 main frame 的完整 HTML。
2. 最终 URI 和 navigationId 正确。
3. navigationId 不匹配时报错。
4. CancellationToken 可终止等待。
5. 页面销毁时请求失败。
6. 超过大小限制时报错。
7. Snapshot 中脚本不会在 detached Document 中执行。

### 21.2 ID

验证：

1. 相同输入生成相同 ID。
2. Source Group label 变化时不改变基于 providerGroupKey 的身份。
3. 相同 Source 的不同分页 URL 不冲突。
4. ArticleId 基于 journalId 和 canonical URI。
5. 详情发现 DOI 不改变 ArticleId。
6. 同一 Page 中同一 Article 生成同一 ListItemId。

### 21.3 Registry

验证：

1. 注册和读取 Journal。
2. 注册和读取 Provider Descriptor。
3. 重复 ID 报错。
4. dispose 后撤销注册。
5. 注册顺序不改变最终结果。

### 21.4 Nature

验证：

1. Explore content 解析为 Source Group。
2. Article type 解析为 Source。
3. 不存在 Article type 的非文章入口不创建空 Source。
4. 普通列表和 News/Opinion 列表匹配范围明确。
5. 0 个 Parser 匹配时报错。
6. 多个 Parser 匹配时报错。
7. 列表 Parser 不输出 ArticleDetail。
8. Detail Parser 不处理列表页面。

### 21.5 Science

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

### 21.6 FetchService

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

所有 Parser 测试使用固定 HTML Fixture，不依赖在线网页。

---

## 22. 验收条件

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
17. BrowserView 返回序列化 HTML Snapshot，不返回 DOM 对象。
18. Snapshot 使用直接方法调用，不使用事件控制流。
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

---

## 23. 最终命名

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
    BrowserPageSnapshot
~~~

最终主链：

~~~text
JournalDescriptor.discoveryUrl
          ↓
     IFetchService
          ↓
    IFetchProvider
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
