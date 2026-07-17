/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { ProgressLocation } from 'cs/platform/progress/common/progress';
import { NotificationService } from 'cs/workbench/services/notification/common/notificationService';
import { ProgressService } from 'cs/workbench/services/progress/browser/progressService';

test('ProgressService presents and closes determinate notification progress', async () => {
	const notifications = new NotificationService();
	const progress = new ProgressService(notifications);
	const deferred = new DeferredPromise<void>();
	try {
		const task = progress.withProgress(
			{ location: ProgressLocation.Notification, title: 'Downloading Agent' },
			reporter => {
				reporter.report({
					message: 'Downloading Agent: 25%',
					worked: 25,
					total: 100,
				});
				return deferred.p;
			},
		);
		const item = notifications.model.notifications[0];
		assert.ok(item);
		assert.equal(item.messageText, 'Downloading Agent: 25%');
		assert.deepStrictEqual(item.progress.state, {
			infinite: true,
			total: 100,
			worked: 25,
			done: false,
		});

		deferred.complete();
		await task;
		assert.deepStrictEqual(notifications.model.notifications, []);
	} finally {
		notifications.dispose();
	}
});
