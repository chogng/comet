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
    await import('cs/workbench/workbench.desktop.main');

    const { startWorkbenchContributions, stopWorkbenchContributions } =
      await import('cs/workbench/common/contributions');
    if (!isNativeWorkbenchAuxiliaryWindow()) {
      startWorkbenchContributions();
      window.addEventListener('beforeunload', stopWorkbenchContributions, {
        once: true,
      });
    }

    await diagnoseWorkbenchDependencyImports('desktop');
    const { renderWorkbench } = await import('cs/workbench/browser/workbench');
    renderWorkbench();
  } catch (error) {
    updateWorkbenchBootstrapStatus('desktop', 'startup failed', error);
    renderWorkbenchBootstrapError('desktop', error);
  }
}

void bootstrapWorkbench();
