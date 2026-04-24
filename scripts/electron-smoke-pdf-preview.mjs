import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { app, BrowserWindow } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const builtMainEntry = path.join(projectRoot, 'dist-electron', 'code', 'electron-main', 'main.js');
const builtWorkbenchEntry = path.join(
  projectRoot,
  'dist',
  'src',
  'ls',
  'code',
  'electron-sandbox',
  'workbench',
  'workbench.html',
);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ls-electron-pdf-smoke-'));
const portableRoot = path.join(tempRoot, 'portable-root');
const inputPdfPath = process.argv[2]?.trim();
const pdfPath = inputPdfPath
  ? path.resolve(inputPdfPath)
  : path.join(tempRoot, 'PDF Preview Smoke.pdf');

process.env.PORTABLE_EXECUTABLE_DIR = portableRoot;
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.LS_RENDERER_DEBUG;

let cleanedUp = false;
let lastDiagnostics = null;
let lastConsoleMessages = [];

function logStep(message, details) {
  if (details === undefined) {
    console.log(`[pdf-smoke] ${message}`);
    return;
  }

  console.log(`[pdf-smoke] ${message}`, JSON.stringify(details, null, 2));
}

async function cleanupTempRoot() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}

function createSimplePdfBuffer() {
  const encoder = new TextEncoder();
  const chunks = ['%PDF-1.7\n'];
  const offsets = [0];

  const addObject = (id, body) => {
    offsets[id] = encoder.encode(chunks.join('')).byteLength;
    chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(
    3,
    [
      '<< /Type /Page /Parent 2 0 R',
      '/MediaBox [0 0 300 200]',
      '/Resources << /Font << /F1 5 0 R >> >>',
      '/Contents 4 0 R >>',
    ].join(' '),
  );
  const stream = 'BT /F1 16 Tf 48 112 Td (Literature Studio PDF smoke) Tj ET';
  addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefOffset = encoder.encode(chunks.join('')).byteLength;
  chunks.push('xref\n');
  chunks.push('0 6\n');
  chunks.push('0000000000 65535 f \n');
  for (let id = 1; id <= 5; id += 1) {
    chunks.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push('trailer\n');
  chunks.push('<< /Size 6 /Root 1 0 R >>\n');
  chunks.push('startxref\n');
  chunks.push(`${xrefOffset}\n`);
  chunks.push('%%EOF\n');

  return Buffer.from(chunks.join(''), 'utf8');
}

function createSeedWorkspace(pdfUrl) {
  return {
    groups: [
      {
        groupId: 'editor-group-a',
        inputs: [
          {
            id: 'pdf-smoke-a',
            kind: 'pdf',
            title: 'PDF Smoke',
            url: pdfUrl,
          },
        ],
        activeTabId: 'pdf-smoke-a',
        mruTabIds: ['pdf-smoke-a'],
      },
    ],
    activeGroupId: 'editor-group-a',
    draftStateByInputId: {},
    viewStateEntries: [],
  };
}

async function waitForCondition(description, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const stepMs = options.stepMs ?? 100;
  const startedAt = Date.now();
  let lastValue;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await predicate();
    if (lastValue) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  throw new Error(
    `Timed out while waiting for ${description}.${lastValue === undefined ? '' : ` Last value: ${JSON.stringify(lastValue)}`}`,
  );
}

async function waitForMainWindow() {
  return await waitForCondition(
    'main window',
    async () => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null,
    { timeoutMs: 20000, stepMs: 100 },
  );
}

async function waitForDidFinishLoad(window) {
  if (!window.webContents.isLoadingMainFrame() && window.webContents.getURL()) {
    return;
  }

  const didFinishLoad = once(window.webContents, 'did-finish-load').then(() => undefined);
  const didFailLoad = once(window.webContents, 'did-fail-load').then(([, errorCode, errorDescription]) => {
    throw new Error(`Renderer load failed (${errorCode}): ${errorDescription}`);
  });

  await Promise.race([didFinishLoad, didFailLoad]);
}

async function evaluateRenderer(window, expression) {
  return await window.webContents.executeJavaScript(expression, true);
}

async function seedRendererStorage(window, workspaceState) {
  const serializedWorkspace = JSON.stringify(workspaceState);
  await evaluateRenderer(
    window,
    `(() => {
      localStorage.clear();
      localStorage.setItem('ls.writingWorkspace.state', ${JSON.stringify(serializedWorkspace)});
      return localStorage.getItem('ls.writingWorkspace.state');
    })()`,
  );
}

async function reloadRenderer(window) {
  const didFinishLoad = once(window.webContents, 'did-finish-load');
  window.webContents.reload();
  await didFinishLoad;
}

async function getPdfDiagnostics(window) {
  return await evaluateRenderer(
    window,
    `(() => {
      const editor = document.querySelector('.pdf-annotation-editor');
      const status = document.querySelector('[data-statusbar-item-id="pdf-status"]');
      const readerStatus = document.querySelector('.pdf-reader-status');
      return {
        activeTabKind: document.querySelector('.editor-tab.is-active')?.dataset.kind ?? null,
        pageCount: document.querySelectorAll('.pdf-reader-page').length,
        canvasCount: document.querySelectorAll('.pdf-reader-page canvas').length,
        selectionHighlightCount: document.querySelectorAll('.pdf-reader-highlight.is-selection').length,
        annotationHighlightCount: document.querySelectorAll('.pdf-reader-highlight.is-annotation').length,
        editor: editor instanceof HTMLElement
          ? {
              state: editor.dataset.pdfReaderState ?? null,
              status: editor.dataset.pdfReaderStatus ?? null,
              detail: editor.dataset.pdfReaderErrorDetail ?? null,
              textChars: Number(editor.dataset.pdfReaderTextChars ?? 0),
            }
          : null,
        floatingStatus: readerStatus instanceof HTMLElement
          ? {
              text: readerStatus.textContent,
              detail: readerStatus.dataset.pdfReaderErrorDetail ?? null,
              title: readerStatus.getAttribute('title'),
            }
          : null,
        statusbar: status instanceof HTMLElement
          ? {
              value: status.dataset.statusbarItemValue ?? null,
              title: status.dataset.statusbarItemTitle ?? null,
              text: status.textContent,
              className: status.className,
            }
          : null,
      };
    })()`,
  );
}

async function runSmoke() {
  await access(builtMainEntry);
  await access(builtWorkbenchEntry);
  await mkdir(portableRoot, { recursive: true });
  if (inputPdfPath) {
    await access(pdfPath);
  } else {
    await writeFile(pdfPath, createSimplePdfBuffer());
  }

  const pdfUrl = pathToFileURL(pdfPath).toString();
  const seedWorkspace = createSeedWorkspace(pdfUrl);
  logStep('seed pdf', { pdfPath, pdfUrl });

  await import(pathToFileURL(builtMainEntry).toString());
  await app.whenReady();

  const window = await waitForMainWindow();
  const consoleMessages = [];
  lastConsoleMessages = consoleMessages;
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    consoleMessages.push({ level, message, line, sourceId });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[pdf-smoke] renderer process gone', details);
  });

  await waitForDidFinishLoad(window);
  await seedRendererStorage(window, seedWorkspace);
  await reloadRenderer(window);

  const diagnostics = await waitForCondition(
    'pdf preview success or error',
    async () => {
      const snapshot = await getPdfDiagnostics(window);
      lastDiagnostics = snapshot;
      if (
        snapshot.editor?.state === 'ready' ||
        snapshot.editor?.state === 'error'
      ) {
        return snapshot;
      }
      return null;
    },
    { timeoutMs: 20000, stepMs: 150 },
  );

  logStep('pdf diagnostics', diagnostics);
  logStep('renderer console messages', consoleMessages.slice(-20));

  assert.equal(
    diagnostics.editor?.state,
    'ready',
    `Expected PDF preview to render. Diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
  );
  assert.ok(diagnostics.canvasCount >= 1, 'Expected at least one PDF canvas.');
  assert.ok(diagnostics.editor?.textChars >= 1, 'Expected PDF reviewer text character boxes.');

  for (const existingWindow of BrowserWindow.getAllWindows()) {
    if (!existingWindow.isDestroyed()) {
      existingWindow.destroy();
    }
  }
  app.quit();
}

void runSmoke()
  .then(async () => {
    await cleanupTempRoot();
  })
  .catch(async (error) => {
    console.error(
      '[pdf-smoke] failure',
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    logStep('last diagnostics before failure', lastDiagnostics);
    logStep('renderer console messages before failure', lastConsoleMessages.slice(-20));
    await cleanupTempRoot();
    app.exit(1);
  });
