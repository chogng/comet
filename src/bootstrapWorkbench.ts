type BootstrapTarget = 'web' | 'desktop';

type BootstrapWindow = Window & {
  __lsWorkbenchBootstrapHandlersInstalled?: boolean;
  __lsSetBootstrapStatus?: (message: string, error?: unknown) => void;
};

function isBootstrapDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const query = new URLSearchParams(window.location.search);
    if (query.get('debugBootstrap') === '1') {
      return true;
    }

    return window.localStorage.getItem('ls.debugBootstrap') === '1';
  } catch {
    return false;
  }
}

function ensureRootElement() {
  let rootElement = document.getElementById('root');
  if (rootElement) {
    return rootElement;
  }

  rootElement = document.createElement('div');
  rootElement.id = 'root';
  document.body.replaceChildren(rootElement);
  return rootElement;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      title: `${error.name}: ${error.message}`,
      details: error.stack ?? error.message,
    };
  }

  const message = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
  return {
    title: 'Unknown bootstrap error',
    details: message,
  };
}

function setBootstrapStatus(message: string, error?: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  if (error === undefined) {
    if (!isBootstrapDebugEnabled()) {
      return;
    }

    console.info(`[workbench-bootstrap] ${message}`);
  } else {
    console.error(`[workbench-bootstrap] ${message}`, error);
  }

  (window as BootstrapWindow).__lsSetBootstrapStatus?.(message, error);
}

export function updateWorkbenchBootstrapStatus(
  target: BootstrapTarget,
  message: string,
  error?: unknown,
) {
  setBootstrapStatus(`${target}: ${message}`, error);
}

export function isNativeWorkbenchAuxiliaryWindow() {
  if (typeof window === 'undefined') {
    return false;
  }

  const query = new URLSearchParams(window.location.search);
  return query.has('nativeOverlay');
}

const workbenchDependencyModules = [
  {
    label: 'ls/base/browser/ui/toast/toast',
    load: () => import('ls/base/browser/ui/toast/toast'),
  },
  {
    label: 'ls/workbench/services/desktop/desktopError',
    load: () => import('ls/workbench/services/desktop/desktopError'),
  },
  {
    label: 'ls/workbench/browser/assistantModel',
    load: () => import('ls/workbench/browser/assistantModel'),
  },
  {
    label: 'ls/workbench/browser/batchFetchModel',
    load: () => import('ls/workbench/browser/batchFetchModel'),
  },
  {
    label: 'ls/workbench/browser/documentActionsModel',
    load: () => import('ls/workbench/browser/documentActionsModel'),
  },
  {
    label: 'ls/workbench/browser/libraryModel',
    load: () => import('ls/workbench/browser/libraryModel'),
  },
  {
    label: 'ls/workbench/browser/webContentNavigationModel',
    load: () => import('ls/workbench/browser/webContentNavigationModel'),
  },
  {
    label: 'ls/workbench/browser/layout',
    load: () => import('ls/workbench/browser/layout'),
  },
  {
    label: 'ls/workbench/contrib/preferences/browser/settingsController',
    load: () => import('ls/workbench/contrib/preferences/browser/settingsController'),
  },
  {
    label: 'ls/workbench/browser/parts/editor/editorPart',
    load: () => import('ls/workbench/browser/parts/editor/editorPart'),
  },
  {
    label: 'ls/workbench/contrib/preferences/browser/settingsEditor',
    load: () => import('ls/workbench/contrib/preferences/browser/settingsEditor'),
  },
  {
    label: 'ls/workbench/browser/parts/sidebar/fetchPanePart',
    load: () => import('ls/workbench/browser/parts/sidebar/fetchPanePart'),
  },
  {
    label: 'ls/workbench/browser/toastOverlayWindow',
    load: () => import('ls/workbench/browser/toastOverlayWindow'),
  },
  {
    label: 'ls/workbench/services/localization/browser/localeService',
    load: () => import('ls/workbench/services/localization/browser/localeService'),
  },
  {
    label: 'ls/workbench/browser/session',
    load: () => import('ls/workbench/browser/session'),
  },
  {
    label: 'ls/workbench/browser/window',
    load: () => import('ls/workbench/browser/window'),
  },
  {
    label: 'ls/workbench/browser/workbenchContentState',
    load: () => import('ls/workbench/browser/workbenchContentState'),
  },
  {
    label: 'ls/workbench/browser/webContentSurfaceState',
    load: () => import('ls/workbench/browser/webContentSurfaceState'),
  },
  {
    label: 'ls/workbench/services/config/configSchema',
    load: () => import('ls/workbench/services/config/configSchema'),
  },
  {
    label: 'ls/workbench/browser/parts/editor/editorModel',
    load: () => import('ls/workbench/browser/parts/editor/editorModel'),
  },
] as const;

