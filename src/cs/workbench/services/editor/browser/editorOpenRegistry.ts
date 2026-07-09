import type { EditorOpenService } from 'cs/workbench/services/editor/common/editorOpenService';
import {
  createUnhandledEditorOpenResult,
  type EditorOpenRequest,
  type EditorOpenResult,
} from 'cs/workbench/services/editor/common/editorOpenTypes';

export interface EditorOpenDelegate<
  TRequest extends EditorOpenRequest = EditorOpenRequest,
> {
  canOpen(request: EditorOpenRequest): request is TRequest;
  open(request: TRequest): EditorOpenResult;
}

export type AnyEditorOpenDelegate = EditorOpenDelegate<EditorOpenRequest>;

export function createEditorOpenRegistry(
  delegates: readonly AnyEditorOpenDelegate[],
): EditorOpenService {
  return {
    open(request) {
      for (const delegate of delegates) {
        if (!delegate.canOpen(request)) {
          continue;
        }

        return delegate.open(request);
      }

      return createUnhandledEditorOpenResult();
    },
  };
}
