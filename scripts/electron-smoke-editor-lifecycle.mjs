import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import electron from 'electron';

const { app, BrowserWindow } = electron;

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
  'electron-sandbox',
  'workbench',
  'workbench.html',
);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cs-electron-smoke-'));
const portableRoot = path.join(tempRoot, 'portable-root');

process.env.PORTABLE_EXECUTABLE_DIR = portableRoot;
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.LS_RENDERER_DEBUG;

let cleanedUp = false;
let smokeServer = null;

function logStep(message, details) {
  if (details === undefined) {
    console.log(`[smoke] ${message}`);
    return;
  }

  console.log(`[smoke] ${message}`);
  console.dir(details, { depth: null });
}

async function cleanupTempRoot() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  if (smokeServer) {
    await new Promise((resolve) => {
      smokeServer.close(() => resolve());
    });
    smokeServer = null;
  }

  try {
    await rm(tempRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function createSmokePageHtml() {
  const sections = Array.from({ length: 180 }, (_, index) => {
    return `<p>Smoke section ${index + 1}: editor lifecycle hide and restore check.</p>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Electron Smoke</title>
    <style>
      body {
        margin: 0;
        font-family: ui-serif, Georgia, serif;
        line-height: 1.6;
        background: linear-gradient(180deg, #f6f2e8 0%, #ebe4d3 100%);
        color: #2d241b;
      }
      main {
        max-width: 720px;
        margin: 0 auto;
        padding: 48px 24px 240px;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 32px;
      }
      p {
        margin: 0 0 20px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Editor Lifecycle Smoke</h1>
      ${sections}
    </main>
  </body>
</html>`;
}

async function createSmokeServer(html) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/' && url.pathname !== '/browser-smoke.html') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Expected local smoke server address.');
  smokeServer = server;
  return `http://127.0.0.1:${address.port}/browser-smoke.html`;
}

function createSeedWorkspace(smokeUrl) {
  return {
    groups: [
      {
        groupId: 'editor-group-a',
        inputs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'Smoke Browser',
            url: smokeUrl,
          },
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Smoke Draft',
            viewMode: 'draft',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a', 'draft-a'],
      },
    ],
    activeGroupId: 'editor-group-a',
    draftStateByInputId: {
      'draft-a': {
        title: 'Smoke Draft',
        viewMode: 'draft',
        document: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: {
                blockId: 'block-smoke-a',
              },
              content: [
                {
                  type: 'text',
                  text: 'Draft smoke content',
                },
              ],
            },
          ],
        },
      },
    },
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

async function getRendererSnapshot(window) {
  return await evaluateRenderer(
    window,
    `(() => ({
      activePage: document.querySelector('.app-shell')?.classList.contains('app-shell-settings')
        ? 'settings'
        : 'content',
      activeTabKind: document.querySelector('.editor-tab.is-active')?.dataset.paneMode ?? null,
      rendererWebviewCount: document.querySelectorAll('webview').length,
      webContentHost: (() => {
        const host = document.querySelector('[data-webcontent-active]');
        if (!(host instanceof HTMLElement)) {
          return null;
        }

        const rect = host.getBoundingClientRect();
        return {
          active: host.dataset.webcontentActive === 'true',
          childCount: host.childElementCount,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })(),
      hasWorkbench: Boolean(document.querySelector('.workbench-content-layout')),
      hasTabs: document.querySelectorAll('.editor-tab').length,
    }))()`,
  );
}

async function clickSelector(window, selector, description) {
  await waitForCondition(
    `${description} selector`,
    async () => {
      return await evaluateRenderer(
        window,
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          return element instanceof HTMLElement;
        })()`,
      );
    },
    { timeoutMs: 5000, stepMs: 100 },
  );

  const clicked = await evaluateRenderer(
    window,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      element.click();
      return true;
    })()`,
  );

  assert.equal(clicked, true, `Expected to click ${description}.`);
}

async function ensureEditorExpanded(window) {
  const expanded = await evaluateRenderer(
    window,
    `(() => {
      const contentGrid = document.querySelector('.content-grid');
      if (!contentGrid?.classList.contains('is-editor-collapsed')) {
        return true;
      }

      const button = document.querySelector('.editor-topbar-toggle-editor-btn');
      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      button.click();
      return true;
    })()`,
  );

  assert.equal(expanded, true, 'Expected to expand the editor before browser smoke.');
}

