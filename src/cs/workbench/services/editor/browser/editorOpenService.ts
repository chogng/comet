import type { EditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import type { EditorOpenService } from 'cs/workbench/services/editor/common/editorOpenService';
import { createDraftEditorOpenDelegate } from 'cs/workbench/services/editor/browser/delegates/draftEditorOpenDelegate';
import { createBrowserEditorOpenDelegate } from 'cs/workbench/services/editor/browser/delegates/browserEditorOpenDelegate';
import { createPdfEditorOpenDelegate } from 'cs/workbench/services/editor/browser/delegates/pdfEditorOpenDelegate';
import { createEditorOpenRegistry } from 'cs/workbench/services/editor/browser/editorOpenRegistry';
import type { IEditorResolverService } from 'cs/workbench/services/editor/common/editorResolverService';

export function createEditorOpenService(
  model: EditorModel,
  editorResolverService: IEditorResolverService,
): EditorOpenService {
  return createEditorOpenRegistry([
    createDraftEditorOpenDelegate(model),
    createBrowserEditorOpenDelegate(model, editorResolverService),
    createPdfEditorOpenDelegate(model),
  ]);
}
