# Plan：多期刊 Article Fetch 重构

## 0. 结论

本次重构统一收口到一个对外服务：

```ts
IFetchService
```

不同网站家族通过内部 Provider 扩展：

```ts
IFetchProvider
```

Nature、Science、ACS、Wiley 等 Provider 内部再根据页面结构选择具体 Parser。

最终不再引入以下独立领域：

```text
ArticleBrowseService
ArticleDetailService
ArticleBrowseState
ArticleBrowseIndex
JournalArticleBrowseModel
```

`Browse` 只是抓取流程中的一个阶段，不单独成为对外 Service 或公共领域模型。

---

## 1. 目标

建立一套支持多出版商、多期刊、多栏目、多文章类型和分页抓取的统一 Fetch 架构。

核心目标：

1. 调用方只依赖 `IFetchService`。
2. 每个期刊拥有稳定 `JournalId`。
3. 每个期刊保留：
   - `homeUrl`：官网快速访问；
   - `articlesUrl`：文章列表主页抓取入口。
4. 每个期刊自己的 `Explore content` 和 `Article type` 从页面动态解析，禁止静态写死。
5. 物理存储采用规范化结构。
6. 逻辑层级保持为：

```text
Journal
└── ExploreContentItem
    └── ArticleTypeItem
        └── ArticlePage
            └── ArticleSummary
```

7. Article list 与 Article detail 分阶段抓取，但统一由 `IFetchService` 管理。
8. 公共模型统一使用 `url`；`href` 只允许存在于 HTML Parser 内部。
9. 不保留旧接口、兼容别名、Facade 或 Re-export。

---

## 2. 最终架构

```text
Contribution
├── 注册 JournalDescriptor
└── 注册 IFetchProvider

IFetchService
├── 读取 JournalDescriptor
├── 解析 Provider
├── 抓取期刊 articles 主页
├── 抓取 Article type 分页
├── 抓取 Article detail
├── 管理多期刊状态
├── 合并分页
├── 去重文章
├── 缓存详情
└── 发布变化事件

IFetchProvider
├── NatureFetchProvider
├── ScienceFetchProvider
├── AcsFetchProvider
└── ...

Provider 内部
├── 根页面 Parser
├── Nature Article List Parser
├── Nature News / Opinion List Parser（仅 Nature 主刊特例）
├── Nature Article Detail Parser
└── Nature News / Opinion Detail Parser（仅在详情结构确实需要时）
```

---

## 3. 公共数据模型

### 3.1 Stable IDs

```ts
export type JournalId = string;
export type FetchProviderId = string;
export type ExploreContentId = string;
export type ArticleTypeId = string;
export type ArticlePageId = string;
export type ArticleId = string;
```

所有动态 ID 必须通过统一 Factory 生成，禁止 Parser、Provider 或 Service 各自拼接字符串。

---

### 3.2 JournalDescriptor

```ts
export interface JournalDescriptor {
	/**
	 * 稳定业务身份。
	 *
	 * 显示名称或 URL 变化时，ID 不应变化。
	 */
	readonly id: JournalId;

	readonly title: string;

	/**
	 * 期刊官方网站主页。
	 *
	 * 用于：
	 * - 快速访问官网；
	 * - 菜单项；
	 * - 期刊标题链接；
	 * - 未来其他官网级操作。
	 */
	readonly homeUrl: string;

	/**
	 * 期刊文章列表主页。
	 *
	 * 用于解析：
	 * Explore content → Article type → Article page。
	 */
	readonly articlesUrl: string;

	/**
	 * 负责该期刊页面的 Provider。
	 */
	readonly providerId: FetchProviderId;
}
```

示例：

```ts
export const NatureJournalIds = {
	nature: 'journal.nature.nature',
	natureCommunications: 'journal.nature.nature-communications',
	scientificReports: 'journal.nature.scientific-reports'
} as const;

export const natureJournals = [
	{
		id: NatureJournalIds.nature,
		title: 'Nature',
		homeUrl: 'https://www.nature.com/nature',
		articlesUrl: 'https://www.nature.com/nature/articles',
		providerId: 'fetch.provider.nature'
	},
	{
		id: NatureJournalIds.natureCommunications,
		title: 'Nature Communications',
		homeUrl: 'https://www.nature.com/ncomms',
		articlesUrl: 'https://www.nature.com/ncomms/articles',
		providerId: 'fetch.provider.nature'
	}
] satisfies readonly JournalDescriptor[];
```

`natureJournals.ts` 中禁止出现：

```text
Explore content
Article type
News & Comment
Reviews & Analysis
Collections
Subjects
```

这些必须来自运行时页面解析。

---

### 3.3 JournalArticles

`JournalArticles` 表示某个期刊当前已经加载的文章结构和数据。

它允许部分加载，不表示已经抓取该期刊全部文章。

