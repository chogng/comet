/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { isCancellationError } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';
import { EditorPanes, type EditorPanesContext } from 'cs/workbench/browser/parts/editor/editorPanes';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import {
	EditorPaneDescriptor,
	EditorPaneRegistry,
	editorPaneRegistry,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import { getEditorPaneMode } from 'cs/workbench/browser/parts/editor/editorTabsModel';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { ContextKeyServiceImpl, IContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { Emitter } from 'cs/base/common/event';
import { parseSerializedEditorViewState } from 'cs/workbench/browser/parts/editor/editorViewStateStore';

interface ITestEditorPaneService {
	readonly _serviceBrand: undefined;
	readonly value: string;
}

const ITestEditorPaneService = createDecorator<ITestEditorPaneService>('testEditorPaneService');
const testEditorPaneService: ITestEditorPaneService = {
	_serviceBrand: undefined,
	value: 'injected',
};
const paneContextKeyService = new ContextKeyServiceImpl();
const paneInstantiationService = new InstantiationService(new ServiceCollection(
	[ITestEditorPaneService, testEditorPaneService],
	[IContextKeyService, paneContextKeyService],
), true);

after(() => paneInstantiationService.dispose());

class TestEditorInput extends EditorInput {
	constructor(
		readonly resource: URI,
		private readonly preferredPaneId = 'test.editorPaneHost',
	) {
		super();
	}

	get typeId(): string {
		return 'test.editorPaneHostInput';
	}

	override get editorId(): string {
		return this.preferredPaneId;
	}
}

type TestViewState = {
	readonly cursor: number;
};

interface TestSetInputCall {
	readonly input: TestEditorInput;
	readonly options: IEditorOptions | undefined;
	readonly context: IEditorOpenContext;
	readonly token: CancellationToken;
}

class TestEditorPane extends EditorPane<TestEditorInput, TestViewState> {
	readonly element = document.createElement('div');
	readonly setInputCalls: TestSetInputCall[] = [];
	readonly restoreCalls: Array<TestViewState | undefined> = [];
	readonly completions: Array<{ resolve(): void; reject(error: Error): void }> = [];
	viewState: TestViewState | undefined;
	disposeCount = 0;

	getElement(): HTMLElement {
		return this.element;
	}

	setInput(
		input: TestEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		this.setInputCalls.push({ input, options, context, token });
		return new Promise((resolve, reject) => this.completions.push({ resolve, reject }));
	}

	getViewState(): TestViewState | undefined {
		return this.viewState;
	}

	restoreViewState(state: TestViewState | undefined): void {
		this.restoreCalls.push(state);
		this.viewState = state;
	}

	dispose(): void {
		this.disposeCount += 1;
	}
}

class ImmediateTestEditorPane extends EditorPane<TestEditorInput, TestViewState> {
	readonly element = document.createElement('div');
	readonly inputs: TestEditorInput[] = [];
	disposeCount = 0;

	getElement(): HTMLElement {
		return this.element;
	}

	setInput(
		input: TestEditorInput,
		_options: IEditorOptions | undefined,
		_context: IEditorOpenContext,
		_token: CancellationToken,
	): void {
		this.inputs.push(input);
	}

	dispose(): void {
		this.disposeCount += 1;
	}
}

class AsyncCaptureEditorPane extends ImmediateTestEditorPane {
	readonly captures: Array<{
		resolve(state: TestViewState | undefined): void;
		reject(error: Error): void;
	}> = [];

	override captureViewState(): Promise<TestViewState | undefined> {
		return new Promise((resolve, reject) => this.captures.push({ resolve, reject }));
	}
}

class EventedViewStateEditorPane extends ImmediateTestEditorPane {
	private readonly viewStateEmitter = new Emitter<TestViewState>();
	override readonly onDidChangeViewState = this.viewStateEmitter.event;

	setViewState(viewState: TestViewState): void {
		this.viewStateEmitter.fire(viewState);
	}

	override dispose(): void {
		this.viewStateEmitter.dispose();
		super.dispose();
	}
}

class InitializingViewStateEditorPane extends EventedViewStateEditorPane {
	readonly restoreCalls: Array<TestViewState | undefined> = [];

	override async setInput(
		input: TestEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		super.setInput(input, options, context, token);
		await Promise.resolve();
		this.setViewState({ cursor: 99 });
	}

	override restoreViewState(state: TestViewState | undefined): void {
		this.restoreCalls.push(state);
	}
}

function createHostContext(params: {
	readonly groupId?: string;
	readonly entries?: EditorPanesContext['viewStateEntries'];
	readonly savedStates?: Array<{ key: unknown; state: unknown }>;
} = {}): EditorPanesContext {
	return {
		groupId: params.groupId ?? 'pane-host-group',
		visible: true,
		viewStateEntries: params.entries ?? [],
		onDidChangeRuntimeState() {},
		onSetEditorViewState: (key, state) => params.savedStates?.push({ key, state }),
		onDeleteEditorViewState() {},
	};
}

function createHost(contentElement: HTMLElement, context: EditorPanesContext): EditorPanes {
	return paneInstantiationService.createInstance(
		EditorPanes,
		contentElement,
		context,
	);
}

test('group-owned EditorPanes reuses Panes and passes options, context, and cancellation', async () => {
	const first = new TestEditorInput(URI.parse('test:/first'));
	const second = new TestEditorInput(URI.parse('test:/second'));
	const contentElement = document.createElement('div');
	const savedStates: Array<{ key: unknown; state: unknown }> = [];
	const host = createHost(contentElement, createHostContext({ savedStates }));
	let pane: TestEditorPane | undefined;
	let paneCreationCount = 0;
	class RegisteredTestEditorPane extends TestEditorPane {
		constructor(@ITestEditorPaneService readonly paneService: ITestEditorPaneService) {
			super();
			pane = this;
			paneCreationCount += 1;
		}
	}
	const registration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId: 'test.editorPaneHost',
		modeId: 'test',
		contentClassNames: ['test-pane'],
		inputConstructor: TestEditorInput,
		paneConstructor: RegisteredTestEditorPane,
	}));
	const firstOptions = { pinned: true } satisfies IEditorOptions;
	const firstContext = { newInGroup: true } satisfies IEditorOpenContext;

	try {
		assert.equal(getEditorPaneMode(first), 'test');
		const firstOpen = host.openEditor(first, firstOptions, firstContext);
		await Promise.resolve();
		assert.ok(pane);
		assert.equal(paneCreationCount, 1);
		assert.equal((pane as RegisteredTestEditorPane).paneService, testEditorPaneService);
		assert.deepEqual(pane.setInputCalls[0], {
			input: first,
			options: firstOptions,
			context: firstContext,
			token: pane.setInputCalls[0]?.token,
		});
		assert.equal(pane.setInputCalls[0]?.token.isCancellationRequested, false);
		assert.equal(paneContextKeyService.getContextKeyValue('activeEditor'), null);

		pane.viewState = { cursor: 11 };
		const secondContext = { newInGroup: true } satisfies IEditorOpenContext;
		const secondOpen = host.openEditor(second, undefined, secondContext);
		await Promise.resolve();
		assert.equal(paneCreationCount, 1);
		assert.equal(pane.setInputCalls[0]?.token.isCancellationRequested, true);
		pane.completions[0]?.resolve();
		await assert.rejects(firstOpen, error => isCancellationError(error));
		pane.completions[1]?.resolve();
		await secondOpen;
		assert.equal(paneContextKeyService.getContextKeyValue('activeEditor'), second.editorId);
		assert.deepEqual(savedStates.at(-1)?.state, { cursor: 11 });

		pane.viewState = { cursor: 22 };
		const reopened = host.openEditor(first, undefined, { newInGroup: false });
		await Promise.resolve();
		pane.completions[2]?.resolve();
		await reopened;
		assert.equal(paneCreationCount, 1);
		assert.deepEqual(pane.restoreCalls.at(-1), { cursor: 11 });
	} finally {
		host.dispose();
		registration.dispose();
		first.dispose();
		second.dispose();
	}

	assert.equal(pane?.disposeCount, 1);
	assert.equal(paneContextKeyService.getContextKeyValue('activeEditor'), null);
});

