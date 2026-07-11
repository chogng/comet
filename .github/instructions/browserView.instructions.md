---
description: Comet Studio 
applyTo: src/cs/platform/browserView/**
---

Agent requset
  └─ PlaywrightSession
      ├─ BrowserSession / browser context
      ├─ BrowserViewGroup
      │   ├─ BrowserView 1
      │   └─ BrowserView 2
      └─ CDP connection

BrowserSession：保存浏览器上下文、Cookie、页面等会话状态
BrowserViewGroup： decide which pages are exposed to this CDP/Playwright session
BrowserView：实际显示或承载网页的页面
PlaywrightSession：Agent 使用的自动化连接和生命周期封装

共享 IContextViewService 显示 Context View
    ↓
BrowserOverlayManager 发现 .context-view 与 BrowserView 重叠
    ↓
暂时隐藏原生 WebContentsView
    ↓
显示页面截图/DOM placeholder
    ↓
Context View 才能视觉上覆盖浏览器区域