```ts
export interface JournalArticles {
	readonly journalId: JournalId;

	/**
	 * Explore content 的网站展示顺序。
	 */
	readonly exploreContentIds: readonly ExploreContentId[];

	readonly exploreContentById: Readonly<
		Record<ExploreContentId, ExploreContentItem>
	>;

	readonly articleTypeById: Readonly<
		Record<ArticleTypeId, ArticleTypeItem>
	>;

	readonly pageById: Readonly<
		Record<ArticlePageId, ArticlePage>
	>;

	readonly articleById: Readonly<
		Record<ArticleId, ArticleSummary>
	>;
}
```

逻辑关系：

```text
JournalArticles.exploreContentIds
    ↓
ExploreContentItem.articleTypeIds
    ↓
ArticleTypeItem.pageIds
    ↓
ArticlePage.articleIds
    ↓
ArticleSummary
```

---

### 3.4 ExploreContentItem

```ts
export interface ExploreContentItem {
	readonly id: ExploreContentId;

	/**
	 * 例如：
	 * Research articles
	 * Reviews & Analysis
	 * News & Comment
	 */
	readonly label: string;

	readonly url: string;

	/**
	 * 当前栏目实际包含的 Article type。
	 *
	 * 顺序与网站一致。
	 */
	readonly articleTypeIds: readonly ArticleTypeId[];
}
```

对于 `Videos`、`Collections`、`Subjects` 等没有 Article type 子项的入口：

```ts
{
	id: '...',
	label: 'Collections',
	url: '...',
	articleTypeIds: []
}
```

不创建虚假的 `ArticleTypeItem` 补齐层级。

---

### 3.5 ArticleTypeItem

```ts
export interface ArticleTypeItem {
	readonly id: ArticleTypeId;

	/**
	 * 例如：
	 * Article
	 * Matters Arising
	 * Review Article
	 * Perspective
	 */
	readonly label: string;

	/**
	 * 该类型的文章列表入口。
	 */
	readonly url: string;

	/**
	 * 当前已经加载的分页实体。
	 *
	 * 数组顺序即页面顺序或加载顺序。
	 */
	readonly pageIds: readonly ArticlePageId[];
}
```

父子关系只保存在：

```ts
ExploreContentItem.articleTypeIds
```

不再给 `ArticleTypeItem` 同时保存 `exploreContentId`，避免双向状态不一致。

---

### 3.6 ArticlePage

```ts
export interface ArticlePage {
	readonly id: ArticlePageId;

	/**
	 * 当前真实分页 URL。
	 *
	 * 必须保留 page、sort、date、cursor 等会改变结果的参数。
	 */
	readonly url: string;

	/**
	 * 当前页面中的文章顺序。
	 */
	readonly articleIds: readonly ArticleId[];

	/**
	 * 页面明确提供可靠数字页码时才保存。
	 */
	readonly pageNumber?: number;

	/**
	 * 没有下一页时不存在。
	 */
	readonly nextPageUrl?: string;
}
```

`pageIds` 表示已加载的分页实体，不等同于页码数组。

分页身份不能只依赖 `pageNumber`，因为部分网站可能采用：

```text
page=2
start=20
cursor=...
Load more
日期窗口
不透明 next URL
```

---

### 3.7 ArticleSummary

第一版不拆 `ArticleListItem` 和 `ArticleRecord`。

```ts
export interface ArticleSummary {
	readonly id: ArticleId;

	/**
	 * 文章实际所属期刊。
	 */
	readonly journalId: JournalId;

	/**
	 * 文章详情页 canonical URL。
	 */
	readonly url: string;

	/**
	 * 不包含 https://doi.org/ 前缀。
	 */
	readonly doi?: string;

	readonly title: string;

	/**
	 * 列表卡片中的 description、teaser 或摘要片段。
	 */
	readonly description?: string;

	readonly articleType?: string;
	readonly publishedAt?: string;

	/**
	 * 列表页实际展示的作者，不保证完整。
	 */
	readonly authors: readonly ArticleAuthorRef[];

	readonly image?: ArticleImage;
}

export interface ArticleAuthorRef {
	readonly name: string;
	readonly url?: string;
}

export interface ArticleImage {
	readonly url: string;
	readonly alt?: string;
}
```

同一文章出现在多个列表时，由多个 `ArticlePage.articleIds` 引用同一个 `ArticleId`。

第一版接受不同列表卡片字段被合并的限制。

只有未来明确需要保留不同列表的卡片快照时，再新增：

```text
ArticleListItem
ArticleListItemId
listItemById
```

本次不提前引入。

---

### 3.8 ArticleDetail

