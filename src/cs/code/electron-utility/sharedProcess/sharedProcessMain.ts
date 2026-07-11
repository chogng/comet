/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MessageEvent } from 'electron';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import { SharedProcessLifecycle } from 'cs/platform/sharedProcess/common/sharedProcess';
import { registerSharedProcessChannels } from 'cs/platform/sharedProcess/node/sharedProcess';

process.parentPort.on('message', (event: MessageEvent) => {
	if (event.data?.type !== SharedProcessLifecycle.connect) {
		return;
	}
	const port = event.ports[0];
	if (!port) {
		throw new Error('Shared process connection did not include a message port.');
	}
	const ipc = new MessagePortChannel(port, 'shared-process');
	registerSharedProcessChannels(ipc);
});

process.parentPort.postMessage({ type: SharedProcessLifecycle.ready });