test('EditorPanes persists active Pane view-state events synchronously', async () => {
	const input = new TestEditorInput(URI.parse('test:/evented-view-state'), 'test.eventedViewStatePane');
	const savedStates: Array<{ key: unknown; state: unknown }> = [];
	const host = createHost(document.createElement('div'), createHostContext({ savedStates }));
	let pane: EventedViewStateEditorPane | undefined;
	class RegisteredEventedViewStateEditorPane extends EventedViewStateEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const registration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId: 'test.eventedViewStatePane',
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: RegisteredEventedViewStateEditorPane,
	}));

	try {
		await host.openEditor(input, undefined, { newInGroup: true });
		pane?.setViewState({ cursor: 37 });
		assert.deepEqual(savedStates.at(-1), {
			key: {
				groupId: 'pane-host-group',
				paneId: 'test.eventedViewStatePane',
				resourceKey: getEditorInputId(input),
			},
			state: { cursor: 37 },
		});
	} finally {
		host.dispose();
		registration.dispose();
		input.dispose();
	}
});

test('EditorPanes restores persisted state before subscribing to Pane initialization events', async () => {
	const paneId = 'test.initializingViewStatePane';
	const input = new TestEditorInput(URI.parse('test:/initializing-view-state'), paneId);
	const savedStates: Array<{ key: unknown; state: unknown }> = [];
	const key = {
		groupId: 'pane-host-group',
		paneId,
		resourceKey: getEditorInputId(input),
	};
	const host = createHost(document.createElement('div'), createHostContext({
		savedStates,
		entries: [{ key, state: { cursor: 11 } }],
	}));
	let pane: InitializingViewStateEditorPane | undefined;
	class RegisteredInitializingViewStateEditorPane extends InitializingViewStateEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const registration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId,
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: RegisteredInitializingViewStateEditorPane,
	}));

	try {
		const opening = host.openEditor(input, undefined, { newInGroup: true });
		await Promise.resolve();
		host.setContext(createHostContext({
			savedStates,
			entries: [{ key, state: { cursor: 11 } }],
		}));
		await opening;
		assert.deepEqual(pane?.restoreCalls, [{ cursor: 11 }]);
		assert.deepEqual(savedStates, []);

		pane?.setViewState({ cursor: 22 });
		assert.deepEqual(savedStates, [{ key, state: { cursor: 22 } }]);
	} finally {
		host.dispose();
		registration.dispose();
		input.dispose();
	}
});