const MODULE_IMPORT_TIMEOUT_MS = 4000;

async function loadWorkbenchDependencyModuleWithTimeout(
  target: BootstrapTarget,
  label: string,
  load: () => Promise<unknown>,
) {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(
            new Error(
              `Timed out after ${MODULE_IMPORT_TIMEOUT_MS}ms while importing ${label}`,
            ),
          );
        }, MODULE_IMPORT_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    updateWorkbenchBootstrapStatus(target, `failed importing ${label}`, error);
    throw error;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function diagnoseWorkbenchDependencyImports(
  target: BootstrapTarget,
) {
  for (const moduleEntry of workbenchDependencyModules) {
    await loadWorkbenchDependencyModuleWithTimeout(
      target,
      moduleEntry.label,
      moduleEntry.load,
    );
  }
}

export function renderWorkbenchBootstrapError(
  target: BootstrapTarget,
  error: unknown,
) {
  setBootstrapStatus(`Renderer startup failed for ${target}.`, error);
  const { title, details } = normalizeError(error);
  const rootElement = ensureRootElement();
  const surface = document.createElement('main');
  const heading = document.createElement('h1');
  const summary = document.createElement('p');
  const pre = document.createElement('pre');

  surface.setAttribute(
    'style',
    [
      'min-height:100vh',
      'margin:0',
      'padding:24px',
      'background:#f6f8fb',
      'color:#1c2733',
      'font:13px/1.5 Menlo, Monaco, Consolas, monospace',
      'display:grid',
      'gap:12px',
      'align-content:start',
      'box-sizing:border-box',
    ].join(';'),
  );
  heading.setAttribute(
    'style',
    'margin:0;font:600 18px/1.3 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC",sans-serif;',
  );
  summary.setAttribute(
    'style',
    'margin:0;color:#506070;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC",sans-serif;',
  );
  pre.setAttribute(
    'style',
    [
      'margin:0',
      'padding:16px',
      'white-space:pre-wrap',
      'word-break:break-word',
      'background:#ffffff',
      'border:1px solid #d7e0ea',
      'border-radius:10px',
      'overflow:auto',
    ].join(';'),
  );

  heading.textContent = 'Workbench bootstrap failed';
  summary.textContent = `${target} renderer failed during startup: ${title}`;
  pre.textContent = details;
  surface.append(heading, summary, pre);
  rootElement.replaceChildren(surface);

  console.error(`[workbench-bootstrap:${target}]`, error);
}

export function installWorkbenchBootstrapErrorHandlers(
  target: BootstrapTarget,
) {
  if (typeof window === 'undefined') {
    return;
  }

  const bootstrapWindow = window as BootstrapWindow;
  if (bootstrapWindow.__lsWorkbenchBootstrapHandlersInstalled) {
    return;
  }

  bootstrapWindow.__lsWorkbenchBootstrapHandlersInstalled = true;
  if (isBootstrapDebugEnabled()) {
    setBootstrapStatus(`Installing ${target} bootstrap handlers...`);
  }

  window.addEventListener('error', (event) => {
    renderWorkbenchBootstrapError(target, event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    renderWorkbenchBootstrapError(target, event.reason);
  });
}
