# Fetch sites

`sites/` 只保存出版平台知识：hostname、ArticleList Source、ArticleList Parser、ArticleDetail Parser、URL identity、Publication resolver 和 ArticleKind classifier。

每一层只回答一个问题：

```text
Site                 哪个出版平台？
ArticleListSource    哪个列表入口？
ArticleListParser    该列表 snapshot 如何提取 candidates？
ArticleIdentity      article URI 提供了哪些可靠 hints？
ArticleDetailParser  该详情 snapshot 属于哪套页面载体？
Publication          文章属于哪个刊物？
ArticleKind          文章在语义上是什么类型？
```

## Rules

- Site、Source、list parser 和 detail parser 均由严格 resolver 选择；不得 `.find()` 后静默使用第一个结果。
- Source 只按 URI 识别入口，并拥有 pagination/enrichment policy；Source 不解析文章卡片。
- List parser 只消费 DOM snapshot、返回结构 proof 并提取 candidates；不得发网络请求或抓取详情。
- Detail parser 只消费 DOM snapshot；不得创建 BrowserView、操作 WebContents、打开 Editor 或执行 CDP。
- Publication 不决定 parser，ArticleKind 也不决定 parser。
- 不匹配稳定结构时明确失败；不得使用全页 anchor scan 或 targeted-to-generic fallback。
- 新 parser 必须有 fixture 证明其结构边界，不能为尚未观察到的页面预先注册猜测规则。

## Nature

Nature URL identity 将 `/articles/s*` 标记为 journal family，将 `/articles/d*` 标记为 editorial family，并可提供 DOI 与 Publication hint。当前二者由同一个 `nature.article.v1` parser 处理；page-family 只是 parser 内的显式抽取策略，不参与 ArticleKind 推断。Hint 不能覆盖冲突的页面强证据。

多个 research/reviews 列表 Source 可以复用 `nature.journalArchiveList.v1`；Latest News 与 Opinion Source 可以复用 `nature.editorialFeedList.v1`。列表入口与详情页面族没有一一绑定关系。
