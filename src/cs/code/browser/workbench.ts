import {
	diagnoseWorkbenchDependencyImports,
	isNativeWorkbenchAuxiliaryWindow,
	installWorkbenchBootstrapErrorHandlers,
	renderWorkbenchBootstrapError,
	updateWorkbenchBootstrapStatus,
} from 'app/bootstrapWorkbench';

async function bootstrapWorkbench() {
	installWorkbenchBootstrapErrorHandlers('web');

	try {
		await import('cs/workbench/workbench.web.main');

		const { startWorkbenchContributions, stopWorkbenchContributions } =
			await import('cs/workbench/common/contributions');
		if (!isNativeWorkbenchAuxiliaryWindow()) {
			startWorkbenchContributions();
			window.addEventListener('beforeunload', stopWorkbenchContributions, {
				once: true,
			});
		}

		await diagnoseWorkbenchDependencyImports('web');
		const { renderWorkbench } = await import('cs/workbench/browser/workbench');
		renderWorkbench();
	} catch (error) {
		updateWorkbenchBootstrapStatus('web', 'startup failed', error);
		renderWorkbenchBootstrapError('web', error);
	}
}

void bootstrapWorkbench();
