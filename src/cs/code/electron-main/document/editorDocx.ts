import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import type {
  EditorDocxExportResult,
  ExportEditorDocxPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'cs/base/common/errors';
import { normalizeWritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { buildEditorDocxBuffer, buildEditorDocxFileName } from 'cs/code/electron-main/document/editorDocxSerializer';
import { normalizeDocxPath } from 'cs/code/electron-main/document/docxPackage';
import { resolveDocxExportCopy, resolveDocxExportDialogCopy, resolveSupportedLocale } from 'cs/code/electron-main/document/docxCopy';
import { showSaveDialog } from 'cs/platform/dialogs/electron-main/dialogMainService';

export async function exportEditorDocx(
  payload: ExportEditorDocxPayload = {},
  defaultDownloadDir: string,
  window?: BrowserWindow | null,
): Promise<EditorDocxExportResult | null> {
  const locale = resolveSupportedLocale(payload.locale);
  const copy = resolveDocxExportCopy(locale);
  const title = String(payload.title ?? '').trim() || copy.untitled;
  const preferredDirectory =
    typeof payload.preferredDirectory === 'string' ? payload.preferredDirectory.trim() : '';
  const dialogCopy = resolveDocxExportDialogCopy(locale);
  const result = await showSaveDialog(
    {
      title: dialogCopy.title,
      buttonLabel: dialogCopy.buttonLabel,
      defaultPath: path.join(
        preferredDirectory || defaultDownloadDir,
        buildEditorDocxFileName({ title, locale }),
      ),
      filters: [
        {
          name: 'Word Document',
          extensions: ['docx'],
        },
      ],
      properties: ['showOverwriteConfirmation'],
    },
    window,
  );

  if (result.canceled || !result.filePath) {
    return null;
  }

  return exportEditorDocumentToDocxFile({
    document: normalizeWritingEditorDocument(payload.document),
    editorDraftStyle: payload.editorDraftStyle,
    title,
    filePath: result.filePath,
    locale,
  });
}

export async function exportEditorDocumentToDocxFile({
  document,
  title,
  filePath,
  locale,
  editorDraftStyle,
}: {
  document: ExportEditorDocxPayload['document'];
  editorDraftStyle?: ExportEditorDocxPayload['editorDraftStyle'];
  title: string;
  filePath: string;
  locale: ReturnType<typeof resolveSupportedLocale>;
}): Promise<EditorDocxExportResult> {
  const outputPath = normalizeDocxPath(filePath);

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, await buildEditorDocxBuffer({
      document: normalizeWritingEditorDocument(document),
      editorDraftStyle,
      title,
      locale,
    }));
  } catch (error) {
    throw appError('DOCX_EXPORT_FAILED', {
      filePath: outputPath,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    filePath: outputPath,
    title,
  };
}
