import assert from 'node:assert/strict';
import test from 'node:test';

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