async function getContentState(window, targetId) {
  return await evaluateRenderer(
    window,
    `(async () => {
      return await window.electronAPI.webContent.getState(${JSON.stringify(targetId)});
    })()`,
  );
}

async function getBrowserViewHostDiagnostics(window) {
  return await evaluateRenderer(
    window,
    `(() => {
      const host = document.querySelector('[data-webcontent-active]');
      return {
        host: host instanceof HTMLElement
          ? {
              active: host.dataset.webcontentActive ?? null,
              className: host.className,
              childCount: host.childElementCount,
              rect: (() => {
                const rect = host.getBoundingClientRect();
                return {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              })(),
            }
          : null,
        rendererWebviewCount: document.querySelectorAll('webview').length,
      };
    })()`,
  );
}

async function getBrowserLifecycleDiagnostics(window, targetId) {
  return {
    renderer: await getRendererSnapshot(window),
    targetState: await getContentState(window, targetId),
    browserDom: await getBrowserDomSnapshot(window, targetId, 500),
    scrollTop: await getBrowserScroll(window, targetId),
    host: await getBrowserViewHostDiagnostics(window),
  };
}

async function executeTargetScript(window, targetId, script, timeoutMs = 1000) {
  return await evaluateRenderer(
    window,
    `(async () => {
      return await window.electronAPI.webContent.executeJavaScript(
        ${JSON.stringify(targetId)},
        ${JSON.stringify(script)},
        ${timeoutMs},
      );
    })()`,
  );
}

async function setBrowserScroll(window, targetId, scrollTop) {
  const nextScrollTop = await executeTargetScript(
    window,
    targetId,
    `(() => {
      window.scrollTo(0, ${scrollTop});
      return Math.round(window.scrollY || document.scrollingElement?.scrollTop || 0);
    })()`,
    2000,
  );
  return Number(nextScrollTop ?? 0);
}

async function getBrowserScroll(window, targetId) {
  const scrollTop = await executeTargetScript(
    window,
    targetId,
    `(() => Math.round(window.scrollY || document.scrollingElement?.scrollTop || 0))()`,
    2000,
  );
  return typeof scrollTop === 'number' ? scrollTop : null;
}

async function getBrowserDomSnapshot(window, targetId, timeoutMs = 2000) {
  return await executeTargetScript(
    window,
    targetId,
    `(() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      return {
        href: location.href,
        title: document.title,
        heading: normalize(document.querySelector('h1')?.textContent),
        paragraphCount: document.querySelectorAll('main p').length,
        bodyTextSample: normalize(document.body?.textContent).slice(0, 120),
      };
    })()`,
    timeoutMs,
  );
}

