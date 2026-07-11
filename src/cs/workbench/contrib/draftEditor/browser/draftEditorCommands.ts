import type { InsertFigurePayload } from 'cs/editor/browser/text/commands';
import type { WritingEditorSurfaceHandle } from 'cs/editor/browser/text/editor';

export type DraftEditorCommandId =
  | 'insertCitation'
  | 'insertFigure'
  | 'insertFigureRef';

export type DraftEditorCommandLabels = {
  citationPrompt: string;
  figureUrlPrompt: string;
  figureCaptionPrompt: string;
  figureRefPrompt: string;
};

export type DraftEditorCommandContext = {
  editor: WritingEditorSurfaceHandle;
  labels: DraftEditorCommandLabels;
  prompt: (message: string, defaultValue: string) => Promise<string | null>;
};

function normalizePromptValue(value: string | null) {
  return value?.trim() ?? '';
}

async function executeInsertCitationCommand({
  editor,
  labels,
  prompt,
}: DraftEditorCommandContext) {
  const input = normalizePromptValue(
    await prompt(labels.citationPrompt, 'cite_1'),
  );
  if (!input) {
    return;
  }

  editor.insertCitation(input.split(/[,\s]+/).filter(Boolean));
}

async function executeInsertFigureCommand({
  editor,
  labels,
  prompt,
}: DraftEditorCommandContext) {
  const src = normalizePromptValue(
    await prompt(labels.figureUrlPrompt, 'https://'),
  );
  if (!src) {
    return;
  }

  const payload: InsertFigurePayload = {
    src,
    caption: normalizePromptValue(
      await prompt(labels.figureCaptionPrompt, ''),
    ),
  };
  editor.insertFigure(payload);
}

async function executeInsertFigureRefCommand({
  editor,
  labels,
  prompt,
}: DraftEditorCommandContext) {
  const availableFigureIds = editor.getAvailableFigureIds();
  const optionsHint =
    availableFigureIds.length > 0 ? ` (${availableFigureIds.join(', ')})` : '';
  const targetId = normalizePromptValue(
    await prompt(
      `${labels.figureRefPrompt}${optionsHint}`,
      availableFigureIds[0] ?? 'figure_1',
    ),
  );
  if (!targetId) {
    return;
  }

  editor.insertFigureRef(targetId);
}

export function executeDraftEditorCommand(
  commandId: DraftEditorCommandId,
  context: DraftEditorCommandContext,
) {
  switch (commandId) {
    case 'insertCitation':
      return executeInsertCitationCommand(context);
    case 'insertFigure':
      return executeInsertFigureCommand(context);
    case 'insertFigureRef':
      return executeInsertFigureRefCommand(context);
  }
}

export function createDraftEditorCommandAction(
  commandId: DraftEditorCommandId,
  getContext: () => DraftEditorCommandContext,
) {
  return () => {
    void executeDraftEditorCommand(commandId, getContext());
  };
}
