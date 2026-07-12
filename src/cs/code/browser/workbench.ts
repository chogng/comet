/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

async function main() {
	await import('cs/sessions/sessions.web.main');

	const { startSessionsWorkbench } = await import('cs/sessions/browser/sessionsWorkbench');
	await startSessionsWorkbench();
}

void main();
