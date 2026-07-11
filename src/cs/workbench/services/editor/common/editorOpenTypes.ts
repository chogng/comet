import { URI } from 'cs/base/common/uri';

export type EditorOpenDisposition =
  | 'current'
  | 'new-tab'
  | 'reveal-or-open';

export type EditorOpenResult = {
  handled: boolean;
  activeTabId: string | null;
};

export type DraftEditorOpenRequest = {
  kind: 'draft';
  disposition: 'new-tab' | 'reveal-or-open';
};

export type EditorOpenUrlViewState = {
  url?: string;
};

export type EditorOpenOptions = {
  viewState?: EditorOpenUrlViewState;
};

export type EditorOpenOptionsWithUrl = EditorOpenOptions & {
  viewState: EditorOpenUrlViewState & {
    url: string;
  };
};

export type BrowserEditorNewTabOpenRequest = {
  kind: 'browser';
  disposition: 'new-tab';
  resource: URI;
  options: EditorOpenOptionsWithUrl;
};

export type BrowserEditorRevealOrOpenRequest = {
  kind: 'browser';
  disposition: 'reveal-or-open';
  resource?: URI;
  options?: EditorOpenOptions;
};

export type PdfEditorOpenRequest = {
  kind: 'pdf';
  disposition: 'new-tab' | 'reveal-or-open';
  resource?: URI;
  options?: EditorOpenOptions;
};

export type EditorOpenRequest =
  | DraftEditorOpenRequest
  | BrowserEditorNewTabOpenRequest
  | BrowserEditorRevealOrOpenRequest
  | PdfEditorOpenRequest;

export type EditorOpenHandler = (
  request: EditorOpenRequest,
) => EditorOpenResult | Promise<EditorOpenResult> | void | Promise<void>;

export function createUnhandledEditorOpenResult(): EditorOpenResult {
  return {
    handled: false,
    activeTabId: null,
  };
}
