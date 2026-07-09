/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import { EventEmitter } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export type WorkbenchSidebarEntry = 'home' | 'code';

export const IWorkbenchSidebarEntryService =
	createDecorator<IWorkbenchSidebarEntryService>('workbenchSidebarEntryService');

export interface IWorkbenchSidebarEntryService extends IDisposable {
	readonly _serviceBrand: undefined;
	readonly onDidChangeActiveEntry: Event<WorkbenchSidebarEntry>;
	getActiveEntry(): WorkbenchSidebarEntry;
	activateEntry(entry: WorkbenchSidebarEntry): void;
}

export class WorkbenchSidebarEntryService implements IWorkbenchSidebarEntryService {
	declare readonly _serviceBrand: undefined;

	private activeEntry: WorkbenchSidebarEntry = 'home';
	private readonly onDidChangeActiveEntryEmitter =
		new EventEmitter<WorkbenchSidebarEntry>();
	readonly onDidChangeActiveEntry = this.onDidChangeActiveEntryEmitter.event;

	getActiveEntry() {
		return this.activeEntry;
	}

	activateEntry(entry: WorkbenchSidebarEntry) {
		if (this.activeEntry === entry) {
			return;
		}

		this.activeEntry = entry;
		this.onDidChangeActiveEntryEmitter.fire(entry);
	}

	dispose() {
		this.onDidChangeActiveEntryEmitter.dispose();
	}
}

registerSingleton(
	IWorkbenchSidebarEntryService,
	WorkbenchSidebarEntryService,
	InstantiationType.Delayed,
);