test('EditorPanes propagates asynchronous setInput errors', async () => {
	const input = new TestEditorInput(URI.parse('test:/failure'), 'test.editorPaneFailure');
	const host = createHost(document.createElement('div'), createHostContext());
	let pane: TestEditorPane | undefined;
	class FailingTestEditorPane extends TestEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const registration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId: 'test.editorPaneFailure',
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: FailingTestEditorPane,
	}));
	const expectedError = new Error('setInput failed');

	try {
		const opening = host.openEditor(input, undefined, { newInGroup: true });
		await Promise.resolve();
		pane?.completions[0]?.reject(expectedError);
		await assert.rejects(opening, expectedError);
	} finally {
		host.dispose();
		registration.dispose();
		input.dispose();
	}
});

test('EditorPanes scopes cached Pane instances to their registered descriptor', async () => {
	const paneId = 'test.editorPaneDescriptorReplacement';
	const first = new TestEditorInput(URI.parse('test:/descriptor-first'), paneId);
	const second = new TestEditorInput(URI.parse('test:/descriptor-second'), paneId);
	const host = createHost(document.createElement('div'), createHostContext());
	let firstPane: ImmediateTestEditorPane | undefined;
	let secondPane: ImmediateTestEditorPane | undefined;
	class FirstRegisteredPane extends ImmediateTestEditorPane {
		constructor() {
			super();
			firstPane = this;
		}
	}
	class SecondRegisteredPane extends ImmediateTestEditorPane {
		constructor() {
			super();
			secondPane = this;
		}
	}
	const firstRegistration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId,
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: FirstRegisteredPane,
	}));
	let secondRegistration: ReturnType<typeof editorPaneRegistry.registerEditorPane> | undefined;

	try {
		await host.openEditor(first, undefined, { newInGroup: true });
		firstRegistration.dispose();
		secondRegistration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
			paneId,
			modeId: 'test',
			contentClassNames: [],
			inputConstructor: TestEditorInput,
			paneConstructor: SecondRegisteredPane,
		}));
		await host.openEditor(second, undefined, { newInGroup: true });

		assert.ok(firstPane);
		assert.ok(secondPane);
		assert.notEqual(firstPane, secondPane);
		assert.deepEqual(firstPane.inputs, [first]);
		assert.deepEqual(secondPane.inputs, [second]);
	} finally {
		host.dispose();
		secondRegistration?.dispose();
		firstRegistration.dispose();
		first.dispose();
		second.dispose();
	}

	assert.equal(firstPane?.disposeCount, 1);
	assert.equal(secondPane?.disposeCount, 1);
});

