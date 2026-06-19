import {
  diagnoseWorkbenchDependencyImports,
  isNativeWorkbenchAuxiliaryWindow,
  installWorkbenchBootstrapErrorHandlers,
  renderWorkbenchBootstrapError,
  updateWorkbenchBootstrapStatus,
} from 'app/bootstrapWorkbench';

async function bootstrapWorkbench() {
  installWorkbenchBootstrapErrorHandlers('desktop');

  try {
    await import('ls/workbench/workbench.desktop.main');

    const { startWorkbenchContributions, stopWorkbenchContributions } =
      await import('ls/workbench/browser/workbench.contribution');
    if (!isNativeWorkbenchAuxiliaryWindow()) {
      startWorkbenchContributions();
      window.addEventListener('beforeunload', stopWorkbenchContributions, {
        once: true,
      });
    }

    await diagnoseWorkbenchDependencyImports('desktop');
    const { renderWorkbench } = await import('ls/workbench/browser/workbench');
    renderWorkbench();
  } catch (error) {
    updateWorkbenchBootstrapStatus('desktop', 'startup failed', error);
    renderWorkbenchBootstrapError('desktop', error);
  }
}

void bootstrapWorkbench();