```ts
export interface ArticleDetail {
	readonly articleId: ArticleId;
	readonly journalId: JournalId;

	readonly url: string;
	readonly doi?: string;
	readonly title: string;

	/**
	 * News、Opinion 等页面中的 teaser 或 standfirst。
	 */
	readonly description?: string;

	/**
	 * 正式论文摘要。
	 */
	readonly abstract?: string;

	readonly articleType?: string;
	readonly publishedAt?: string;
	readonly isOpenAccess?: boolean;

	/**
	 * 详情页中的完整作者列表。
	 */
	readonly authors: readonly ArticleAuthor[];

	readonly publication: ArticlePublication;

	readonly pdfUrl?: string;
	readonly citationUrl?: string;
}

export interface ArticleAuthor extends ArticleAuthorRef {
	readonly isCorresponding: boolean;
}

export interface ArticlePublication {
	readonly journalId?: JournalId;

	/**
	 * 页面实际显示的期刊或杂志名称。
	 */
	readonly title: string;

	readonly url?: string;
	readonly volume?: string;
	readonly issue?: string;
	readonly articleNumber?: string;
	readonly pages?: string;
	readonly year?: number;
}
```

---

## 4. IFetchService

`IFetchService` 是 Fetch contrib 唯一对外 Service。

```ts
export interface IFetchService {
	readonly _serviceBrand: undefined;

	/**
	 * 某个期刊的栏目、类型、分页或文章摘要发生变化。
	 */
	readonly onDidChangeJournal: Event<JournalId>;

	/**
	 * 某篇文章详情发生变化。
	 */
	readonly onDidChangeArticle: Event<ArticleId>;

	getJournals(): readonly JournalDescriptor[];

	getJournal(
		journalId: JournalId
	): JournalDescriptor | undefined;

	getJournalArticles(
		journalId: JournalId
	): JournalArticles | undefined;

	getArticle(
		journalId: JournalId,
		articleId: ArticleId
	): ArticleSummary | undefined;

	getArticleDetail(
		articleId: ArticleId
	): ArticleDetail | undefined;

	/**
	 * 抓取期刊 articles 根页面，建立：
	 *
	 * Explore content → Article type。
	 */
	fetchJournal(
		journalId: JournalId
	): Promise<void>;

	/**
	 * 抓取某一个 Article type 的第一页。
	 */
	fetchArticleType(
		journalId: JournalId,
		articleTypeId: ArticleTypeId
	): Promise<void>;

	/**
	 * 抓取该 Article type 的下一页。
	 */
	fetchNextPage(
		journalId: JournalId,
		articleTypeId: ArticleTypeId
	): Promise<void>;

	/**
	 * 抓取单篇文章详情。
	 */
	fetchArticle(
		journalId: JournalId,
		articleId: ArticleId
	): Promise<ArticleDetail>;

	refreshJournal(
		journalId: JournalId
	): Promise<void>;
}
```

### 4.1 Service 职责

`FetchService` 负责：

```text
JournalDescriptor 读取
Provider 解析
多期刊状态
抓取任务调度
并发控制
分页合并
文章去重
详情缓存
加载状态
错误隔离
变化事件
```

调用方不应自行：

```text
根据 URL 猜 Provider
根据 label 建立父子关系
拼接分页 URL
合并 Parser 结果
维护文章详情缓存
```

---

## 5. 运行时状态

```ts
export interface FetchState {
	readonly journalArticlesById: Readonly<
		Partial<Record<JournalId, JournalArticles>>
	>;

	readonly articleDetailById: Readonly<
		Partial<Record<ArticleId, ArticleDetail>>
	>;

	readonly journalLoadStateById: Readonly<
		Partial<Record<JournalId, FetchLoadState>>
	>;

	readonly articleTypeLoadStateById: Readonly<
		Partial<Record<ArticleTypeId, FetchLoadState>>
	>;

	readonly articleDetailLoadStateById: Readonly<
		Partial<Record<ArticleId, FetchLoadState>>
	>;
}

export interface FetchLoadState {
	readonly status: 'idle' | 'loading' | 'ready' | 'error';
	readonly error?: string;
	readonly updatedAt?: string;
}
```

必须支持：

```text
Nature：ready
Nature Communications：loading
Scientific Reports：error
```

单个期刊、类型或文章失败，不能污染其他状态。

---

## 6. IFetchProvider

```ts
export interface IFetchProvider {
	readonly id: FetchProviderId;

	/**
	 * 抓取期刊 articles 根页面。
	 */
	fetchJournal(
		journal: JournalDescriptor
	): Promise<FetchJournalResult>;

	/**
	 * 抓取某个 Article type 的某一页。
	 */
	fetchPage(
		journal: JournalDescriptor,
		url: string
	): Promise<FetchPageResult>;

	/**
	 * 抓取单篇文章详情。
	 */
	fetchArticle(
		journal: JournalDescriptor,
		url: string
	): Promise<ArticleDetail>;
}
```

