/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type WindowOpenDecision = { action: 'deny' };

type WindowOpenWebContents = {
	setWindowOpenHandler(handler: (details: unknown) => WindowOpenDecision): void;
};

type WindowOpenPolicyApp = {
	on(
		eventName: 'web-contents-created',
		listener: (event: unknown, contents: WindowOpenWebContents) => void,
	): void;
};

export function registerWindowOpenPolicy(app: WindowOpenPolicyApp) {
	app.on('web-contents-created', (_event, contents) => {
		contents.setWindowOpenHandler(() => ({ action: 'deny' }));
	});
}
