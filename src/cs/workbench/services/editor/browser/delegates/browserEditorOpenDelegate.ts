import {
  EMPTY_BROWSER_TAB_URL,
  isEditorDraftTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { isReusableEmptyBrowserTab } from 'cs/workbench/browser/parts/editor/editorTabPolicy';
import type { EditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import {
  createUnhandledEditorOpenResult,
  type BrowserEditorCurrentOpenRequest,
  type BrowserEditorNewTabOpenRequest,
  type BrowserEditorRevealOrOpenRequest,
  type EditorOpenOptions,
} from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { EditorOpenDelegate } from 'cs/workbench/services/editor/browser/editorOpenRegistry';
import type { IEditorResolverService } from 'cs/workbench/services/editor/common/editorResolverService';

type BrowserEditorOpenRequest =
  | BrowserEditorCurrentOpenRequest
  | BrowserEditorNewTabOpenRequest
  | BrowserEditorRevealOrOpenRequest;

type BrowserEditorOpenModel = Pick<
  EditorModel,
  'activateTab' | 'createBrowserTab' | 'getSnapshot'
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
        case 'current': {
          const { activeTab, activeTabId } = model.getSnapshot();
          if (!activeTab || isEditorDraftTabInput(activeTab) || activeTab.kind !== 'browser') {
            return createUnhandledEditorOpenResult();
          }

          const resolvedUrl = request.options?.viewState?.url?.trim();
          if (!resolvedUrl) {
            return createUnhandledEditorOpenResult();
          }

          const resolved = editorResolverService.resolveEditor({
            resource: BrowserViewUri.forId(activeTab.id),
            options: {
              viewState: {
                url: activeTab.url,
                title: activeTab.title,
                favicon: activeTab.faviconUrl,
              },
            },
          });
          if (!(resolved?.editor instanceof BrowserEditorInput)) {
            throw new Error(`Active Browser tab '${activeTab.id}' did not resolve to a BrowserEditorInput.`);
          }
          resolved.editor.navigate(resolvedUrl);
          return {
            handled: true,
            activeTabId,
          };
        }
        case 'new-tab': {
          const resolved = resolveBrowserEditor(request.resource, request.options);
          const normalizedUrl = resolved.viewState?.url?.trim() ?? '';
          if (!normalizedUrl) {
            return createUnhandledEditorOpenResult();
          }

          model.createBrowserTab(normalizedUrl, {}, {
            id: resolved.id,
            reuseExisting: false,
          });
          return {
            handled: true,
            activeTabId: model.getSnapshot().activeTabId,
          };
        }
        case 'reveal-or-open': {
          if (request.options?.viewState?.url === undefined) {
            const { activeTab, tabs } = model.getSnapshot();
            const existingEmptyBrowserTab = isReusableEmptyBrowserTab(activeTab)
              ? activeTab
              : tabs.find((tab) => isReusableEmptyBrowserTab(tab)) ?? null;
            if (existingEmptyBrowserTab) {
              model.activateTab(existingEmptyBrowserTab.id);
              return {
                handled: true,
                activeTabId: existingEmptyBrowserTab.id,
              };
            }

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