结果类型：

```ts
export interface FetchJournalResult {
	readonly exploreContentIds: readonly ExploreContentId[];

	readonly exploreContentById: Readonly<
		Record<ExploreContentId, ExploreContentItem>
	>;

	readonly articleTypeById: Readonly<
		Record<ArticleTypeId, ArticleTypeItem>
	>;
}

export interface FetchPageResult {
	readonly page: ArticlePage;

	readonly articleById: Readonly<
		Record<ArticleId, ArticleSummary>
	>;
}
```

边界：

```text
IFetchService
    负责应用级状态和工作流

IFetchProvider
    负责某个网站家族的抓取实现

Parser
    负责某一种具体 HTML 结构
```

---

## 7. Fetch Registry

Registry 只负责静态 Contribution 注册，不对 UI 暴露为 Service。

```ts
export interface IFetchRegistry {
	registerJournal(
		descriptor: JournalDescriptor
	): void;

	registerProvider(
		provider: IFetchProvider
	): void;

	getJournal(
		journalId: JournalId
	): JournalDescriptor | undefined;

	getJournals(): readonly JournalDescriptor[];

	getProvider(
		providerId: FetchProviderId
	): IFetchProvider | undefined;
}
```

注册链路：

```text
Nature contribution
├── registerProvider(NatureFetchProvider)
└── registerJournal(Nature / Nature Communications / ...)

Science contribution
├── registerProvider(ScienceFetchProvider)
└── registerJournal(Science / Science Advances / ...)

ACS contribution
├── registerProvider(AcsFetchProvider)
└── registerJournal(ACS Nano / Nano Letters / ...)
```

`FetchService` 内部解析：

```text
journalId
→ JournalDescriptor
→ providerId
→ IFetchProvider
```

重复 `JournalId` 或 `FetchProviderId` 必须直接报错。

---

## 8. Nature Provider

### 8.1 先按页面职责区分

Nature Provider 只保留三条明确的解析链：

```text
articles 根页面
    NatureExploreContentParser

文章列表页面
    Article List Parser

单篇文章详情页面
    Article Detail Parser
```

三类页面的输入目标和输出不同：

```text
根页面 Parser
    输入：期刊 articles 主页
    输出：Explore content + Article type

List Parser
    输入：包含多篇文章的列表页面
    输出：ArticlePage + ArticleSummary

Detail Parser
    输入：只描述一篇文章的详情页面
    输出：ArticleDetail
```

List 与 Detail 必须继续分开，因为它们属于不同页面职责和不同输出契约。

---

### 8.2 News / Opinion 是 Nature 主刊特例，不是通用分类轴

`News` 和 `Opinion` 是 Nature 主刊 `Explore content` 下的栏目。

它们的特殊点是页面 HTML 结构不同，因此需要 Nature 内部的专用 Parser；但不应由此建立一套对称的：

```text
Standard
News / Opinion
```

通用分类。

否则会错误暗示：

1. 所有 Nature 页面都必须被归入 `Standard` 或 `News / Opinion`；
2. 所有 List 和 Detail 都必须对称拆成两套实现；
3. 以后每出现一个特殊布局，都要继续扩展同一分类轴；
4. `Standard` 会逐渐变成含义模糊的默认桶。

正确关系是：

```text
NatureArticleListParser
    处理 Nature 系列通常使用的文章列表结构

NatureNewsOpinionListParser
    只处理 Nature 主刊 News / Opinion 的特殊列表结构

NatureArticleDetailParser
    处理通常的 Nature 文章详情结构

NatureNewsOpinionArticleDetailParser
    仅在 News / Opinion 详情结构无法由主 Detail Parser 清楚覆盖时存在
```

因此，News / Opinion Parser 是 Nature Provider 内部的特例实现，不进入公共模型，也不成为跨出版商的通用类型。

---

### 8.3 List Parser 契约

```ts
export interface INatureArticleListParser {
	canParse(context: NatureParseContext): boolean;

	parse(
		context: NatureParseContext
	): FetchPageResult;
}
```

List Parser 只能输出：

```text
ArticlePage
ArticleSummary
```

不能输出 `ArticleDetail`，也不能承担详情字段补全。

Nature Provider 当前可以持有两个 List Parser：

```ts
private readonly articleListParser =
	new NatureArticleListParser();

private readonly newsOpinionListParser =
	new NatureNewsOpinionListParser();
```

分派时先检查专用 Parser，再检查通常 Parser：

```ts
private parsePage(
	context: NatureParseContext
): FetchPageResult {
	if (this.newsOpinionListParser.canParse(context)) {
		return this.newsOpinionListParser.parse(context);
	}

	if (this.articleListParser.canParse(context)) {
		return this.articleListParser.parse(context);
	}

	throw new Error(
		`No Nature article list parser for ${context.url}`
	);
}
```

