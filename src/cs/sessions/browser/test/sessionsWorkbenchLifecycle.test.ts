/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	disposeSessionsWorkbench,
	startSessionsWorkbench,
} from 'cs/sessions/browser/sessionsWorkbench';
import {
	registerWorkbenchContribution,
} from 'cs/workbench/common/contributions';
import {
	getWorkbenchInstantiationService,
	registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import {
	IStorageService,
	WillSaveStateReason,
} from 'cs/platform/storage/common/storage';

test('Sessions startup cannot become running when a contribution starts shutdown', async () => {
	let resolveFlush: (() => void) | undefined;
	const flushCompletion = new Promise<void>(resolve => {
		resolveFlush = resolve;
	});
	let flushCalls = 0;
	let flushReason: WillSaveStateReason | undefined;
	let contributionDisposeCalls = 0;
	let shutdownPromise: Promise<void> | undefined;
	let notifyContributionStarted: (() => void) | undefined;
	const contributionStarted = new Promise<void>(resolve => {
		notifyContributionStarted = resolve;
	});

	registerWorkbenchService(IStorageService, {
		init: () => Promise.resolve(),
		flush: reason => {
			flushCalls += 1;
			flushReason = reason;
			return flushCompletion;
		},
	} as IStorageService);
	registerWorkbenchService(IEditorGroupsService, {
		initialize: () => undefined,
	} as unknown as IEditorGroupsService);
	registerWorkbenchContribution(() => {
		shutdownPromise = disposeSessionsWorkbench();
		notifyContributionStarted?.();
		return {
			dispose: () => {
				contributionDisposeCalls += 1;
			},
		};
	});

	const startupPromise = startSessionsWorkbench();
	await contributionStarted;

	assert.equal(flushCalls, 1);
	assert.equal(flushReason, WillSaveStateReason.SHUTDOWN);
	assert.equal(contributionDisposeCalls, 0);
	assert.equal(
		getWorkbenchInstantiationService().invokeFunction(() => true),
		true,
		'DI must remain active until shutdown storage joins finish',
	);

	resolveFlush?.();
	await assert.rejects(
		startupPromise,
		/Sessions Workbench Application was shut down during startup/,
	);
	await shutdownPromise;
	assert.equal(contributionDisposeCalls, 1);
});
