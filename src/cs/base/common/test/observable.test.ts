/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { errorHandler } from 'cs/base/common/errors';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { autorun, derived, observableValue } from 'cs/base/common/observable';

test('autorun tracks observable and derived changes', () => {
	const source = observableValue('source', 1);
	const doubled = derived(reader => source.read(reader) * 2);
	const seen: number[] = [];

	const disposable = autorun(reader => {
		seen.push(doubled.read(reader));
	});

	source.set(2, undefined);
	source.set(2, undefined);

	assert.deepEqual(seen, [2, 4]);

	disposable.dispose();
	source.set(3, undefined);

	assert.deepEqual(seen, [2, 4]);
});

test('autorun disposes store before rerun and delayedStore after rerun', () => {
	const source = observableValue('source', 'first');
	const log: string[] = [];

	const disposable = autorun(reader => {
		const value = source.read(reader);
		log.push(`run:${value}`);
		reader.store.add({
			dispose() {
				log.push(`store:${value}`);
			},
		});
		reader.delayedStore.add({
			dispose() {
				log.push(`delayed:${value}`);
			},
		});
	});

	source.set('second', undefined);

	assert.deepEqual(log, ['run:first', 'store:first', 'run:second', 'delayed:first']);

	disposable.dispose();

	assert.deepEqual(log, ['run:first', 'store:first', 'run:second', 'delayed:first', 'store:second', 'delayed:second']);
});

test('observable changes report observer errors and continue every downstream observer', () => {
	const store = new DisposableStore();
	const unexpectedErrors: unknown[] = [];
	const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	errorHandler.setUnexpectedErrorHandler(error => unexpectedErrors.push(error));

	try {
		const directSource = observableValue('directSource', 1);
		const directError = new Error('Direct observable observer failed.');
		store.add(autorun(reader => {
			if (directSource.read(reader) === 2) {
				throw directError;
			}
		}));
		const directSeen: number[] = [];
		store.add(autorun(reader => directSeen.push(directSource.read(reader))));

		const derivedSource = observableValue('derivedSource', 1);
		const doubled = derived(reader => derivedSource.read(reader) * 2);
		const derivedError = new Error('Derived observable observer failed.');
		store.add(autorun(reader => {
			if (doubled.read(reader) === 4) {
				throw derivedError;
			}
		}));
		const derivedSeen: number[] = [];
		store.add(autorun(reader => derivedSeen.push(doubled.read(reader))));

		directSource.set(2, undefined);
		derivedSource.set(2, undefined);

		assert.deepEqual({
			directSeen,
			derivedSeen,
			unexpectedErrors,
		}, {
			directSeen: [1, 2],
			derivedSeen: [2, 4],
			unexpectedErrors: [directError, derivedError],
		});
	} finally {
		try {
			store.dispose();
		} finally {
			errorHandler.setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
		}
	}
});
