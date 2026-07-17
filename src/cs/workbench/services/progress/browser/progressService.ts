/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Severity, INotificationService } from 'cs/platform/notification/common/notification';
import {
	IProgressService,
	ProgressLocation,
	type IProgressOptions,
	type IProgressStep,
} from 'cs/platform/progress/common/progress';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';

/** Workbench progress presentation backed by the shared notification model. */
export class ProgressService implements IProgressService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
	) { }

	async withProgress<R>(
		options: IProgressOptions,
		task: (progress: { report(step: IProgressStep): void }) => Promise<R>,
	): Promise<R> {
		if (options.location !== ProgressLocation.Notification) {
			throw new Error(`Unsupported progress location '${options.location}'.`);
		}
		const handle = this.notificationService.notify({
			severity: Severity.Info,
			message: options.title,
			progress: { infinite: true },
		});
		try {
			return await task({
				report: step => {
					if (step.message !== undefined) {
						handle.updateMessage(step.message);
					}
					if (step.total !== undefined) {
						handle.progress.total(step.total);
					}
					if (step.worked !== undefined) {
						handle.progress.worked(step.worked);
					}
					if (step.total === undefined && step.worked === undefined) {
						handle.progress.infinite();
					}
				},
			});
		} finally {
			handle.progress.done();
			handle.close();
		}
	}
}

registerSingleton(IProgressService, ProgressService, InstantiationType.Delayed);
