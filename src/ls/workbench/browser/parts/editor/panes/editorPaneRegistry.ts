import type {
  EditorWorkspaceBrowserTab,
  EditorWorkspaceDraftTab,
  EditorWorkspacePdfTab,
  EditorWorkspaceTab,
  WritingEditorDocument,
} from 'ls/workbench/browser/parts/editor/editorModel';
import {
  PLANNED_EDITOR_PANE_MODES,
  type EditorFuturePaneMode,
  type SupportedEditorPaneMode,
  getEditorPaneMode,
} from 'ls/workbench/browser/parts/editor/editorInput';
import type { DraftEditorStatusState } from 'ls/editor/browser/text/draftEditorStatusState';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import type { EditorOpenHandler } from 'ls/workbench/services/editor/common/editorOpenTypes';
import { ContentEditorPane } from 'ls/workbench/browser/parts/editor/panes/contentEditorPane';
import type { ContentEditorPaneProps } from 'ls/workbench/browser/parts/editor/panes/contentEditorPane';
import { DraftEditorPane } from 'ls/workbench/browser/parts/editor/panes/draftEditorPane';
import type {
  AnyEditorPane,
  EditorPaneDescriptor,
  EditorPaneResolution,
  EditorPane,
} from 'ls/workbench/browser/parts/editor/panes/editorPane';
import type { DraftEditorPaneProps } from 'ls/workbench/browser/parts/editor/panes/draftEditorPane';
import { PdfEditorPane } from 'ls/workbench/browser/parts/editor/panes/pdfEditorPane';
import type { PdfEditorPaneProps } from 'ls/workbench/browser/parts/editor/panes/pdfEditorPane';

export type EditorPaneResolverContext = {
  labels: EditorPartLabels;
  viewPartProps: ViewPartProps;
  onOpenEditor?: EditorOpenHandler;
  onDraftDocumentChange: (value: WritingEditorDocument) => void;
  onDraftStatusChange: (tabId: string, status: DraftEditorStatusState) => void;
};

export type EditorPaneId = SupportedEditorPaneMode;
export type PlannedEditorPaneId = EditorFuturePaneMode;

export const PLANNED_EDITOR_PANE_IDS = PLANNED_EDITOR_PANE_MODES;

export type ResolvedEditorPane = {
} & EditorPaneResolution<AnyEditorPane, EditorPaneId>;

type EditorPaneRegistryDescriptor<
  TInput extends EditorWorkspaceTab,
  TProps,
  TPane extends EditorPane<TProps, any>,
  TPaneId extends EditorPaneId,
> = EditorPaneDescriptor<
  EditorWorkspaceTab,
  TInput,
  EditorPaneResolverContext,
  TPane,
  TPaneId
>;

type EditorPaneDescriptorOptions<
  TInput extends EditorWorkspaceTab,
  TProps,
  TPane extends EditorPane<TProps, any>,
  TPaneId extends EditorPaneId,
> = {
  paneId: TPaneId;
  contentClassNames: readonly string[];
  acceptsInput: (input: EditorWorkspaceTab) => input is TInput;
  createPaneKey: (input: TInput) => string;
  createPaneProps: (input: TInput, context: EditorPaneResolverContext) => TProps;
  createPane: (props: TProps) => TPane;
};

type AnyEditorPaneRegistryDescriptor = EditorPaneRegistryDescriptor<
  any,
  any,
  AnyEditorPane,
  EditorPaneId
>;

function createEditorPaneDescriptor<
  TInput extends EditorWorkspaceTab,
  TProps,
  TPane extends EditorPane<TProps, any>,
  TPaneId extends EditorPaneId,
>(
  options: EditorPaneDescriptorOptions<TInput, TProps, TPane, TPaneId>,
): EditorPaneRegistryDescriptor<TInput, TProps, TPane, TPaneId> {
  return {
    paneId: options.paneId,
    acceptsInput: options.acceptsInput,
    resolvePane: (input, context) => {
      const paneProps = options.createPaneProps(input, context);
      return {
        paneId: options.paneId,
        paneKey: options.createPaneKey(input),
        contentClassNames: options.contentClassNames,
        createPane: () => options.createPane(paneProps),
        updatePane: (pane) => {
          pane.setProps(paneProps);
        },
      };
    },
  };
}

