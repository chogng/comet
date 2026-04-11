import type {
  ContextMenuDelegate,
  ContextMenuService as BaseContextMenuService,
} from 'ls/base/browser/contextmenu';
import { createPlatformContextMenuService } from 'ls/platform/contextview/browser/contextMenuService';
export type WorkbenchContextMenuDelegate = ContextMenuDelegate;
export type WorkbenchContextMenuService = BaseContextMenuService & {
  dispose: () => void;
};

export function createContextMenuService(): WorkbenchContextMenuService {
  return createPlatformContextMenuService();
}
