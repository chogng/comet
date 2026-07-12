/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { ContextKeyServiceImpl } from 'cs/platform/contextkey/common/contextkey';

test('workbench context keys sync Part DOM state', async () => {
	const dom = installDomTestEnvironment();
	try {
		const {
			bindWorkbenchContextKeys,
			syncWorkbenchContextKeys,
		} = await import('cs/workbench/browser/contextkeys');
		const { registerWorkbenchPartDomNode } = await import('cs/workbench/browser/layout');
		const { WORKBENCH_PART_IDS } = await import('cs/workbench/browser/part');
		const fakeContainer = {} as HTMLElement;
		for (const partId of Object.values(WORKBENCH_PART_IDS)) {
			registerWorkbenchPartDomNode(partId, null);
		}

		const service = new ContextKeyServiceImpl();
		const keys = bindWorkbenchContextKeys(service);
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, fakeContainer);
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, fakeContainer);
		syncWorkbenchContextKeys(keys);

		assert.deepStrictEqual({
			settingsVisible: service.getContextKeyValue('workbench.settingsVisible'),
			hasContainer: service.getContextKeyValue('workbench.hasContainer'),
			hasSettings: service.getContextKeyValue('workbench.hasSettings'),
			hasEditor: service.getContextKeyValue('workbench.hasEditor'),
		}, {
			settingsVisible: true,
			hasContainer: true,
			hasSettings: true,
			hasEditor: false,
		});

		for (const partId of Object.values(WORKBENCH_PART_IDS)) {
			registerWorkbenchPartDomNode(partId, null);
		}
	} finally {
		dom.cleanup();
	}
});
