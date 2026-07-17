/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IProgressService = createDecorator<IProgressService>('progressService');

export const enum ProgressLocation {
	Notification = 15,
}

export interface IProgressOptions {
	readonly location: ProgressLocation.Notification;
	readonly title: string;
}

export interface IProgressStep {
	readonly message?: string;
	readonly worked?: number;
	readonly total?: number;
}

export interface IProgress<T> {
	report(item: T): void;
}

/** Presents one long-running operation at an explicit Workbench location. */
export interface IProgressService {
	readonly _serviceBrand: undefined;
	withProgress<R>(
		options: IProgressOptions,
		task: (progress: IProgress<IProgressStep>) => Promise<R>,
	): Promise<R>;
}
