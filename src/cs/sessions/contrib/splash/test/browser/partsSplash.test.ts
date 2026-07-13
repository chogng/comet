/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const Root = process.cwd();

function readSource(relativePath: string): string {
	return readFileSync(path.join(Root, relativePath), 'utf8');
}

test('Sessions parts splash consumes atomic layout geometry without Part DOM access', () => {
	const splash = readSource('src/cs/sessions/contrib/splash/browser/partsSplash.ts');
	const layout = readSource('src/cs/sessions/browser/layout.ts');
	const shell = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');

	assert.doesNotMatch(
		splash,
		/getWorkbenchPartDom|subscribeWorkbenchPartDom|SESSION_PART_IDS|WORKBENCH_PART_IDS|getBoundingClientRect|getLayoutState/,
	);
	assert.match(splash, /onDidChangeLayoutGeometry\(this\.scheduleSaveWindowSplash\)/);
	assert.match(splash, /if \(!this\.layoutService\.getLayoutGeometry\(\)\) \{\s*return;/);
	assert.match(splash, /const layoutGeometry = this\.layoutService\.getLayoutGeometry\(\)/);

	assert.match(layout, /this\.gridView\.layout\([^)]+\);\s*this\.onDidLayout\(\{/);
	assert.match(layout, /sessions: \{\s*visible: true,\s*width: this\.gridView\.getViewSize\(\[SessionsIndex\]\)/);
	assert.match(shell, /this\.publishLayoutGeometry/);
	assert.match(shell, /this\.sessionsLayoutService\.setLayoutGeometry\(\{/);
});
