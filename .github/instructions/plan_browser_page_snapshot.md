# Plan：Integrated Browser Page Snapshot

## 0. 结论

页面 Snapshot 是 Integrated Browser 的平台能力，不属于 Article Fetch 私有实现。

本方案基于上游已有链路扩展：

~~~text
BrowserView
    ↓ CDP
Playwright Page
    ↓
IPlaywrightService
├── getSummary()          已有 ARIA Snapshot
├── invokeFunctionRaw()   已有原始 Page 操作
└── captureSnapshot()     新增类型化 HTML Snapshot
~~~

不在 IBrowserViewService 上平行创建另一套 DOM Snapshot API。

Article Fetch、页面归档和其他结构化读取功能通过 IPlaywrightService.captureSnapshot() 复用同一个页面跟踪、Session、网络策略和生命周期边界。

---

## 1. 上游基线

上游已有以下能力：

1. IPlaywrightService 通过 sessionId 和 pageId 操作 Integrated Browser Page。
2. startTrackingPage() 将现有 BrowserView 加入 Playwright 页面组。
3. openPage() 创建页面、等待 domcontentloaded，并返回 pageId 与初始 summary。
4. getSummary() 返回当前页面的 ARIA Snapshot。
5. invokeFunctionRaw() 在受管 Playwright Page 上执行原始函数并返回结构化结果。
6. PlaywrightTab.safeRunAgainstPage() 处理页面策略、Dialog 和操作生命周期。
7. read_page 工具直接使用 getSummary()。

getSummary() 的 Snapshot 面向 Agent 阅读和交互，不是 Publisher Parser 所需的完整 HTML。

ARIA Snapshot 可能不包含：

~~~text
data-* 属性
canonical link
JSON-LD
隐藏内容
精确 DOM 嵌套
CSS class
非可访问节点
Publisher 布局识别标记
~~~

因此保留 getSummary() 原有行为，并新增结构化 HTML Snapshot。

上游参考文件：

~~~text
/Users/lance/Desktop/vscode/src/vs/platform/browserView/common/playwrightService.ts
/Users/lance/Desktop/vscode/src/vs/platform/browserView/node/playwrightService.ts
/Users/lance/Desktop/vscode/src/vs/platform/browserView/node/playwrightTab.ts
/Users/lance/Desktop/vscode/src/vs/workbench/contrib/browserView/electron-browser/tools/readBrowserTool.ts
~~~

---

## 2. 目标

1. 从已跟踪的 Integrated Browser Page 获取完整 main-frame HTML。
2. URL、title 和 HTML 在同一次 Page evaluate 中取得。
3. 导航期间不返回混合页面数据。
4. 导航失败后不读取旧页面内容。
5. 支持 Publisher 提供通用 readiness selector。
6. 支持 CancellationToken。
7. 复用 IPlaywrightService 的 Session、Page tracking 和 network policy。
8. 保持 getSummary() 的 ARIA Snapshot 契约不变。
9. 不向调用方暴露 Playwright Page。
10. 不执行从 Snapshot 重新解析出的 script。
11. 不增加默认读取方式或失败 fallback。

第一版只支持 main frame。iframe、Shadow DOM 展开和资源内联必须单独设计。

---

## 3. 非目标

本次不实现：

~~~text
Publisher 识别
Article Parser
文章状态与缓存
跨 frame DOM 合并
截图
PDF
页面持久化
页面 diff
自动重试
导航失败后的旧内容复用
~~~

---

## 4. 公共契约

~~~ts
export interface IBrowserPageSnapshot {
	readonly pageId: string;
	readonly uri: URI;
	readonly title: string;
	readonly html: string;
	readonly capturedAt: number;
}

export interface IPageSnapshotReadiness {
	readonly selector: string;
	readonly state?: 'attached' | 'visible';
	readonly minimumCount?: number;
}

export interface IPageSnapshotOptions {
	readonly readiness?: IPageSnapshotReadiness;
	readonly timeoutMs?: number;
	readonly maximumBytes?: number;
}
~~~

IPlaywrightService 增加：

~~~ts
captureSnapshot(
	sessionId: string,
	pageId: string,
	options: IPageSnapshotOptions | undefined,
	token: CancellationToken
): Promise<IBrowserPageSnapshot>;
~~~

规则：

1. pageId 使用现有 BrowserView page identity。
2. sessionId 使用现有 Playwright session routing。
3. captureSnapshot 不负责导航。
4. 调用方必须先通过 openPage、现有 BrowserView 导航或 PageSession 完成目标页面加载。
5. readiness 是通用 DOM 条件，不包含 Publisher 枚举。
6. maximumBytes 使用统一安全默认值；调用方只能降低限制，不能无限扩大。

