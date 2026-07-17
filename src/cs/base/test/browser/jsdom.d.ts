/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'jsdom' {
	export class JSDOM {
		readonly window: Window & typeof globalThis;

		constructor(
			html?: string,
			options?: {
				readonly url?: string;
				readonly pretendToBeVisual?: boolean;
			},
		);
	}
}
