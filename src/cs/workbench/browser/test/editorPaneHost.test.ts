/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { EditorGroupView, type EditorGroupViewProps } from 'cs/workbench/browser/parts/editor/editorGroupView';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createEditorPaneDescriptor, registerEditorPaneDescriptor } from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { EditorGroupModel } from 'cs/workbench/common/editor/editorGroupModel';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';

class TestEditorInput extends EditorInput {
	constructor(readonly resource: URI) {
		super();
	}

	get typeId(): string {
		return 'test.editorPaneHostInput';
	}
}

type TestViewState = {
	readonly cursor: number;
};

class TestEditorPane extends EditorPane<TestEditorInput, TestViewState> {
	readonly element = document.createElement('div');
	readonly inputs: TestEditorInput[] = [];
	readonly tokens: CancellationToken[] = [];
	readonly restoreCalls: Array<TestViewState | undefined> = [];
	readonly completions: Array<() => void> = [];
	viewState: TestViewState | undefined;
	disposeCount = 0;

	getElement(): HTMLElement {
		return this.element;
	}

	setInput(input: TestEditorInput, token?: CancellationToken): Promise<void> {
		assert.ok(token);
		this.inputs.push(input);
		this.tokens.push(token);
		return new Promise(resolve => this.completions.push(resolve));
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

function createViewProps(group: EditorGroupModel): EditorGroupViewProps {
	return {
		ui: {} as never,
		labels: {
			headerAddAction: 'Add',
			close: 'Close',
			closeOthers: 'Close Others',
			closeAll: 'Close All',
			rename: 'Rename',
			expandEditor: 'Expand Editor',
			collapseEditor: 'Collapse Editor',
			status: {
				statusbarAriaLabel: 'Editor status',
				ready: 'Ready',
			},
		},
		creationActions: [],
		viewPartProps: {
			browserUrl: '',
			electronRuntime: false,
			webContentRuntime: false,
			labels: {
				emptyState: 'Empty',
				contentUnavailable: 'Unavailable',
				overlayPauseHeading: 'Paused',
				overlayPauseDetail: 'Paused detail',
			},
		},
		nativeHost: {} as never,
		dialogService: {} as never,
		instantiationService: {} as IInstantiationService,
		group,
		viewStateEntries: [],
		onActivateTab() {},
		onCloseTab: () => true,
		onOpenEditor: input => input instanceof EditorInput ? Promise.resolve(input) : undefined,
		commandService: {
			executeCommand: async () => undefined,
		} as never,
		onOpenSources() {},
		onSetEditorViewState() {},
		onDeleteEditorViewState() {},
		contextMenuService: {} as never,
		contextViewProvider: {} as never,
	};
}

test('group-owned Pane host reuses Panes, cancels stale input, and restores per-resource view state', async () => {
	const first = new TestEditorInput(URI.parse('test:/first'));
	const second = new TestEditorInput(URI.parse('test:/second'));
	const group = new EditorGroupModel('pane-host-group');
	group.openEditor(first);

	let pane: TestEditorPane | undefined;
	let paneCreationCount = 0;
	const registration = registerEditorPaneDescriptor(createEditorPaneDescriptor({
		paneId: 'test.editorPaneHost',
		contentClassNames: [],
		acceptsInput: (input): input is TestEditorInput => input instanceof TestEditorInput,
		createPane: () => {
			paneCreationCount += 1;
			pane = new TestEditorPane();
			return pane;
		},
	}));
	const view = new EditorGroupView(createViewProps(group));
	let viewDisposed = false;

	try {
		assert.ok(pane);
		assert.equal(paneCreationCount, 1);
		assert.deepEqual(pane.inputs, [first]);
		assert.equal(pane.tokens[0]?.isCancellationRequested, false);
		view.setProps(createViewProps(group));
		assert.deepEqual(pane.inputs, [first]);
		assert.equal(pane.tokens[0]?.isCancellationRequested, false);

		pane.viewState = { cursor: 11 };
		group.openEditor(second);
		view.setProps(createViewProps(group));
		assert.equal(paneCreationCount, 1);
		assert.deepEqual(pane.inputs, [first, second]);
		assert.equal(pane.tokens[0]?.isCancellationRequested, true);

		pane.viewState = { cursor: 22 };
		group.setActive(first);
		view.setProps(createViewProps(group));
		assert.equal(paneCreationCount, 1);
		assert.deepEqual(pane.inputs, [first, second, first]);
		assert.equal(pane.tokens[1]?.isCancellationRequested, true);
		assert.deepEqual(pane.restoreCalls.at(-1), { cursor: 11 });

		pane.completions[0]?.();
		pane.completions[1]?.();
		await Promise.resolve();

		view.dispose();
		viewDisposed = true;
		assert.equal(pane.tokens[2]?.isCancellationRequested, true);
		assert.equal(pane.disposeCount, 1);
		pane.completions[2]?.();
		await Promise.resolve();
	} finally {
		if (!viewDisposed) {
			view.dispose();
		}
		registration.dispose();
		group.dispose();
		first.dispose();
		second.dispose();
	}
});
