/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';

let isEnabled = false;
let hotReloadHandlers: Set<HotReloadHandler> | undefined;

export type HotReloadHandler = (args: { oldExports: Record<string, unknown>; newSrc: string; config: IHotReloadConfig }) => AcceptNewExportsHandler | undefined;
export type AcceptNewExportsHandler = (newExports: Record<string, unknown>) => boolean;
export type IHotReloadConfig = HotReloadConfig;

interface HotReloadConfig {
	mode?: 'patch-prototype' | undefined;
}

interface GlobalThisAddition {
	$hotReload_applyNewExports?(args: { oldExports: Record<string, unknown>; newSrc: string; config?: HotReloadConfig }): AcceptNewExportsHandler | undefined;
}

export function enableHotReload(): void {
	isEnabled = true;
}

export function isHotReloadEnabled(): boolean {
	return isEnabled;
}

export function registerHotReloadHandler(handler: HotReloadHandler): IDisposable {
	if (!isHotReloadEnabled()) {
		return { dispose() {} };
	}

	const handlers = registerGlobalHotReloadHandler();
	handlers.add(handler);
	return {
		dispose() {
			handlers.delete(handler);
		},
	};
}

function registerGlobalHotReloadHandler(): Set<HotReloadHandler> {
	hotReloadHandlers ??= new Set();

	const global = globalThis as unknown as GlobalThisAddition;
	if (!global.$hotReload_applyNewExports) {
		global.$hotReload_applyNewExports = args => {
			const normalizedArgs = { config: { mode: undefined }, ...args };
			const acceptHandlers: AcceptNewExportsHandler[] = [];

			for (const handler of hotReloadHandlers!) {
				const acceptHandler = handler(normalizedArgs);
				if (acceptHandler) {
					acceptHandlers.push(acceptHandler);
				}
			}

			if (acceptHandlers.length === 0) {
				return undefined;
			}

			return newExports => {
				let accepted = false;
				for (const acceptHandler of acceptHandlers) {
					if (acceptHandler(newExports)) {
						accepted = true;
					}
				}
				return accepted;
			};
		};
	}

	return hotReloadHandlers;
}

if (isHotReloadEnabled()) {
	registerHotReloadHandler(({ oldExports, config }) => {
		if (config.mode !== 'patch-prototype') {
			return undefined;
		}

		return newExports => {
			for (const key in newExports) {
				const exportedItem = newExports[key];
				if (typeof exportedItem !== 'function' || !exportedItem.prototype) {
					continue;
				}

				const oldExportedItem = oldExports[key];
				if (!oldExportedItem) {
					continue;
				}

				for (const property of Object.getOwnPropertyNames(exportedItem.prototype)) {
					const descriptor = Object.getOwnPropertyDescriptor(exportedItem.prototype, property);
					if (descriptor) {
						Object.defineProperty((oldExportedItem as { prototype: object }).prototype, property, descriptor);
					}
				}
				newExports[key] = oldExportedItem;
			}

			return true;
		};
	});
}
