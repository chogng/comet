import assert from 'node:assert/strict';
import test from 'node:test';

import { Event, EventEmitter } from 'ls/base/common/event';
import { DisposableStore, toDisposable, type DisposableLike } from 'ls/base/common/lifecycle';

test('EventEmitter subscriptions can be individually disposed', () => {
	const emitter = new EventEmitter<number>();
	const events: number[] = [];
	const subscription = emitter.event(value => {
		events.push(value);
	});

	emitter.fire(1);
	subscription.dispose();
	emitter.fire(2);

	assert.deepEqual(events, [1]);
});

test('EventEmitter dispose clears listeners and future subscriptions stay inert', () => {
	const emitter = new EventEmitter<string>();
	const events: string[] = [];

	emitter.event(value => {
		events.push(value);
	});
	emitter.dispose();
	emitter.fire('ignored');

	const lateSubscription = emitter.event(value => {
		events.push(`late:${value}`);
	});
	lateSubscription.dispose();
	emitter.fire('ignored-again');

	assert.deepEqual(events, []);
});

test('EventEmitter fire uses a listener snapshot for stable dispatch', () => {
	const emitter = new EventEmitter<string>();
	const events: string[] = [];
	let secondSubscription: DisposableLike = toDisposable(() => {});
	let lateSubscription: DisposableLike | undefined;

	emitter.event(value => {
		events.push(`first:${value}`);
		secondSubscription.dispose();
		lateSubscription = emitter.event(nextValue => {
			events.push(`late:${nextValue}`);
		});
	});
	secondSubscription = emitter.event(value => {
		events.push(`second:${value}`);
	});

	emitter.fire('one');
	emitter.fire('two');
	lateSubscription?.dispose();

	assert.deepEqual(events, ['first:one', 'second:one', 'first:two', 'late:two']);
});

test('EventEmitter preserves duplicate listener subscriptions', () => {
	const emitter = new EventEmitter<number>();
	const events: number[] = [];
	const listener = (value: number) => {
		events.push(value);
	};

	const firstSubscription = emitter.event(listener);
	emitter.event(listener);

	emitter.fire(1);
	firstSubscription.dispose();
	emitter.fire(2);

	assert.deepEqual(events, [1, 1, 2]);
});

test('EventEmitter supports thisArgs and disposable stores', () => {
	const emitter = new EventEmitter<number>();
	const store = new DisposableStore();
	const receiver = {
		multiplier: 2,
		events: [] as number[],
		record(value: number) {
			this.events.push(value * this.multiplier);
		},
	};

	emitter.event(receiver.record, receiver, store);
	emitter.fire(3);
	store.dispose();
	emitter.fire(4);

	assert.deepEqual(receiver.events, [6]);
});

test('EventEmitter invokes first and last listener hooks', () => {
	const events: string[] = [];
	const emitter = new EventEmitter<number>({
		onWillAddFirstListener: () => {
			events.push('add');
		},
		onDidRemoveLastListener: () => {
			events.push('remove');
		},
	});

	const firstSubscription = emitter.event(() => {});
	const secondSubscription = emitter.event(() => {});

	secondSubscription.dispose();
	assert.deepEqual(events, ['add']);

	firstSubscription.dispose();
	assert.deepEqual(events, ['add', 'remove']);

	const store = new DisposableStore();
	emitter.event(() => {}, undefined, store);
	assert.deepEqual(events, ['add', 'remove', 'add']);

	store.dispose();
	assert.deepEqual(events, ['add', 'remove', 'add', 'remove']);
});

test('EventEmitter dispose invokes last listener hook once', () => {
	const events: string[] = [];
	const emitter = new EventEmitter<number>({
		onWillAddFirstListener: () => {
			events.push('add');
		},
		onDidRemoveLastListener: () => {
			events.push('remove');
		},
	});

	const subscription = emitter.event(() => {});

	emitter.dispose();
	subscription.dispose();

	assert.deepEqual(events, ['add', 'remove']);
});

test('Event.None is inert', () => {
	let didFire = false;

	const subscription = Event.None(() => {
		didFire = true;
	});
	subscription.dispose();

	assert.equal(didFire, false);
});
