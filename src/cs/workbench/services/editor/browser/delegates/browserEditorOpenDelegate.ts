import {
  EMPTY_BROWSER_TAB_URL,
} from 'cs/workbench/browser/parts/editor/editorInput';
import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import type { EditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import {
  createUnhandledEditorOpenResult,
  type BrowserEditorNewTabOpenRequest,
  type BrowserEditorRevealOrOpenRequest,
  type EditorOpenOptions,
} from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { EditorOpenDelegate } from 'cs/workbench/services/editor/browser/editorOpenRegistry';
import type { IEditorResolverService } from 'cs/workbench/services/editor/common/editorResolverService';

type BrowserEditorOpenRequest =
  | BrowserEditorNewTabOpenRequest
  | BrowserEditorRevealOrOpenRequest;

type BrowserEditorOpenModel = Pick<
  EditorModel,
  'createBrowserTab' | 'getSnapshot'
>;

export function createBrowserEditorOpenDelegate(
  model: BrowserEditorOpenModel,
  editorResolverService: IEditorResolverService,
): EditorOpenDelegate<BrowserEditorOpenRequest> {
  const resolveBrowserEditor = (
    resource: BrowserEditorOpenRequest['resource'],
    options: EditorOpenOptions | undefined,
  ) => {
    const resolvedResource =
      resource ?? BrowserViewUri.forId(generateUuid());
    const resolved = editorResolverService.resolveEditor({
      resource: resolvedResource,
      options,
    });
    if (!resolved) {
      throw new Error(`No editor resolver registered for browser resource: ${resolvedResource.toString()}`);
    }

    void resolved.editor.resolve();

    const browserResource = resolved.editor.resource;
    const parsed = browserResource ? BrowserViewUri.parse(browserResource) : undefined;
    if (!parsed) {
      throw new Error(`Resolved browser editor returned an invalid resource: ${browserResource?.toString() ?? ''}`);
    }

    return {
      id: parsed.id,
      viewState: resolved.options?.viewState,
    };
  };

  return {
    canOpen(request): request is BrowserEditorOpenRequest {
      return request.kind === 'browser';
    },
    open(request) {
      switch (request.disposition) {
        case 'new-tab': {
          const resolved = resolveBrowserEditor(request.resource, request.options);
          const normalizedUrl = resolved.viewState?.url?.trim() ?? '';
          if (!normalizedUrl) {
            return createUnhandledEditorOpenResult();
          }

          model.createBrowserTab(normalizedUrl, {}, {
            id: resolved.id,
          });
          return {
            handled: true,
            activeTabId: model.getSnapshot().activeTabId,
          };
        }
        case 'reveal-or-open': {
          if (request.options?.viewState?.url === undefined) {
            const resolved = resolveBrowserEditor(undefined, {
              viewState: {
                url: EMPTY_BROWSER_TAB_URL,
              },
            });
            model.createBrowserTab(EMPTY_BROWSER_TAB_URL, {}, {
              id: resolved.id,
            });
            return {
              handled: true,
              activeTabId: model.getSnapshot().activeTabId,
            };
          }

          const resolved = resolveBrowserEditor(request.resource, request.options);
          const normalizedUrl = resolved.viewState?.url?.trim() ?? '';
          if (!normalizedUrl) {
            return createUnhandledEditorOpenResult();
          }

          model.createBrowserTab(normalizedUrl, {}, {
            id: resolved.id,
          });
          return {
            handled: true,
            activeTabId: model.getSnapshot().activeTabId,
          };
        }
      }
    },
  };
}
