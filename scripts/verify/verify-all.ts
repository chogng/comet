/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runNpmScript } from '../../build/lib/util.ts';

const verifyScripts = [
	'valid-layers-check',
	'check:i18n',
	'typecheck:tests',
	'test:unit',
];

for (const scriptName of verifyScripts) {
	await runNpmScript(scriptName);
}
