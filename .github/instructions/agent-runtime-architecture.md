# Agent Runtime Architecture

This document defines the first-pass boundaries for agent integration in Literature Studio.

## Goal

Use an SDK as the model execution backend, but keep orchestration, editor patching, and tool contracts inside the product codebase.

That split avoids two common failures:

- coupling the whole app to one vendor SDK
- letting the model mutate the editor through raw text or DOM operations

## Proposed code layout

- `src/ls/agent/common/protocol.ts`
  - provider-agnostic message, tool, and adapter interfaces
- `src/ls/agent/common/runtime.ts`
  - minimal tool-calling run loop
- `src/ls/agent/common/editorTools.ts`
  - editor-specific tool ids and patch protocol
- future `src/ls/code/electron-main/agent/*`
  - provider adapters, RAG-backed tools, filesystem tools
- future `src/ls/workbench/browser/agent/*`
  - selection/context tools, patch review UI, patch application

## Boundary rules

1. Model adapters stay thin.
   They translate between a vendor SDK and `AgentProviderAdapter`.

2. Product tools stay first-party.
   Tool names, payloads, and safety rules are owned by this repository.

3. Editor writes are patch-based.
   Agent writes must target `blockId` and stable edit coordinates, not DOM ranges.

4. Renderer owns active editor state.
   Selection capture, draft context, patch preview, and final apply live in the browser/workbench side.

5. Main owns external side effects.
   Network retrieval, knowledge-base access, file exports, and model calls live in Electron main.

## Editor tool rules

The editor already exposes stable text units and `blockId`-based edit targets. Agent editing should build on that contract instead of replacing it.

Required constraints:

- no full-document overwrite as the default write path
- no HTML or DOM-based mutation tool
- no direct raw-string citation insertion when a structured citation node is available
- text edits can reuse `WritingEditorStableEditTarget`
- structured inserts such as citation and figure-reference insertion need dedicated operations

## Initial tool set

- `get_selection_context`
- `list_text_units`
- `apply_editor_patch`
- `insert_citation_from_articles`
- `retrieve_evidence`
- `open_article_source`

This is intentionally narrow. It is enough to support:

- explain selected text
- rewrite a paragraph
- ground a rewrite with evidence
- insert structured citations after review

## Integration order

1. Implement one provider adapter in main process.
2. Register read-only tools first.
3. Add patch proposal without auto-apply.
4. Add reviewed patch application in renderer.
5. Add structured insertion tools for citation and figure references.

## Non-goals for the first pass

- autonomous multi-agent orchestration
- background tool execution without user-visible review
- unrestricted file-system tools
- direct DOM automation inside the editor surface