这里不是把通常 Parser 当作无条件 fallback。两个 Parser 都必须通过自己的结构识别。

---

### 8.4 Detail Parser 契约

```ts
export interface INatureArticleDetailParser {
	canParse(context: NatureParseContext): boolean;

	parse(
		context: NatureParseContext
	): ArticleDetail;
}
```

默认先保留一个：

```text
NatureArticleDetailParser
```

只有在实际 Fixture 和页面验证中确认 News / Opinion 详情结构存在独立解析流程时，才增加：

```text
NatureNewsOpinionArticleDetailParser
```

判断标准：

```text
只有少量 selector 不同
    → 保留一个 NatureArticleDetailParser
    → 在局部使用替代 selector 或小型 helper

标题区、作者区、teaser / abstract、publication 等主结构明显不同
    → 增加 NatureNewsOpinionArticleDetailParser
```

不要为了与 List 形成形式上的对称，预先创建第二个 Detail Parser。

如果需要专用 Detail Parser，Provider 使用同样的“专用优先、通常结构随后、无匹配报错”分派：

```ts
private parseArticle(
	context: NatureParseContext
): ArticleDetail {
	if (
		this.newsOpinionArticleDetailParser?.canParse(context)
	) {
		return this.newsOpinionArticleDetailParser.parse(context);
	}

	if (this.articleDetailParser.canParse(context)) {
		return this.articleDetailParser.parse(context);
	}

	throw new Error(
		`No Nature article detail parser for ${context.url}`
	);
}
```

---

### 8.5 Parser 选择依据

Parser 选择依据：

```text
DOM 标记
HTML 结构
必要的 URL 特征
```

URL 特征只能作为辅助证据。

禁止在 `JournalDescriptor` 中增加：

```ts
kind: 'articles' | 'news' | 'opinion';
```

也禁止在公共 `ArticleTypeItem` 中加入 Parser ID。

内容栏目与 Parser 选择不是同一个概念。

---

### 8.6 公共解析能力

第一版不预设宽泛的：

```text
common/natureParser.ts
```

也不建立 Parser 基类。

只有在两个以上 Parser 出现真实重复后，才提取纯解析函数，例如：

```text
parseCanonicalUrl
parseDoi
parsePublishedAt
parseArticleType
parseOpenAccess
parseJournalTitle
```

公共 helper 必须满足：

```text
无网络请求
无状态写入
不依赖具体 Parser 生命周期
输入明确
输出明确
可单独测试
```

出现真实复用后，可以建立：

```text
natureArticleMetadata.ts
```

如果尚无重复，则不创建公共文件。

---
## 9. ID 规则

### 9.1 JournalId

显式声明：

```text
journal.nature.nature
journal.nature.nature-communications
journal.acs.nano-letters
```

不使用固定数字作为业务 ID。

---

### 9.2 动态浏览节点

根据以下内容确定性生成：

```text
实体类型 + journalId + canonical URL
```

统一 Factory：

```ts
createExploreContentId(
	journalId,
	canonicalUrl
);

createArticleTypeId(
	journalId,
	canonicalUrl
);

createArticlePageId(
	journalId,
	canonicalUrl
);
```

禁止根据 `label` 生成 ID。

---

### 9.3 ArticleId

优先使用 DOI：

```ts
const articleId = doi
	? `doi:${doi.toLowerCase()}`
	: `url:${canonicalUrl}`;
```

DOI 必须规范化，不包含：

```text
https://doi.org/
http://dx.doi.org/
doi:
```

---

## 10. URL 命名规则

公共模型统一使用：

```text
homeUrl
articlesUrl
url
nextPageUrl
pdfUrl
citationUrl
image.url
publication.url
```

`href` 只存在于 Parser 局部变量：

```ts
const href = anchor.getAttribute('href');

const url = href
	? new URL(href, pageUrl).href
	: undefined;
```

公共接口中禁止出现：

```text
href
articleHref
journalHref
pdfHref
```

---

## 11. Menu 与 homeUrl

`homeUrl` 保留，用于菜单和快速访问。

Menu ID 属于 UI Contribution，不进入 `JournalDescriptor`：

```ts
export const JournalMenuId = new MenuId(
	'fetch.journals'
);
```

使用一个通用 Command：

```ts
export const OpenJournalHomeCommandId =
	'fetch.openJournalHome';
```

菜单项通过参数传递 `journalId`：

```ts
for (const journal of fetchRegistry.getJournals()) {
	MenuRegistry.appendMenuItem(JournalMenuId, {
		command: {
			id: OpenJournalHomeCommandId,
			title: journal.title,
			arguments: [journal.id]
		}
	});
}
```

Command Handler：

```ts
const journal = fetchService.getJournal(journalId);

if (!journal) {
	throw new Error(`Unknown journal: ${journalId}`);
}

openExternal(journal.homeUrl);
```

