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
  'cs',
  'code',
  'electron-browser',
  'workbench.html',
);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cs-electron-pdf-smoke-'));
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
  const stream = 'BT /F1 16 Tf 48 112 Td (Comet Studio PDF smoke) Tj ET';
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

function createMultiPagePdfBuffer(pageCount = 12) {
  const encoder = new TextEncoder();
  const chunks = ['%PDF-1.7\n'];
  const offsets = [0];
  const pageObjectIds = [];
  const contentObjectIds = [];
  let nextObjectId = 3;

  for (let page = 1; page <= pageCount; page += 1) {
    pageObjectIds.push(nextObjectId);
    nextObjectId += 1;
    contentObjectIds.push(nextObjectId);
    nextObjectId += 1;
  }
  const fontObjectId = nextObjectId;

  const addObject = (id, body) => {
    offsets[id] = encoder.encode(chunks.join('')).byteLength;
    chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(
    2,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  );

  for (let index = 0; index < pageCount; index += 1) {
    const page = index + 1;
    addObject(
      pageObjectIds[index],
      [
        '<< /Type /Page /Parent 2 0 R',
        '/MediaBox [0 0 612 792]',
        `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >>`,
        `/Contents ${contentObjectIds[index]} 0 R >>`,
      ].join(' '),
    );
    const stream = `BT /F1 24 Tf 72 680 Td (Page ${page} scroll latency probe) Tj ET`;
    addObject(contentObjectIds[index], `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  addObject(fontObjectId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefOffset = encoder.encode(chunks.join('')).byteLength;
  chunks.push('xref\n');
  chunks.push(`0 ${fontObjectId + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let id = 1; id <= fontObjectId; id += 1) {
    chunks.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push('trailer\n');
  chunks.push(`<< /Size ${fontObjectId + 1} /Root 1 0 R >>\n`);
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
      localStorage.setItem('cs.writingWorkspace.state', ${JSON.stringify(serializedWorkspace)});
      return localStorage.getItem('cs.writingWorkspace.state');
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
      const editor = document.querySelector('.pdf-document-reader');
      const status = document.querySelector('[data-statusbar-item-id="pdf-status"]');
      const readerStatus = document.querySelector('.pdf-reader-status');
      let renderDiagnostics = null;
      if (editor instanceof HTMLElement && editor.dataset.pdfReaderRenderDiagnostics) {
        try {
          renderDiagnostics = JSON.parse(editor.dataset.pdfReaderRenderDiagnostics);
        } catch {
          renderDiagnostics = null;
        }
      }
      return {
        activeTabKind: document.querySelector('.editor-tab.is-active')?.dataset.kind ?? null,
        pageCount: document.querySelectorAll('.pdf-reader-page').length,
        canvasCount: document.querySelectorAll('.pdf-reader-page canvas').length,
        selectionHighlightCount: document.querySelectorAll('.pdf-reader-highlight.is-selection').length,
        annotationHighlightCount: document.querySelectorAll('.pdf-reader-highlight.is-annotation').length,
        renderDiagnostics,
        editor: editor instanceof HTMLElement
          ? {
              state: editor.dataset.pdfReaderState ?? null,
              status: editor.dataset.pdfReaderStatus ?? null,
              detail: editor.dataset.pdfReaderErrorDetail ?? null,
              textChars: Number(editor.dataset.pdfReaderTextChars ?? 0),
              selectionText: editor.dataset.pdfReaderSelectionText ?? null,
              selectionPages: editor.dataset.pdfReaderSelectionPages ?? null,
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

async function dragSelectGeneratedPdfText(window) {
  await evaluateRenderer(
    window,
    `(() => {
      const page = document.querySelector('.pdf-reader-page');
      const wrap = document.querySelector('.pdf-reader-page-canvas-wrap');
      const canvas = document.querySelector('.pdf-reader-page canvas');
      if (!(page instanceof HTMLElement) || !(wrap instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
        return false;
      }

      const rect = canvas.getBoundingClientRect();
      const pageWidth = 300;
      const pageHeight = 200;
      const scale = rect.width / pageWidth;
      const start = {
        x: rect.left + 48 * scale,
        y: rect.top + (pageHeight - 112 - 16) * scale,
      };
      const end = {
        x: rect.left + 270 * scale,
        y: start.y,
      };
      const makeEvent = (type, point) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: point.x,
        clientY: point.y,
        pointerId: 10,
        pointerType: 'mouse',
      });

      wrap.dispatchEvent(makeEvent('pointerdown', start));
      wrap.dispatchEvent(makeEvent('pointermove', end));
      wrap.dispatchEvent(makeEvent('pointerup', end));
      return true;
    })()`,
  );
}

async function getPdfScrollDiagnostics(window) {
  return await evaluateRenderer(
    window,
    `(() => {
      const editor = document.querySelector('.pdf-document-reader');
      const pagesElement = document.querySelector('.pdf-reader-pages');
      let renderDiagnostics = null;
      if (editor instanceof HTMLElement && editor.dataset.pdfReaderRenderDiagnostics) {
        try {
          renderDiagnostics = JSON.parse(editor.dataset.pdfReaderRenderDiagnostics);
        } catch {
          renderDiagnostics = null;
        }
      }
      if (!(pagesElement instanceof HTMLElement)) {
        return {
          renderDiagnostics,
          pages: [],
          visiblePages: [],
          scrollTop: null,
          canvasCount: document.querySelectorAll('.pdf-reader-page canvas').length,
        };
      }
      const viewport = pagesElement.getBoundingClientRect();
      const pages = [...document.querySelectorAll('.pdf-reader-page')]
        .map((pageElement) => {
          const page = Number(pageElement.dataset.pdfPage);
          const rect = pageElement.getBoundingClientRect();
          const canvas = pageElement.querySelector('canvas');
          return {
            page,
            visible: rect.bottom >= viewport.top && rect.top <= viewport.bottom,
            hasCanvas: canvas instanceof HTMLCanvasElement,
            canvasTransform: canvas instanceof HTMLElement ? canvas.style.transform : null,
          };
        });
      return {
        renderDiagnostics,
        pages,
        visiblePages: pages.filter((page) => page.visible),
        scrollTop: pagesElement.scrollTop,
        canvasCount: document.querySelectorAll('.pdf-reader-page canvas').length,
      };
    })()`,
  );
}

async function scrollPdfPageIntoView(window, pageNumber) {
  return await evaluateRenderer(
    window,
    `(() => {
      const pagesElement = document.querySelector('.pdf-reader-pages');
      const target = document.querySelector('.pdf-reader-page[data-pdf-page="${pageNumber}"]');
      if (!(pagesElement instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        return false;
      }
      pagesElement.scrollTop = Math.max(0, target.offsetTop - 12);
      pagesElement.dispatchEvent(new Event('scroll', { bubbles: true }));
      return true;
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

  if (!inputPdfPath) {
    await dragSelectGeneratedPdfText(window);
    const selectionDiagnostics = await waitForCondition(
      'pdf text selection',
      async () => {
        const snapshot = await getPdfDiagnostics(window);
        lastDiagnostics = snapshot;
        if (
          snapshot.selectionHighlightCount >= 1 &&
          snapshot.editor?.selectionText
        ) {
          return snapshot;
        }
        return null;
      },
      { timeoutMs: 5000, stepMs: 100 },
    );
    logStep('pdf selection diagnostics', selectionDiagnostics);
    assert.match(
      selectionDiagnostics.editor.selectionText,
      /Comet Studio PDF smoke/,
      'Expected generated PDF text selection to preserve readable text.',
    );

    const multiPagePdfPath = path.join(tempRoot, 'PDF Scroll Smoke.pdf');
    await writeFile(multiPagePdfPath, createMultiPagePdfBuffer());
    const multiPagePdfUrl = pathToFileURL(multiPagePdfPath).toString();
    logStep('seed multi-page pdf', { pdfPath: multiPagePdfPath, pdfUrl: multiPagePdfUrl });
    await seedRendererStorage(window, createSeedWorkspace(multiPagePdfUrl));
    await reloadRenderer(window);

    const multiPageDiagnostics = await waitForCondition(
      'multi-page pdf preview success or error',
      async () => {
        const snapshot = await getPdfDiagnostics(window);
        lastDiagnostics = snapshot;
        if (
          snapshot.editor?.state === 'ready' &&
          snapshot.pageCount === 12 &&
          snapshot.canvasCount >= 1
        ) {
          return snapshot;
        }
        if (snapshot.editor?.state === 'error') {
          return snapshot;
        }
        return null;
      },
      { timeoutMs: 20000, stepMs: 150 },
    );
    logStep('multi-page pdf diagnostics', multiPageDiagnostics);
    assert.equal(
      multiPageDiagnostics.editor?.state,
      'ready',
      `Expected multi-page PDF preview to render. Diagnostics: ${JSON.stringify(multiPageDiagnostics, null, 2)}`,
    );
    assert.equal(multiPageDiagnostics.pageCount, 12, 'Expected generated multi-page PDF shell count.');
    assert.ok(
      multiPageDiagnostics.canvasCount >= 2,
      `Expected multi-page PDF ready state to render more than one canvas. Diagnostics: ${JSON.stringify(multiPageDiagnostics, null, 2)}`,
    );
    assert.ok(
      multiPageDiagnostics.renderDiagnostics?.pageRenderCount >= 2,
      `Expected multi-page PDF ready state to complete multiple page renders. Diagnostics: ${JSON.stringify(multiPageDiagnostics, null, 2)}`,
    );

    const scrollStartedAt = performance.now();
    for (const pageNumber of [4, 8, 12]) {
      assert.equal(
        await scrollPdfPageIntoView(window, pageNumber),
        true,
        `Expected to scroll page ${pageNumber} into view.`,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    const scrollDiagnostics = await waitForCondition(
      'target page render after fast cross-page scroll',
      async () => {
        const snapshot = await getPdfScrollDiagnostics(window);
        lastDiagnostics = snapshot;
        const target = snapshot.pages.find((page) => page.page === 12);
        const targetVisible = snapshot.visiblePages.some((page) => page.page === 12);
        if (targetVisible && target?.hasCanvas) {
          return snapshot;
        }
        return null;
      },
      { timeoutMs: 3000, stepMs: 50 },
    );
    logStep('multi-page scroll diagnostics', {
      elapsedMs: Math.round(performance.now() - scrollStartedAt),
      ...scrollDiagnostics,
    });
    assert.ok(
      scrollDiagnostics.renderDiagnostics?.pageRenderCount >= 2,
      'Expected PDF render diagnostics to record multiple page renders.',
    );
    assert.ok(
      scrollDiagnostics.renderDiagnostics?.textCacheMisses >= 1,
      'Expected PDF render diagnostics to record text cache activity.',
    );
  }

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
