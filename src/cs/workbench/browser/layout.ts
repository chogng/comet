/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import type { WorkbenchPartId, WorkbenchPartRefCallback } from 'cs/workbench/browser/part';

let workbenchPartDomSnapshot: Readonly<Record<WorkbenchPartId, HTMLElement | null>> = {};
const onDidChangeWorkbenchPartDomEmitter = new EventEmitter<void>({
	onListenerError: onUnexpectedError,
});
const workbenchPartRefCallbacks = new Map<WorkbenchPartId, WorkbenchPartRefCallback>();

export function subscribeWorkbenchPartDom(listener: () => void) {
	return onDidChangeWorkbenchPartDomEmitter.event(listener);
}

export function getWorkbenchPartDomSnapshot(): Readonly<Record<WorkbenchPartId, HTMLElement | null>> {
	return workbenchPartDomSnapshot;
}

export function getWorkbenchPartDomNode(partId: WorkbenchPartId): HTMLElement | null {
	return workbenchPartDomSnapshot[partId] ?? null;
}

export function registerWorkbenchPartDomNode(
	partId: WorkbenchPartId,
	element: HTMLElement | null,
): void {
	if (getWorkbenchPartDomNode(partId) === element) {
		return;
	}

	workbenchPartDomSnapshot = {
		...workbenchPartDomSnapshot,
		[partId]: element,
	};
	onDidChangeWorkbenchPartDomEmitter.fire();
}

export function createWorkbenchPartRef(
	partId: WorkbenchPartId,
): WorkbenchPartRefCallback {
	const cachedCallback = workbenchPartRefCallbacks.get(partId);
	if (cachedCallback) {
		return cachedCallback;
	}

	const callback: WorkbenchPartRefCallback = element => {
		registerWorkbenchPartDomNode(partId, element);
	};
	workbenchPartRefCallbacks.set(partId, callback);
	return callback;
}
