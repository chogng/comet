/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAgentHostOperationId } from 'cs/platform/agentHost/common/identities';
import {
	ProgressLocation,
	type IProgressOptions,
	type IProgressService,
	type IProgressStep,
} from 'cs/platform/progress/common/progress';
import { AgentHostOperationProgress } from 'cs/sessions/contrib/providers/agentHost/browser/agentHostOperationProgress';

class TestProgressService implements IProgressService {
	declare readonly _serviceBrand: undefined;
	readonly options: IProgressOptions[] = [];
	readonly steps: IProgressStep[] = [];
	readonly tasks: Promise<unknown>[] = [];

	withProgress<R>(
		options: IProgressOptions,
		task: (progress: { report(step: IProgressStep): void }) => Promise<R>,
	): Promise<R> {
		this.options.push(options);
		const result = task({ report: step => this.steps.push(step) });
		this.tasks.push(result);
		return result;
	}
}

test('Agent Host operation progress drives one determinate notification until its terminal frame', async () => {
	const service = new TestProgressService();
	const progress = new AgentHostOperationProgress(service);
	const operation = createAgentHostOperationId('sdk-download');
	try {
		progress.handle({
			operation,
			progress: 0,
			total: 1_000,
			message: 'Downloading Claude agent',
		});
		progress.handle({
			operation,
			progress: 400,
			total: 1_000,
			message: 'Downloading Claude agent',
		});

		assert.deepStrictEqual(service.options, [{
			location: ProgressLocation.Notification,
			title: 'Downloading Claude agent',
		}]);
		assert.deepStrictEqual(service.steps, [
			{
				message: 'Downloading Claude agent: 0%',
				worked: 0,
				total: 1_000,
			},
			{
				message: 'Downloading Claude agent: 40%',
				worked: 400,
				total: 1_000,
			},
		]);

		let completed = false;
		void service.tasks[0].then(() => { completed = true; });
		progress.handle({
			operation,
			progress: 1_000,
			total: 1_000,
			message: 'Downloading Claude agent',
		});
		await service.tasks[0];
		assert.equal(completed, true);
	} finally {
		progress.dispose();
	}
});

test('Agent Host operation progress reports received bytes when the total is unknown', () => {
	const service = new TestProgressService();
	const progress = new AgentHostOperationProgress(service);
	try {
		progress.handle({
			operation: createAgentHostOperationId('indeterminate-download'),
			progress: 1_572_864,
			message: 'Downloading Codex agent',
		});
		assert.deepStrictEqual(service.steps, [{
			message: 'Downloading Codex agent: 1.5 MB',
		}]);
	} finally {
		progress.dispose();
	}
});