边界：

```text
homeUrl
    官网访问、菜单、外部链接

articlesUrl
    FetchService 和 Provider 抓取入口

JournalMenuId
    UI 菜单容器
```

---

## 12. 文件结构

```text
src/cs/workbench/contrib/fetch/
├── common/
│   ├── fetch.ts
│   ├── fetchIds.ts
│   ├── fetchService.ts
│   ├── fetchProvider.ts
│   └── fetchRegistry.ts
│
├── browser/
│   ├── fetchService.ts
│   ├── fetchActions.ts
│   ├── fetchMenus.ts
│   ├── fetch.contribution.ts
│   │
│   └── providers/
│       ├── nature/
│       │   ├── natureJournals.ts
│       │   ├── natureFetchProvider.ts
│       │   ├── natureExploreContentParser.ts
│       │   ├── natureArticleListParser.ts
│       │   ├── natureNewsOpinionListParser.ts
│       │   ├── natureArticleDetailParser.ts
│       │   ├── natureNewsOpinionArticleDetailParser.ts
│       │   └── nature.contribution.ts
│       │
│       ├── science/
│       │   ├── scienceJournals.ts
│       │   ├── scienceFetchProvider.ts
│       │   └── science.contribution.ts
│       │
│       └── acs/
│           ├── acsJournals.ts
│           ├── acsFetchProvider.ts
│           └── acs.contribution.ts
│
└── test/
    ├── common/
    │   ├── fetchIds.test.ts
    │   └── fetchRegistry.test.ts
    │
    └── browser/
        ├── fetchService.test.ts
        │
        └── providers/
            └── nature/
                ├── fixtures/
                │   ├── nature-communications-articles.html
                │   ├── nature-article-list.html
                │   ├── nature-news-opinion-list.html
                │   ├── nature-article-detail.html
                │   └── nature-news-opinion-detail.html
                │
                ├── natureExploreContentParser.test.ts
                ├── natureArticleListParser.test.ts
                ├── natureNewsOpinionListParser.test.ts
                ├── natureArticleDetailParser.test.ts
                └── natureNewsOpinionArticleDetailParser.test.ts
```

职责：

```text
common/fetch.ts
    公共数据结构

common/fetchIds.ts
    所有确定性 ID 生成逻辑

common/fetchService.ts
    IFetchService 和 Service Decorator

common/fetchProvider.ts
    IFetchProvider 及 Provider Result

common/fetchRegistry.ts
    Journal / Provider Contribution Registry

browser/fetchService.ts
    状态、缓存、任务、合并、事件

browser/fetchActions.ts
    打开官网、刷新期刊等 Action

browser/fetchMenus.ts
    Journal Menu Contribution

browser/fetch.contribution.ts
    注册 FetchService、Action 和 Menu

natureJournals.ts
    Nature 系列 JournalDescriptor

natureFetchProvider.ts
    Nature 抓取流程和 Parser 分派

natureExploreContentParser.ts
    解析 articles 根页面中的 Explore content 和 Article type

natureArticleListParser.ts
    解析 Nature 系列通常使用的文章列表结构

natureNewsOpinionListParser.ts
    只解析 Nature 主刊 News / Opinion 的特殊列表结构

natureArticleDetailParser.ts
    解析通常的 Nature 文章详情结构

natureNewsOpinionArticleDetailParser.ts
    仅在 News / Opinion 详情结构确实需要独立流程时保留

nature.contribution.ts
    注册 Nature Provider 和 Nature Journals
```

如果最终验证表明 News / Opinion 详情只存在少量 selector 差异，则删除：

```text
natureNewsOpinionArticleDetailParser.ts
natureNewsOpinionArticleDetailParser.test.ts
nature-news-opinion-detail.html
```

并将差异留在 `natureArticleDetailParser.ts` 的局部解析逻辑中。

第一版不预设：

```text
nature/common/
common/natureParser.ts
Parser 基类
Standard Parser 命名
```

---
## 13. 实施步骤

### Step 0：读取仓库约束

修改前必须读取：

1. `.github/instructions/coding-guidelines.instructions.md`
2. `.github/instructions/architecture.instructions.md`
3. 所有匹配 `fetch` 路径的 `.github/instructions/*.instructions.md`
4. `.github/conductor-instructions.md`
5. 当前 Fetch 相关代码、测试和调用面
6. 上游 VS Code 的 Registry、Service、Command、Action、Menu 和 Contribution 实现

文档只作为参考，最终以当前代码、测试和运行行为为准。

---

### Step 1：建立最终公共模型

新增：

```text
JournalDescriptor
JournalArticles
ExploreContentItem
ArticleTypeItem
ArticlePage
ArticleSummary
ArticleDetail
FetchState
FetchLoadState
```

