/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { IAgentHostOperationProgress } from 'cs/platform/agentHost/common/protocol';
import {
	IProgressService,
	ProgressLocation,
	type IProgress,
	type IProgressStep,
} from 'cs/platform/progress/common/progress';

import 'cs/workbench/services/progress/browser/progressService';

interface IActiveAgentHostProgress {
	readonly title: string;
	readonly deferred: DeferredPromise<void>;
	report(step: IProgressStep): void;
}

/** Presents transient Agent Host operation progress without projecting it into Sessions state. */
export class AgentHostOperationProgress extends Disposable {
	private readonly active = new Map<string, IActiveAgentHostProgress>();

	constructor(
		@IProgressService private readonly progressService: IProgressService,
	) {
		super();
		this._register(toDisposable(() => this.clear()));
	}

	clear(): void {
		for (const progress of this.active.values()) {
			progress.deferred.complete();
		}
		this.active.clear();
	}

	handle(progress: IAgentHostOperationProgress): void {
		const complete = progress.total !== undefined && progress.progress === progress.total;
		if (complete) {
			this.active.get(progress.operation)?.deferred.complete();
			this.active.delete(progress.operation);
			return;
		}

		let active = this.active.get(progress.operation);
		if (active === undefined) {
			const deferred = new DeferredPromise<void>();
			const title = progress.message ?? localize('agentHost.operation.progress', "Agent operation in progress");
			let reporter: IProgress<IProgressStep> | undefined;
			void this.progressService.withProgress(
				{ location: ProgressLocation.Notification, title },
				progressReporter => {
					reporter = progressReporter;
					return deferred.p;
				},
			);
			active = Object.freeze({
				title,
				deferred,
				report: (step: IProgressStep) => reporter?.report(step),
			});
			this.active.set(progress.operation, active);
		}

		if (progress.total !== undefined) {
			const percent = progress.total === 0
				? 0
				: Math.round((progress.progress / progress.total) * 100);
			active.report({
				message: localize('agentHost.operation.progressPercent', "{0}: {1}%", active.title, percent),
				worked: progress.progress,
				total: progress.total,
			});
			return;
		}
		const megabytes = (progress.progress / (1024 * 1024)).toFixed(1);
		active.report({
			message: localize('agentHost.operation.progressMegabytes', "{0}: {1} MB", active.title, megabytes),
		});
	}
}
