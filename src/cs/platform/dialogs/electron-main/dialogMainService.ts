import { dialog } from 'electron';
import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from 'electron';

function toDialogWindow(window?: BrowserWindow | null) {
  if (!window || window.isDestroyed()) {
    return undefined;
  }

  return window;
}

export function showOpenDialog(options: OpenDialogOptions, window?: BrowserWindow | null) {
  const targetWindow = toDialogWindow(window);
  if (targetWindow) {
    return dialog.showOpenDialog(targetWindow, options);
  }

  return dialog.showOpenDialog(options);
}

export function showSaveDialog(options: SaveDialogOptions, window?: BrowserWindow | null) {
  const targetWindow = toDialogWindow(window);
  if (targetWindow) {
    return dialog.showSaveDialog(targetWindow, options);
  }

  return dialog.showSaveDialog(options);
}

export async function pickDirectoryDialog(window?: BrowserWindow | null) {
  const result = await showOpenDialog(
    {
      properties: ['openDirectory', 'createDirectory'],
    },
    window,
  );

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

export async function pickUserSettingsFileDialog(
  window?: BrowserWindow | null,
  defaultPath?: string,
) {
  const result = await showSaveDialog(
    {
      defaultPath,
      filters: [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ],
    },
    window,
  );

  if (result.canceled || !result.filePath) {
    return null;
  }

  return result.filePath;
}

export async function pickPdfFileDialog(window?: BrowserWindow | null) {
  const result = await showOpenDialog(
    {
      properties: ['openFile'],
      filters: [
        {
          name: 'PDF',
          extensions: ['pdf'],
        },
      ],
    },
    window,
  );

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}
