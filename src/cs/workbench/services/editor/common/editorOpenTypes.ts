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

export type BrowserEditorCurrentOpenRequest = {
  kind: 'browser';
  disposition: 'current';
  url: string;
  options?: {
    isLoading?: boolean;
  };
};

export type BrowserEditorNewTabOpenRequest = {
  kind: 'browser';
  disposition: 'new-tab';
  url: string;
};

export type BrowserEditorRevealOrOpenRequest = {
  kind: 'browser';
  disposition: 'reveal-or-open';
  url?: string;
};

export type PdfEditorOpenRequest = {
  kind: 'pdf';
  disposition: 'new-tab' | 'reveal-or-open';
  url?: string;
};

export type EditorOpenRequest =
  | DraftEditorOpenRequest
  | BrowserEditorCurrentOpenRequest
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