不创建旧类型别名。

---

### Step 2：集中实现 ID Factory

新增：

```text
createExploreContentId
createArticleTypeId
createArticlePageId
createArticleId
```

所有 Parser、Provider、Service 和测试统一使用。

---

### Step 3：实现 Fetch Registry

实现：

```text
registerJournal
registerProvider
getJournal
getJournals
getProvider
```

重复稳定 ID 时直接报错。

---

### Step 4：注册 Nature 系列期刊

建立 `natureJournals.ts`。

每个期刊只登记：

```text
id
title
homeUrl
articlesUrl
providerId
```

不登记任何 Explore content 或 Article type。

---

### Step 5：建立 IFetchProvider 契约

将不同网站家族的实现统一到：

```text
fetchJournal
fetchPage
fetchArticle
```

删除调用方直接按站点或 URL 分支的逻辑。

---

### Step 6：实现 Nature 根页面 Parser

从每个期刊自己的 `articlesUrl` 动态解析：

```text
Explore content
└── Article type
```

输出规范化 `FetchJournalResult`。

---

### Step 7：实现 Nature List Parsers

实现：

```text
NatureArticleListParser
NatureNewsOpinionListParser
```

两者实现同一个 `INatureArticleListParser` 契约，并统一输出：

```text
ArticlePage
ArticleSummary
```

其中：

```text
NatureArticleListParser
    处理 Nature 系列通常使用的列表结构

NatureNewsOpinionListParser
    只处理 Nature 主刊 News / Opinion 特殊列表结构
```

不创建：

```text
NatureArticleListParser
```

也不建立 `Standard / NewsOpinion` 的通用分类体系。

Provider 分派时先检查 News / Opinion 专用结构，再检查通常列表结构；两者都必须通过 `canParse()`。

---

### Step 8：实现 Nature Detail Parser

先实现：

```text
NatureArticleDetailParser
```

并使用普通 Nature 文章与 News / Opinion Fixture 验证其覆盖范围。

只有在确认 News / Opinion 详情的主结构无法由局部 selector 差异清楚表达时，才新增：

```text
NatureNewsOpinionArticleDetailParser
```

无论采用一个还是两个 Detail Parser，最终都统一输出：

```text
ArticleDetail
```

不创建：

```text
NatureArticleDetailParser
```

也不为了与 List Parser 形成对称而强制拆分 Detail Parser。

---
### Step 9：实现 FetchService

实现：

```text
多期刊状态
Provider 解析
抓取任务调度
类型独立加载
分页追加
文章去重
详情缓存
加载状态
错误隔离
变化事件
```

内部状态可以使用 `Map`，对外暴露只读 Snapshot 或查询方法。

---

### Step 10：迁移调用方

调用方统一改为：

```ts
fetchService.fetchJournal(journalId);

fetchService.fetchArticleType(
	journalId,
	articleTypeId
);

fetchService.fetchNextPage(
	journalId,
	articleTypeId
);

fetchService.fetchArticle(
	journalId,
	articleId
);
```

UI 不再直接依赖：

```text
IFetchProvider
IFetchRegistry
具体 Nature Parser
具体 URL 规则
```

---

### Step 11：增加 Journal Menu

增加：

```text
JournalMenuId
fetch.openJournalHome
```

根据已注册 `JournalDescriptor` 生成菜单项，并使用 `homeUrl`。

---

### Step 12：删除旧结构

删除：

```text
ArticleBrowseService
ArticleDetailService
ArticleBrowseState
ArticleBrowseIndex
JournalArticleBrowseModel
articleBrowse.ts
articleBrowseIds.ts
articleBrowseUrl
ArticleListPage
ArticleListItem
ArticleRecord
公共模型中的 href
pdfHref
articleHref
journalHref
静态 Explore content
kind: 'news' | 'opinion'
旧 Provider 选择分支
兼容别名
Facade
Re-export
```

迁移触及多少文件，就是实际修改范围，不通过旧接口包装缩小调用面。

---

## 14. 测试计划

### 14.1 ID Tests

验证：

1. 相同输入生成相同 ID。
2. 不同期刊相同 Label 不冲突。
3. URL canonicalization 后生成稳定 ID。
4. DOI 大小写和 resolver 前缀被规范化。
5. URL fallback ArticleId 稳定。

---

### 14.2 Registry Tests

验证：

1. 注册并读取 Journal。
2. 注册并读取 Provider。
3. 重复 JournalId 报错。
4. 重复 ProviderId 报错。
5. 未知 ID 返回明确结果。
6. 多 Contribution 注册顺序不影响最终结果。

---

### 14.3 Nature Parser Fixture Tests

至少覆盖：

