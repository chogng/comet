import assert from 'node:assert/strict';
import test from 'node:test';

test('Electron runtime executes inside a real renderer process', () => {
	const rendererGlobal = globalThis as typeof globalThis & {
		__cometUnitBridge: {
			getProcessType(): string;
			report(result: unknown): void;
		};
	};

	assert.equal(rendererGlobal.__cometUnitBridge.getProcessType(), 'renderer');
	assert.equal(typeof rendererGlobal.__cometUnitBridge.report, 'function');
	assert.equal(typeof document.createElement, 'function');
});