function createDraftPaneProps(
  tab: EditorWorkspaceDraftTab,
  context: EditorPaneResolverContext,
): DraftEditorPaneProps {
  return {
    labels: context.labels,
    draftTab: tab,
    onDraftDocumentChange: context.onDraftDocumentChange,
    onStatusChange: (status: DraftEditorStatusState) =>
      context.onDraftStatusChange(tab.id, status),
  };
}

function createContentPaneProps(
  tab: EditorWorkspaceBrowserTab | EditorWorkspacePdfTab,
  context: EditorPaneResolverContext,
): ContentEditorPaneProps {
  return {
    labels: context.labels,
    contentTab: tab,
    viewPartProps: context.viewPartProps,
  };
}

function createPdfPaneProps(
  tab: EditorWorkspacePdfTab,
  context: EditorPaneResolverContext,
): PdfEditorPaneProps {
  return {
    labels: context.labels,
    pdfTab: tab,
    viewPartProps: context.viewPartProps,
    onOpenEditor: context.onOpenEditor,
  };
}

function isDraftWorkspaceTab(
  input: EditorWorkspaceTab,
): input is EditorWorkspaceDraftTab {
  return getEditorPaneMode(input) === 'draft';
}

function isBrowserWorkspaceTab(
  input: EditorWorkspaceTab,
): input is EditorWorkspaceBrowserTab {
  return getEditorPaneMode(input) === 'browser';
}

function isPdfWorkspaceTab(
  input: EditorWorkspaceTab,
): input is EditorWorkspacePdfTab {
  return getEditorPaneMode(input) === 'pdf';
}

const draftEditorPaneDescriptor = createEditorPaneDescriptor({
  paneId: 'draft',
  contentClassNames: ['is-mode-draft'] as const,
  acceptsInput: isDraftWorkspaceTab,
  createPaneKey: (tab) => `draft:${tab.id}`,
  createPaneProps: createDraftPaneProps,
  createPane: (props) => new DraftEditorPane(props),
});

const browserEditorPaneDescriptor = createEditorPaneDescriptor({
  paneId: 'browser',
  contentClassNames: ['is-mode-browser'] as const,
  acceptsInput: isBrowserWorkspaceTab,
  // Browser tabs share one native web-content surface, so the pane itself
  // should stay mounted while only the active target changes.
  createPaneKey: () => 'browser',
  createPaneProps: createContentPaneProps,
  createPane: (props) => new ContentEditorPane(props),
});

const pdfEditorPaneDescriptor = createEditorPaneDescriptor({
  paneId: 'pdf',
  contentClassNames: ['is-mode-pdf'] as const,
  acceptsInput: isPdfWorkspaceTab,
  createPaneKey: (tab) => `pdf:${tab.id}`,
  createPaneProps: createPdfPaneProps,
  createPane: (props) => new PdfEditorPane(props),
});

export const editorPaneDescriptors = [
  draftEditorPaneDescriptor,
  browserEditorPaneDescriptor,
  pdfEditorPaneDescriptor,
] as const;

export function resolveEditorPane(
  activeTab: EditorWorkspaceTab,
  context: EditorPaneResolverContext,
): ResolvedEditorPane {
  for (const descriptor of editorPaneDescriptors as unknown as readonly AnyEditorPaneRegistryDescriptor[]) {
    if (!descriptor.acceptsInput(activeTab)) {
      continue;
    }

    const resolvedPane = descriptor.resolvePane(activeTab, context);
    if (resolvedPane) {
      return resolvedPane;
    }
  }

  throw new Error(
    `No editor pane descriptor found for input pane mode "${getEditorPaneMode(activeTab)}"`,
  );
}
