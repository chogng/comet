/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

const workbenchShell = '.comet-app-shell';
const workbenchContent = '.comet-session-workbench-content-grid';
const visibleEditor = `${workbenchContent}.comet-is-editor-visible`;
const toggleEditorButton = '.comet-editor-titlebar-toggle-editor-btn';

export class Workbench {
	constructor(private readonly code: Code) {}

	async waitForReady(): Promise<void> {
		await this.code.driver.waitForDriver();
		await this.code.waitForElement(workbenchShell);
		await this.code.whenWorkbenchRestored();
	}

	async ensureEditorExpanded(): Promise<void> {
		const isVisible = await this.code.evaluate<boolean>(
			`Boolean(document.querySelector(${JSON.stringify(visibleEditor)}))`,
		);
		if (isVisible) {
			return;
		}

		await this.code.click(toggleEditorButton);
		await this.code.waitForElement(visibleEditor);
	}
}
