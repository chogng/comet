/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function isNativeWorkbenchAuxiliaryWindow() {
	const query = new URLSearchParams(window.location.search);
	return query.has('nativeOverlay');
}

async function main() {
	await import('cs/workbench/workbench.web.main');

	const { startWorkbenchContributions, stopWorkbenchContributions } =
		await import('cs/workbench/common/contributions');
	if (!isNativeWorkbenchAuxiliaryWindow()) {
		startWorkbenchContributions();
		window.addEventListener('beforeunload', stopWorkbenchContributions, {
			once: true,
		});
	}

	const { renderWorkbench } = await import('cs/workbench/browser/workbench');
	renderWorkbench();
}

void main();
