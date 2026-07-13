/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { errorHandler, setUnexpectedErrorHandler } from 'cs/base/common/errors';
import { SessionsSettingsOverlayService } from 'cs/sessions/services/settings/browser/settingsOverlayService';

test('Sessions settings overlay publishes authoritative visibility changes', () => {
	const service = new SessionsSettingsOverlayService();
	const changes: boolean[] = [];
	const listener = service.onDidChangeVisibility(visible => changes.push(visible));

	try {
		assert.equal(service.isVisible(), false);
		service.setVisible(true);
		service.setVisible(true);
		service.toggleVisibility();
		assert.equal(service.isVisible(), false);
		assert.deepEqual(changes, [true, false]);
	} finally {
		listener.dispose();
		service.dispose();
	}
});

test('Sessions settings overlay isolates observer failures after committing visibility', () => {
	const service = new SessionsSettingsOverlayService();
	const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	const errors: unknown[] = [];
	const changes: boolean[] = [];
	setUnexpectedErrorHandler(error => errors.push(error));
	const failingListener = service.onDidChangeVisibility(() => {
		throw new Error('observer failed');
	});
	const succeedingListener = service.onDidChangeVisibility(visible => changes.push(visible));

	try {
		service.setVisible(true);
		assert.equal(service.isVisible(), true);
		assert.equal(errors.length, 1);
		assert.deepEqual(changes, [true]);
	} finally {
		failingListener.dispose();
		succeedingListener.dispose();
		service.dispose();
		setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
	}
});