---

## 5. 为什么不增加 navigationId

第一版不创建 navigationId、pageVersion 或 documentVersion 公共协议。

Playwright evaluate 具有 document execution context：

~~~text
evaluate 前完成导航
    → 返回新页面的 URI、title 和 HTML

evaluate 期间发生跨文档导航
    → execution context destroyed
    → captureSnapshot 明确失败

evaluate 完成后发生导航
    → 已返回的 Snapshot 仍是有效的时间点数据
~~~

URL、title 和 HTML 必须在同一个 page.evaluate() 中读取：

~~~ts
await page.evaluate(() => ({
	uri: globalThis.location.href,
	title: globalThis.document.title,
	html: globalThis.document.documentElement?.outerHTML
}));
~~~

不得分别调用：

~~~text
page.url()
page.title()
page.content()
~~~

再拼接结果。分步读取会扩大导航竞争窗口。

只有 Fixture 和并发测试证明 Playwright execution context 仍不足以防止错误页面关联时，才重新评估 document version 协议。

---

## 6. Readiness

captureSnapshot 不把 network idle 作为唯一成功条件。许多页面持续存在 Analytics、广告或轮询请求，network idle 可能永远不成立。

基础顺序：

~~~text
resolve tracked Page
    ↓
检查 CancellationToken
    ↓
等待 main frame 至少达到 domcontentloaded
    ↓
等待 readiness selector
    ↓
等待下一次渲染机会
    ↓
原子 evaluate Snapshot
~~~

Readiness 示例：

~~~ts
{
	selector: 'main article',
	state: 'attached',
	minimumCount: 1
}
~~~

readiness selector 由上层 PageSession 或 Provider 提供，但 IPlaywrightService 只理解通用 DOM 条件。

如果没有 readiness：

1. 页面仍必须达到 domcontentloaded。
2. Snapshot 可以立即抓取。
3. 调用方承担页面内容尚未满足领域 admission 的责任。

禁止：

~~~text
selector 超时后继续抓取
visible 失败后改用 attached
readiness 失败后返回 ARIA Snapshot
readiness 失败后返回旧 HTML
~~~

---

## 7. Navigation 与旧页面保护

captureSnapshot 不导航，因此导航成功与否由调用它的 PageSession 保证。

正确链路：

~~~text
PageSession.navigate(targetUri)
    ↓
导航 Promise 成功
    ↓
IPlaywrightService.captureSnapshot()
    ↓
Snapshot URI admission
    ↓
领域 Parser
~~~

错误链路：

~~~text
PageSession.navigate(targetUri)
    ↓
导航 Promise 失败
    ↓
禁止 captureSnapshot
~~~

即使 BrowserView 中仍显示旧页面，也不能在导航失败后读取它。

captureSnapshot 返回后，上层必须验证：

~~~text
snapshot.uri
target URI
redirect policy
Publisher admission
~~~

URI 不满足目标时明确失败，不自动重新导航或重试。

---

## 8. 实现边界

IPlaywrightService.captureSnapshot() 复用现有内部路径：

~~~text
PlaywrightService
    ↓ _getOrCreateSession()
PlaywrightSession
    ↓ _getPage()
PlaywrightTab
    ↓ safeRunAgainstPage()
Playwright Page
    ↓ waitForLoadState / locator wait
page.evaluate()
~~~

不允许：

~~~text
调用方直接取得 Playwright Page
Publisher Provider 发送任意 fnDef
在 IBrowserViewService 中重复实现相同能力
新建 Fetch 私有 Playwright Facade
通过 Event 请求 Snapshot
~~~

invokeFunctionRaw() 仍保留为通用 Agent/Tool 能力。Article Fetch 使用类型化 captureSnapshot()，不直接拼接函数源码。

---

## 9. Cancellation

captureSnapshot 的所有等待阶段都检查 CancellationToken：

~~~text
Page resolve
load state wait
readiness wait
next render wait
evaluate 前
evaluate 后
结果大小验证前
~~~

如果底层 Playwright evaluate 无法物理中止：

1. 取消后不再返回结果。
2. evaluate 完成后再次检查 token。
3. 被取消结果不得进入任何调用方状态。
4. 不关闭用户拥有的 BrowserView。

---

## 10. Error Types

使用明确错误，不用 undefined 表示失败：

~~~text
BrowserPageNotTrackedError
BrowserPageClosedError
BrowserPageReadinessTimeoutError
BrowserPageNavigationInterruptedError
BrowserPageSnapshotEmptyError
BrowserPageSnapshotTooLargeError
BrowserPageSnapshotCancelledError
~~~

规则：

