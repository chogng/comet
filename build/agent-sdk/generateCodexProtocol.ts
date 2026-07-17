/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
	codexGeneratedProtocolRoot,
	codexProtocolMetadataFile,
	codexProtocolRoot,
	generateCodexProtocol,
} from './codexProtocol.ts';

const stagingRoot = `${codexProtocolRoot}.staging`;
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
try {
	const metadata = await generateCodexProtocol(stagingRoot);
	await rm(codexGeneratedProtocolRoot, { recursive: true, force: true });
	await rename(path.join(stagingRoot, 'generated'), codexGeneratedProtocolRoot);
	await rm(codexProtocolMetadataFile, { force: true });
	await rename(path.join(stagingRoot, 'protocolMetadata.ts'), codexProtocolMetadataFile);
	console.log(
		`Generated ${metadata.fileCount} Codex protocol files for ${metadata.sdkVersion} (${metadata.sourceDigest}).`,
	);
} finally {
	await rm(stagingRoot, { recursive: true, force: true });
}
