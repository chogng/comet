/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { SessionWorkbenchContentPartViews, type SessionWorkbenchContentPartViewsProps } from 'cs/sessions/browser/workbenchContentPartViews';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createEditorPaneDescriptor, registerEditorPaneDescriptor } from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import type { EditorPartProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import { EditorGroupModel } from 'cs/workbench/common/editor/editorGroupModel';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';

class TestEditorInput extends EditorInput {
	readonly resource = URI.parse('test:/session-editor-lifecycle');

	get typeId(): string {
		return 'test.sessionEditorInput';
	}
}

class TestEditorPane extends EditorPane<TestEditorInput> {
	readonly element = document.createElement('div');
	disposeCount = 0;
	setInputCount = 0;
	readonly visibility: boolean[] = [];
	input: TestEditorInput | undefined;

	constructor() {
		super();
		this.element.dataset.testEditorPane = 'true';
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setInput(input: TestEditorInput, _token?: CancellationToken): void {
		this.setInputCount += 1;
		this.input = input;
	}

	setVisible(visible: boolean): void {
		this.visibility.push(visible);
	}

	dispose(): void {
		this.disposeCount += 1;
		this.element.remove();
	}
}

function createEditorPartProps(
	group: EditorGroupModel,
	instantiationService: IInstantiationService,
): EditorPartProps {
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
		instantiationService,
		group,
		commandService: {
			executeCommand: async () => undefined,
		} as never,
		viewStateEntries: [],
		onActivateTab() {},
		onCloseTab: () => true,
		onOpenEditor: input => input instanceof EditorInput ? Promise.resolve(input) : undefined,
		onSetEditorViewState() {},
		onDeleteEditorViewState() {},
		contextMenuService: {} as never,
		contextViewProvider: {} as never,
		onOpenSources() {},
	};
}

function createContentPartProps(
	group: EditorGroupModel,
	instantiationService: IInstantiationService,
): SessionWorkbenchContentPartViewsProps {
	return {
		isPrimarySidebarVisible: true,
		isEditorVisible: true,
		sidebarProps: {
			labels: {
				homeTitle: 'Home',
				codeTitle: 'Code',
				homeNavNewChat: 'New Chat',
				homeNavProjects: 'Projects',
				homeNavArtifacts: 'Artifacts',
				homeNavCustomize: 'Customize',
				recentsTitle: 'Recents',
			},
			activeEntry: 'home',
			onActivateEntry() {},
		},
		sessionChatProps: {} as never,
		editorPartProps: createEditorPartProps(group, instantiationService),
		sidebarFooterActionsElement: document.createElement('div'),
		collapsedEditorTitlebarActionsElement: document.createElement('div'),
	};
}

test('collapsing the Sessions Editor Part preserves its Pane instance', () => {
	const group = new EditorGroupModel('session-editor-group');
	const input = new TestEditorInput();
	group.openEditor(input);

	let pane: TestEditorPane | undefined;
	const paneRegistration = registerEditorPaneDescriptor(createEditorPaneDescriptor({
		paneId: 'test.sessionEditorPane',
		contentClassNames: [],
		acceptsInput: (candidate): candidate is TestEditorInput => candidate instanceof TestEditorInput,
		createPane: () => pane = new TestEditorPane(),
	}));
	const sessionsPartElement = document.createElement('section');
	const sessionsPart = {
		getElement: () => sessionsPartElement,
		setProps() {},
		focus() {},
		dispose() {
			sessionsPartElement.remove();
		},
	};
	const instantiationService = {
		createInstance: () => sessionsPart,
	} as unknown as IInstantiationService;
	const props = createContentPartProps(group, instantiationService);
	const collapsedProps = { ...props, isEditorVisible: false };
	const partViews = new SessionWorkbenchContentPartViews(collapsedProps, instantiationService);

	try {
		const editorElement = partViews.getEditorElement();
		assert.ok(editorElement);
		assert.equal(editorElement.querySelector('[data-test-editor-pane="true"]'), pane?.element);
		assert.equal(pane?.setInputCount, 1);
		assert.deepEqual(pane?.visibility, [false]);

		partViews.setProps(props);
		assert.equal(partViews.getEditorElement(), editorElement);
		assert.equal(pane?.disposeCount, 0);
		assert.equal(pane?.setInputCount, 1);
		assert.deepEqual(pane?.visibility, [false, true]);

		partViews.setProps(collapsedProps);
		assert.equal(partViews.getEditorElement(), editorElement);
		assert.equal(editorElement.querySelector('[data-test-editor-pane="true"]'), pane?.element);
		assert.equal(pane?.disposeCount, 0);
		assert.equal(pane?.setInputCount, 1);
		assert.deepEqual(pane?.visibility, [false, true, false]);

		partViews.setProps(props);
		assert.equal(partViews.getEditorElement(), editorElement);
		assert.equal(pane?.setInputCount, 1);
		assert.deepEqual(pane?.visibility, [false, true, false, true]);

		partViews.dispose();
		assert.equal(pane?.disposeCount, 1);
	} finally {
		partViews.dispose();
		paneRegistration.dispose();
		group.dispose();
		input.dispose();
	}
});
