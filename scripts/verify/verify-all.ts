/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runNpmScript } from '../../build/lib/util.ts';
const verifyScripts = [
	'valid-layers-check',
	'test:valid-layers-check',
	'test:server-build',
	'check:i18n',
	'typecheck:tests',
	'test:base-common',
	'test:workbench-browser',
	'test:editor',
	'test:pdf-selection',
	'test:library-store',
	'test:electron-main',
	'test:agent',
	'test:remote',
];

for (const scriptName of verifyScripts) {
	await runNpmScript(scriptName);
}