1. documentElement 不存在时返回 EmptyError。
2. execution context destroyed 映射为 NavigationInterruptedError。
3. Page 关闭或 Browser 断开映射为 ClosedError。
4. readiness 超时保留 selector 和 timeout 信息。
5. 错误消息不得包含完整 HTML。

---

## 11. Security

1. 继续使用 IPlaywrightService 已有 network policy。
2. Snapshot 只对已经 tracked 的 Page 开放。
3. 不把 HTML 写入普通日志。
4. 日志只记录 pageId、URI、字符数、耗时和错误类型。
5. maximumBytes 在返回 IPC 前验证。
6. detached DOM Parser 不执行 script。
7. Snapshot 可以包含 JSON-LD script 文本，但不能执行。
8. 调用方不得把完整 HTML 直接发送到遥测。

---

## 12. 文件范围

Comet 当前已有公共接口：

~~~text
src/cs/platform/browserView/common/playwrightService.ts
~~~

需要对齐或移植上游运行时实现：

~~~text
src/vs/platform/browserView/node/playwrightService.ts
src/vs/platform/browserView/node/playwrightTab.ts
~~~

最终修改范围以当前入口点和进程注册为准，应包括：

~~~text
common contract
node implementation
PlaywrightTab implementation
remote/IPC registration
unit tests
~~~

不要只修改 common interface 而遗漏运行时实现和服务注册。

---

## 13. 实施步骤

### Step 0：验证现有 Playwright runtime

确认 Comet 当前如何注册 IPlaywrightService，以及是否完整包含上游 PlaywrightService、PlaywrightSession 和 PlaywrightTab。

### Step 1：补齐上游基线

若 Comet 缺少上游运行时文件，直接对齐当前上游实现，不创建替代 Service 或兼容包装。

### Step 2：增加公共 Snapshot 类型

新增 IBrowserPageSnapshot、IPageSnapshotOptions 和 IPageSnapshotReadiness。

### Step 3：实现 captureSnapshot

在 PlaywrightSession/PlaywrightTab 正常页面操作边界中实现 readiness、原子 evaluate、大小限制和错误映射。

### Step 4：接入 CancellationToken

贯穿 common contract、远程调用和 node implementation。

### Step 5：增加测试

覆盖静态页面、动态页面、导航竞争、取消、关闭、超时、大小限制和旧页面保护。

### Step 6：接入第一个调用方

Article Fetch PageSession 作为第一个类型化调用方。调用方只接收 IBrowserPageSnapshot，不接收 Playwright Page。

---

## 14. 测试计划

验证：

1. 已 tracked Page 可以返回 HTML Snapshot。
2. 未 tracked Page 明确失败。
3. URI、title 和 HTML 来自同一次 evaluate。
4. main frame navigation 期间 evaluate 失败。
5. 导航完成后返回新页面 Snapshot。
6. navigation Promise 失败后 PageSession 不调用 captureSnapshot。
7. readiness selector 出现后成功。
8. readiness selector 超时明确失败。
9. minimumCount 生效。
10. CancellationToken 在等待期间终止操作。
11. 取消后的 evaluate 结果不返回。
12. Page 关闭时明确失败。
13. Browser 断开时明确失败。
14. 空 documentElement 明确失败。
15. 超过 maximumBytes 明确失败。
16. HTML 不写入日志或遥测。
17. getSummary() 继续返回 ARIA Snapshot。
18. invokeFunctionRaw() 行为不变。
19. read_page 行为不变。

---

## 15. 验收条件

1. Snapshot 能力位于 IPlaywrightService。
2. 不在 IBrowserViewService 创建平行 Snapshot API。
3. getSummary() 的 ARIA Snapshot 行为不变。
4. captureSnapshot() 返回类型化完整 HTML。
5. URL、title 和 HTML 原子读取。
6. 第一版不存在 navigationId/pageVersion 公共协议。
7. navigation 中断明确失败。
8. navigation 失败后不读取旧页面。
9. readiness 失败后不返回任何 Snapshot。
10. 所有等待支持 CancellationToken。
11. 调用方不能取得 Playwright Page。
12. Publisher Provider 不使用 invokeFunctionRaw() 拼接源码。
13. 不存在读取 fallback。
14. 不存在自动重试。
15. 页面关闭、取消、超时和大小限制均有测试。
16. Article Fetch 只依赖 IBrowserPageSnapshot 契约。

---

## 16. 最终链路

~~~text
BrowserView
    ↓ tracked by pageId
IPlaywrightService
    ↓
PlaywrightSession
    ↓
PlaywrightTab.safeRunAgainstPage()
    ↓
readiness
    ↓
atomic page.evaluate()
    ↓
IBrowserPageSnapshot
    ↓
typed consumers
├── Article Fetch
├── Page Archive
└── future structured readers
~~~
