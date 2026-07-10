# Fetch architecture

本文描述 Fetch 的目标架构。现有 `FetchTarget*`、`targetMode` 和将 BrowserView UUID 命名为 `targetId` 的实现不符合该架构，需要迁移。

Fetch 使用 BrowserView 加载网页。已配置的 site policy 只决定 BrowserView 初始在后台运行，还是显式显示在 Browser editor 中；两条路径使用同一种 BrowserView 和页面提取逻辑。

```ts
type SiteFetchPresentation = 'background' | 'browserEditor';
```

```text
site policy
├─ browserEditor
│  ├─ provider 创建 BrowserView URI
│  ├─ 通知 renderer 显示该 resource
│  ├─ renderer 执行语义化 command
│  ├─ command open/reveal Browser editor 并确保 Editor Part 展开
│  ├─ Browser editor 根据 URI 创建 BrowserView 并加载网页
│  └─ main 等待页面就绪后提取内容
└─ background
   ├─ provider 创建 BrowserView URI
   ├─ main 根据 URI 创建隐藏 BrowserView 并加载网页
   ├─ main 等待页面就绪后提取内容
   └─ 未被显示时，fetch 完成后清理 BrowserView
```

## Site provider

Provider 应根据 source URL 和 site 配置解析 `SiteFetchPresentation`。调用方只提供 source 信息，不应先解析策略后再把结果原样传给 provider。

Provider 选择的是页面的初始呈现方式，不是 loader 或 CDP target。Fetch 层因此不应定义 `FetchTargetProvider`、`FetchTargetSession` 或 `targetMode` 这类概念。

`fetchSitesProvider.ts` 是 site 与 parser 的注册和解析边界。它先根据 URL 选中唯一的 site provider，然后只从该 provider 注册的 listing parsers 中选择匹配项。

```text
source URL
  → fetchSitesProvider
  → Nature / Science site provider
  → matching listing parser
  → shared listing fetch pipeline
```

`sites/` 保存站点知识，包括 hostname/path 匹配、listing parser、article parser 和 proof。通用 listing DOM 和 pagination helper 也位于该目录，但它们不自行注册 site，也不选择 provider。

Parser 不得跨 site 全局匹配。`preferredExtractorId` 只能在已命中的 site provider 内解析；未匹配的 URL 不得静默转交给其他站点的 parser。

`browserEditor` 路径由 renderer 负责 open/reveal Browser editor。Electron main 不直接操作 workbench editor，只发送带 BrowserView URI 和 page URL 的类型化请求，然后等待对应页面就绪。

`background` 路径不打开 Browser editor，但仍由 BrowserView 加载网页。这使后台 fetch 与显式 fetch 共享 Chromium 的 JavaScript、Cookie、导航和页面状态。

## Command and Editor integration

Fetch 通过 renderer 中的语义化 command 请求显示 BrowserView resource。Command 由 `Action2` 注册，并调用 typed editor service 修改 editor model 和 layout state；Editor Part 只消费这些状态，不依赖 Fetch。

```text
Fetch renderer state
  → semantic command registered by Action2
  → typed editor service
  → resolve/reuse BrowserEditorInput by BrowserView URI
  → activate Browser tab
  → ensure Editor Part is expanded
  → Editor components consume editor and layout state
```

不应订阅 command invocation。Command 表达一次性用户意图；渲染和布局订阅 editor model 与 layout state。Fetch 不得直接调用 `Action2.run()`，也不得从 Electron main 执行 renderer command。

Fetch 显式打开页面的 command 应完成一个原子语义：根据 URI open/reveal Browser tab，并确保 Editor Part 处于 expanded 状态。它不得通过通用 toggle command 间接实现；当 Editor 已经展开时，toggle 会将它收起。

通用 Editor toggle Action 仍只负责 collapsed/expanded 布局状态，不 import Fetch，也不解析 fetch resource。如果产品规则要求“后台 fetch 期间点击 Editor 展开入口时显示当前网页”，应由 renderer 的 Fetch contribution 或 workbench composition 层根据 context 将该 UI 入口路由到语义化 reveal command。Editor 源码仍只接收普通 `BrowserEditorInput`。

## Revealing an active background fetch

用户在后台 fetch 进行期间展开 editor 时，workbench 应使用该 fetch session 已有的 BrowserView URI open/reveal Browser editor，将同一个 BrowserView 从后台提升为 editor 呈现。

```text
active background fetch
  │ resource: BrowserView URI
  ▼
user expands editor
  ▼
open/reveal Browser editor with the same resource
  ▼
reuse the existing BrowserView and current page state
```

提升过程不应创建新 BrowserView，也不应重新导航。每个 fetch session 只发起一次页面导航；Browser editor 打开已存在的 resource 时应保留当前 URL、Cookie 和页面状态。

只有存在可显示的活跃 fetch session 时，展开 editor 才会 reveal fetch BrowserView。没有活跃 fetch 时，toggle editor 保持普通行为。存在多个并发 session 时，workbench 必须根据当前选中的 source 确定要 reveal 的 resource，不能任意选择一个 session。

## BrowserView ownership and lifecycle

- 始终在后台的 BrowserView 由 fetch session 管理，在 fetch 完成、失败或取消后清理。
- 一旦 BrowserView 被用户 reveal 到 Browser editor，其所有权转交给 editor；fetch 结束后不得销毁该 BrowserView。
- 用户在 fetch 进行期间关闭已 reveal 的 Browser editor 时，对应 fetch session 应结束为取消或明确失败，不得静默创建新的后台 BrowserView。

## BrowserView resource identity

Fetch 和 workbench 之间使用 BrowserView URI 识别 BrowserView。URI 可以在 BrowserView 实例尚未创建时生成；Browser editor 或后台 BrowserView service 根据该 resource 创建对应实例。

```text
Fetch
  │ resource: BrowserView URI
  ▼
Browser editor / BrowserView service
  │ browserViewId: URI 中的 UUID
  ▼
WebContentsView
```

`BrowserViewUri.getId(resource)` 返回的是 `browserViewId`，不是 `targetId`。Fetch status 和 editor open request 应传递 resource，不应把 URI 中的 UUID 另外暴露为 `targetId`。

## CDP boundary

CDP 的 target 是 Chromium 调试协议概念，只属于 BrowserView debugger、CDP proxy 和 CDP session attachment 等底层实现。真正的 CDP `targetId` 由 Chromium 为 WebContents 生成，与 BrowserView URI 中的 UUID 是两种不同的标识。

```text
BrowserView service
  │ browserViewId
  ▼
WebContentsView
  │ 底层内部绑定
  ▼
CDP adapter
  │ Chromium targetId
  ▼
CDP session
```

Fetch 代码不应 import CDP 类型、保存 CDP `targetId` 或根据 CDP target 状态选择 site 路径。BrowserView 层内部可以管理 `browserViewId → WebContentsView → CDP targetId` 的关联，但该关联不能穿透到 fetch 层。
