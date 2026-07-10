/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const automationDir = path.dirname(toolsDir);
const projectRoot = path.dirname(path.dirname(automationDir));
const driverPath = path.join(
	projectRoot,
	'src',
	'cs',
	'workbench',
	'services',
	'driver',
	'common',
	'driver.ts',
);

const source = fs.readFileSync(driverPath, 'utf8');
const contract = /\/\/\*START([\s\S]*)\/\/\*END/mi.exec(source)?.[1]?.trim();
if (!contract) {
	throw new Error(`Unable to find the driver contract markers in ${driverPath}.`);
}

const contents = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

${contract}
`;

const sourcePath = path.join(automationDir, 'src', 'driver.d.ts');
const outputDir = path.join(automationDir, 'out');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(sourcePath, contents);
fs.writeFileSync(path.join(outputDir, 'driver.d.ts'), contents);