async function runSmoke() {
  await access(builtMainEntry);
  await access(builtWorkbenchEntry);
  const smokeUrl = await createSmokeServer(createSmokePageHtml());
  const seedWorkspace = createSeedWorkspace(smokeUrl);
  logStep('local smoke page ready', { url: smokeUrl });

  logStep('importing built electron main entry');
  await import(pathToFileURL(builtMainEntry).toString());
  logStep('built electron main entry imported');
  logStep('waiting for electron app ready');
  await app.whenReady();
  logStep('electron app ready');

  const window = await waitForMainWindow();
  logStep('main window detected');
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[smoke] renderer process gone', details);
  });
  window.webContents.on('did-start-loading', () => {
    logStep('renderer did-start-loading');
  });
  window.webContents.on('did-finish-load', () => {
    logStep('renderer did-finish-load', { url: window.webContents.getURL() });
  });
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logStep('renderer did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    },
  );

  logStep('waiting for initial renderer load');
  await waitForDidFinishLoad(window);
  logStep('initial renderer load settled', { url: window.webContents.getURL() });
  logStep('seeding isolated renderer storage');
  await seedRendererStorage(window, seedWorkspace);
  await reloadRenderer(window);

  await waitForCondition(
    'workbench bootstrap',
    async () => {
      const snapshot = await getRendererSnapshot(window);
      return snapshot.hasWorkbench && snapshot.hasTabs === 3 ? snapshot : null;
    },
    { timeoutMs: 20000, stepMs: 100 },
  );
  await ensureEditorExpanded(window);

  logStep('waiting for initial browser target activation');
  try {
    await waitForCondition(
      'initial browser view',
      async () => {
        const snapshot = await getRendererSnapshot(window);
        const state = await getContentState(window, 'browser-a');
        const browserDom = await getBrowserDomSnapshot(window, 'browser-a', 500);
        if (
          snapshot.activePage === 'content' &&
          snapshot.activeTabKind === 'browser' &&
          snapshot.rendererWebviewCount === 0 &&
          snapshot.webContentHost?.active === true &&
          state.activeTargetId === 'browser-a' &&
          state.ownership === 'active' &&
          state.visible === true &&
          state.layoutPhase === 'visible' &&
          browserDom?.href === smokeUrl &&
          browserDom.heading === 'Editor Lifecycle Smoke' &&
          browserDom.paragraphCount === 180
        ) {
          return { snapshot, state, browserDom };
        }

        return null;
      },
      { timeoutMs: 20000, stepMs: 150 },
    );
  } catch (error) {
    logStep(
      'initial browser diagnostics',
      await getBrowserLifecycleDiagnostics(window, 'browser-a'),
    );
    throw error;
  }

  const scrolledTo = await setBrowserScroll(window, 'browser-a', 960);
  assert.ok(scrolledTo >= 900, `Expected browser target to scroll, got ${scrolledTo}.`);
  logStep('browser tab scrolled', { scrollTop: scrolledTo });

  await clickSelector(
    window,
    `.editor-tab[data-pane-mode="draft"] .editor-tab-main`,
    'draft tab button',
  );

  logStep('waiting for browser target to hide after switching to draft');
  try {
    await waitForCondition(
      'draft activation and browser view hide',
      async () => {
        const snapshot = await getRendererSnapshot(window);
        const state = await getContentState(window, 'browser-a');
        const retainedDom = await getBrowserDomSnapshot(window, 'browser-a', 500);
        if (
          snapshot.activeTabKind === 'draft' &&
          snapshot.rendererWebviewCount === 0 &&
          (snapshot.webContentHost === null || snapshot.webContentHost.active === false) &&
          state.activeTargetId === null &&
          state.ownership === 'inactive' &&
          state.visible === false &&
          state.layoutPhase === 'hidden' &&
          retainedDom?.heading === 'Editor Lifecycle Smoke'
        ) {
          return { snapshot, state, retainedDom };
        }

        return null;
      },
      { timeoutMs: 20000, stepMs: 150 },
    );
  } catch (error) {
    logStep(
      'draft hide diagnostics',
      await getBrowserLifecycleDiagnostics(window, 'browser-a'),
    );
    throw error;
  }

  await clickSelector(
    window,
    `.editor-tab[data-pane-mode="browser"] .editor-tab-main`,
    'browser tab button',
  );

  logStep('waiting for browser target restore');
  try {
    await waitForCondition(
      'browser restoration after returning from draft',
      async () => {
        const snapshot = await getRendererSnapshot(window);
        const state = await getContentState(window, 'browser-a');
        const browserDom = await getBrowserDomSnapshot(window, 'browser-a', 500);
        const scrollTop = await getBrowserScroll(window, 'browser-a');
        if (
          snapshot.activeTabKind === 'browser' &&
          snapshot.rendererWebviewCount === 0 &&
          snapshot.webContentHost?.active === true &&
          state.activeTargetId === 'browser-a' &&
          state.ownership === 'active' &&
          state.visible === true &&
          state.layoutPhase === 'visible' &&
          browserDom?.heading === 'Editor Lifecycle Smoke' &&
          browserDom.paragraphCount === 180 &&
          typeof scrollTop === 'number' &&
          scrollTop >= 900
        ) {
          return { snapshot, state, browserDom, scrollTop };
        }

        return null;
      },
      { timeoutMs: 20000, stepMs: 150 },
    );
  } catch (error) {
    logStep(
      'browser restore diagnostics after draft',
      await getBrowserLifecycleDiagnostics(window, 'browser-a'),
    );
    throw error;
  }

  logStep('smoke pass', await getBrowserLifecycleDiagnostics(window, 'browser-a'));

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
      '[smoke] failure',
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    await cleanupTempRoot();
    app.exit(1);
  });