test('EditorPanes keeps the newest overlapping asynchronous view-state capture', async () => {
	const paneId = 'test.editorPaneAsyncViewState';
	const first = new TestEditorInput(URI.parse('test:/async-state-first'), paneId);
	const second = new TestEditorInput(URI.parse('test:/async-state-second'), paneId);
	const savedStates: Array<{ key: unknown; state: unknown }> = [];
	const host = createHost(
		document.createElement('div'),
		createHostContext({ savedStates }),
	);
	let pane: AsyncCaptureEditorPane | undefined;
	class RegisteredAsyncCaptureEditorPane extends AsyncCaptureEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const registration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId,
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: RegisteredAsyncCaptureEditorPane,
	}));

	try {
		await host.openEditor(first, undefined, { newInGroup: true });
		await host.openEditor(second, undefined, { newInGroup: true });
		await host.openEditor(first, undefined, { newInGroup: false });
		await host.openEditor(second, undefined, { newInGroup: false });

		assert.equal(pane?.captures.length, 3);
		pane?.captures[2]?.resolve({ cursor: 22 });
		pane?.captures[0]?.resolve({ cursor: 11 });
		await host.whenViewStateSettled(getEditorInputId(first));

		assert.deepEqual(
			savedStates.filter(({ key }) =>
				(key as { resourceKey?: string }).resourceKey === getEditorInputId(first),
			),
			[{
				key: {
					groupId: 'pane-host-group',
					paneId,
					resourceKey: getEditorInputId(first),
				},
				state: { cursor: 22 },
			}],
		);
	} finally {
		host.dispose();
		registration.dispose();
		first.dispose();
		second.dispose();
	}
});

test('EditorPanes ignores an asynchronous view-state capture after its group context is replaced', async () => {
	const paneId = 'test.editorPaneReplacedGroupViewState';
	const input = new TestEditorInput(URI.parse('test:/replaced-group-state'), paneId);
	const savedStates: Array<{ key: unknown; state: unknown }> = [];
	const host = createHost(
		document.createElement('div'),
		createHostContext({ groupId: 'first-group', savedStates }),
	);
	let pane: AsyncCaptureEditorPane | undefined;
	class ReplacedGroupAsyncCaptureEditorPane extends AsyncCaptureEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const registration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId,
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: ReplacedGroupAsyncCaptureEditorPane,
	}));

	try {
		await host.openEditor(input, undefined, { newInGroup: true });
		host.setContext(createHostContext({ groupId: 'second-group', savedStates }));
		assert.equal(pane?.captures.length, 1);
		pane?.captures[0]?.resolve({ cursor: 42 });
		await Promise.resolve();
		await Promise.resolve();
		assert.deepEqual(savedStates, []);
	} finally {
		host.dispose();
		registration.dispose();
		input.dispose();
	}
});

test('EditorPaneRegistry uses the input Pane preference when descriptors overlap', () => {
	const registry = new EditorPaneRegistry();
	const input = new TestEditorInput(URI.parse('test:/preferred'), 'preferred-pane');
	const first = new EditorPaneDescriptor({
		paneId: 'other-pane',
		modeId: 'other',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: TestEditorPane,
	});
	const preferred = new EditorPaneDescriptor({
		paneId: 'preferred-pane',
		modeId: 'preferred',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: TestEditorPane,
	});
	const firstRegistration = registry.registerEditorPane(first);
	const preferredRegistration = registry.registerEditorPane(preferred);

	try {
		assert.equal(registry.getEditorPane(input), preferred);
	} finally {
		preferredRegistration.dispose();
		firstRegistration.dispose();
		input.dispose();
	}
});

test('Editor view-state storage accepts only exact current keys and canonical duplicate identity', () => {
	const entry = {
		key: {
			groupId: 'editor-group-main',
			paneId: 'workbench.editor.browser',
			resourceKey: 'vscode-browser:/browser-a',
		},
		state: { url: 'https://example.com', scrollX: 0, scrollY: 960 },
	};
	assert.deepEqual(parseSerializedEditorViewState({ version: 2, entries: [entry] }), {
		entries: [entry],
	});
	assert.throws(
		() => parseSerializedEditorViewState({
			version: 2,
			entries: [entry, {
				key: {
					resourceKey: entry.key.resourceKey,
					paneId: entry.key.paneId,
					groupId: entry.key.groupId,
				},
				state: { scrollY: 20 },
			}],
		}),
		/duplicate key/,
	);
	assert.throws(() => parseSerializedEditorViewState([entry]), /must be an object/);
	assert.throws(
		() => parseSerializedEditorViewState({
			version: 2,
			entries: [{ ...entry, key: { ...entry.key, extra: true } }],
		}),
		/entry is invalid/,
	);
	assert.throws(
		() => parseSerializedEditorViewState({
			version: 2,
			entries: [{ ...entry, key: { ...entry.key, groupId: '' } }],
		}),
		/entry is invalid/,
	);
	assert.throws(
		() => parseSerializedEditorViewState({
			version: 2,
			entries: [{ ...entry, key: { ...entry.key, resourceKey: 'x'.repeat(65_537) } }],
		}),
		/entry is invalid/,
	);
	assert.throws(
		() => parseSerializedEditorViewState({ version: 3, entries: [] }),
		/unsupported schema/,
	);
});
