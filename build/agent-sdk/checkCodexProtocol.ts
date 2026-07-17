/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { verifyCodexProtocolSources } from './codexProtocol.ts';

const metadata = await verifyCodexProtocolSources();
console.log(
	`Codex protocol matches @openai/codex ${metadata.sdkVersion}: ${metadata.fileCount} files (${metadata.sourceDigest}).`,
);
