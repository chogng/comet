import type {
  EditorOpenRequest,
  EditorOpenResult,
} from 'cs/workbench/services/editor/common/editorOpenTypes';

export interface EditorOpenService {
  open(request: EditorOpenRequest): EditorOpenResult;
}