```text
Nature Communications articles 根页面
Nature 通常文章列表
Nature 主刊 News / Opinion 列表
Nature 通常文章详情
Nature 主刊 News / Opinion 详情
无图片文章
无摘要文章
无 DOI 文章
多作者文章
Corresponding author
无下一页列表
```

分别验证：

```text
NatureExploreContentParser
NatureArticleListParser
NatureNewsOpinionListParser
NatureArticleDetailParser
```

只有保留专用 News / Opinion Detail Parser 时，再验证：

```text
NatureNewsOpinionArticleDetailParser
```

额外验证：

1. `NatureNewsOpinionListParser` 只匹配 Nature 主刊的特殊列表结构。
2. `NatureArticleListParser` 不静默吞掉 News / Opinion 特殊列表页面。
3. 两个 List Parser 都不匹配时，Provider 明确报错。
4. Detail 只有少量 selector 差异时，由一个 Parser 覆盖。
5. Detail 主结构明显不同且已拆分时，两个 Parser 的匹配范围互不重叠。
6. Parser 选择主要依据 DOM 结构，而不是静态内容类型枚举。
7. 可选字段缺失时保持 `undefined`，不构造虚假值。
8. 不存在名为 `Standard` 的 Parser。

Parser 测试只基于固定 HTML Fixture，不依赖在线网页。

---
### 14.4 FetchService Tests

验证：

1. Nature 与 Nature Communications 可同时加载。
2. 两个期刊同名 `Article` 类型 ID 不冲突。
3. 每个期刊可以拥有不同 Explore content。
4. 一个期刊失败不影响其他期刊。
5. 一个 Article type 失败不影响同一期刊其他类型。
6. `pageIds: []` 与“已加载但无文章”可通过 LoadState 区分。
7. `fetchNextPage` 只追加目标类型分页。
8. 重复抓取同一页不会重复追加文章。
9. 同一文章在多个页面中只保留一个 `ArticleSummary`。
10. Article detail 独立缓存。
11. 刷新期刊不会清空其他期刊。
12. 变化事件只携带受影响 JournalId 或 ArticleId。

---

## 15. 验收条件

1. 调用方只依赖 `IFetchService`。
2. 公共层不再存在 `ArticleBrowse*` Service、State 或 Model。
3. Nature 与 Nature Communications 可同时加载且互不覆盖。
4. 不同期刊可以拥有完全不同的 Explore content。
5. `natureJournals.ts` 不包含任何 Explore content 或 Article type。
6. `homeUrl` 只用于官网访问。
7. `articlesUrl` 只用于文章结构抓取。
8. `JournalMenuId` 不进入 `JournalDescriptor`。
9. `Explore content → Article type → page → article` 可通过 ID 完整恢复。
10. 每个 Article type 独立维护分页和加载状态。
11. 一个期刊或类型失败不会污染全局状态。
12. News / Opinion Parser 由页面结构选择，不依赖静态内容枚举。
13. `NatureNewsOpinionListParser` 只作为 Nature 主刊特殊列表解析器存在。
14. 不存在 `NatureArticleListParser` 或 `NatureArticleDetailParser`。
15. Detail 只有在主结构确实不同时才拆出 News / Opinion 专用 Parser。
16. 不存在同时处理 News / Opinion List 和 Detail 的宽泛 Parser。
17. Article detail 独立加载，但由同一个 `IFetchService` 管理。
18. 第一版不预设 `common/natureParser.ts` 或 Parser 基类。
19. 公共模型中不存在 `href`。
20. 增加同结构 Nature 子刊时，只需新增 `JournalDescriptor`。
21. 增加新出版商时，只需新增 Provider、Journal Descriptor 和 Contribution。
22. 旧模型、兼容路径、Facade 和 Re-export 全部删除。
23. 所有新增模型、Registry、Service 和 Parser 均有测试覆盖。

---

## 16. 最终命名定案

```text
对外服务
    IFetchService

服务实现
    FetchService

站点实现契约
    IFetchProvider

Nature 实现
    NatureFetchProvider

Nature 根页面解析
    NatureExploreContentParser

Nature 列表解析
    NatureArticleListParser
    NatureNewsOpinionListParser

Nature 详情解析
    NatureArticleDetailParser
    NatureNewsOpinionArticleDetailParser（仅在确有必要时）

静态期刊
    JournalDescriptor

单期刊动态数据
    JournalArticles

一级栏目
    ExploreContentItem

二级类型
    ArticleTypeItem

分页
    ArticlePage

列表文章
    ArticleSummary

文章详情
    ArticleDetail
```

最终主链路：

```text
JournalDescriptor.articlesUrl
          ↓
     IFetchService
          ↓
    IFetchProvider
          ↓
    JournalArticles
          ↓
ExploreContentItem
          ↓
  ArticleTypeItem
          ↓
     ArticlePage
          ↓
   ArticleSummary
          ↓
    ArticleDetail
```
