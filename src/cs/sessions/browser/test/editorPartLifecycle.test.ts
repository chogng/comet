/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { ContextKeyServiceImpl, IContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { INativeHostService } from 'cs/platform/native/common/native';
import {
	IStorageService,
	type IStorageService as StorageService,
	type IWillSaveStateEvent,
	WillSaveStateReason,
} from 'cs/platform/storage/common/storage';
import { SessionsMainEditorPart } from 'cs/sessions/browser/parts/editor/editorPart';
import { SessionsEditorParts } from 'cs/sessions/browser/parts/editor/editorParts';
import {
	ISessionsLayoutService,
	type SessionsLayoutMode,
} from 'cs/sessions/services/layout/browser/layoutService';
import type {
	ISessionsLayoutState,
} from 'cs/sessions/services/layout/browser/layoutPolicy';
import { getWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import {
	EditorPaneDescriptor,
	editorPaneRegistry,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { IEditorOpenContext, IEditorOptions, IEditorSerializer } from 'cs/workbench/common/editor';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { IBrowserEditorToolbarService } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';

class TestEditorInput extends EditorInput {
	readonly resource = URI.parse('test:/session-editor-lifecycle');

	get typeId(): string {
		return 'test.sessionEditorInput';
	}

	override get editorId(): string {
		return 'test.sessionEditorPane';
	}
}

class TestEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof TestEditorInput;
	}

	serialize(): string {
		return '';
	}

	deserialize(): EditorInput {
		return new TestEditorInput();
	}
}

class TestEditorPane extends EditorPane<TestEditorInput> {
	readonly element = document.createElement('div');
	disposeCount = 0;
	setInputCount = 0;
	readonly visibility: boolean[] = [];
	readonly restoredViewStates: unknown[] = [];
	viewState: unknown;

	constructor() {
		super();
		this.element.dataset.testEditorPane = 'true';
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setInput(
		_input: TestEditorInput,
		_options: IEditorOptions | undefined,
		_context: IEditorOpenContext,
		_token: CancellationToken,
	): void {
		this.setInputCount += 1;
	}

	setVisible(visible: boolean): void {
		this.visibility.push(visible);
	}

	override getViewState(): unknown {
		return this.viewState;
	}

	override restoreViewState(viewState: unknown): void {
		this.restoredViewStates.push(viewState);
		this.viewState = viewState;
	}

	dispose(): void {
		this.disposeCount += 1;
		this.element.remove();
	}
}

class TestSessionsLayoutService implements ISessionsLayoutService {
	declare readonly _serviceBrand: undefined;

	private readonly changeEmitter = new Emitter<ISessionsLayoutState>();
	readonly onDidChangeLayoutState = this.changeEmitter.event;
	private state: ISessionsLayoutState = {
		mode: 'agent',
		isSidebarVisible: true,
		sidebarSize: 260,
		isEditorCollapsed: true,
		expandedEditorSize: 520,
	};

	getLayoutState(): ISessionsLayoutState {
		return this.state;
	}

	setEditorCollapsed(collapsed: boolean, expandedEditorSize?: number): void {
		this.state = {
			...this.state,
			isEditorCollapsed: collapsed,
			expandedEditorSize: expandedEditorSize ?? this.state.expandedEditorSize,
		};
		this.changeEmitter.fire(this.state);
	}

	toggleEditorCollapsed(expandedEditorSize?: number): void {
		this.setEditorCollapsed(!this.state.isEditorCollapsed, expandedEditorSize);
	}

	setViewport(_width: number, _height: number): void {
		throw new Error('Unexpected viewport mutation.');
	}

	applyLayoutMode(_mode: SessionsLayoutMode): void {
		throw new Error('Unexpected layout mode mutation.');
	}

	applyStartupLayoutMode(): boolean {
		return false;
	}

	setPartSizes(): void {
		throw new Error('Unexpected Part size mutation.');
	}

	setSidebarVisible(): void {
		throw new Error('Unexpected Sidebar visibility mutation.');
	}

	setSidebarSize(): void {
		throw new Error('Unexpected Sidebar size mutation.');
	}

	toggleSidebarVisibility(): void {
		throw new Error('Unexpected Sidebar visibility mutation.');
	}
}

function createStorageService(
	onWillSaveState: Event<IWillSaveStateEvent> = Event.None,
	onStore: (key: string, value: string) => void = () => {},
	onGet: (key: string) => string | undefined = () => undefined,
): StorageService {
	return {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState,
		init: async () => {},
		close: async () => {},
		get: (key: string) => onGet(key),
		getBoolean: () => undefined,
		getNumber: () => undefined,
		getObject: () => undefined,
		store(key: string, value: unknown) {
			if (typeof value !== 'string') {
				throw new Error(`Expected string storage value for '${key}'.`);
			}
			onStore(key, value);
		},
		storeAll() {},
		remove() {},
		keys: () => [],
		log() {},
		optimize: async () => {},
		flush: async () => {},
	} as unknown as StorageService;
}

function createInstantiationService(
	layoutService: ISessionsLayoutService,
	storageService: StorageService = createStorageService(),
): InstantiationService {
	const ui = {
		editorHeaderAddAction: 'Add',
		toastClose: 'Close',
		editorTabContextCloseOthers: 'Close Others',
		editorTabContextCloseAll: 'Close All',
		editorTabContextRename: 'Rename',
		editorExpand: 'Expand Editor',
		editorCollapse: 'Collapse Editor',
		editorStatusbarAriaLabel: 'Editor status',
		statusReady: 'Ready',
		emptyState: 'Empty',
		webContentUnavailable: 'Unavailable',
		webContentOverlayPauseHeading: 'Paused',
		webContentOverlayPauseDetail: 'Paused detail',
	} as never;
	const toolbarActions = {
		onOpenSources() {},
		onArchiveCurrentPage() {},
		onExportDocx() {},
		onCopyCurrentUrl() {},
		onClearBrowsingHistory() {},
		onClearCookies() {},
		onClearCache() {},
	};

	return new InstantiationService(new ServiceCollection(
		[IStorageService, storageService],
		[INativeHostService, { canInvoke: () => false } as never],
		[IDialogService, {} as never],
		[IWorkbenchCommandService, { executeCommand: async () => undefined } as never],
		[IContextMenuService, {} as never],
		[IContextViewService, {} as never],
		[IContextKeyService, new ContextKeyServiceImpl()],
		[IWorkbenchLocaleService, {
			getLocale: () => 'en',
			subscribe: () => () => {},
		} as never],
		[IWorkbenchLanguageService, { getLocaleMessages: () => ui } as never],
		[ISessionsLayoutService, layoutService],
		[IBrowserEditorToolbarService, {
			_serviceBrand: undefined,
			actions: toolbarActions,
			setActions() {},
		}],
	), true);
}

test('Sessions registers one EditorParts service with one concrete main Part', () => {
	const editorPartsRegistrations = getSingletonServiceDescriptors()
		.filter(([id]) => id === IEditorGroupsService);

	assert.deepEqual(
		editorPartsRegistrations.map(([, descriptor]) => descriptor.ctor),
		[SessionsEditorParts],
	);
});

test('Sessions Editor Part restores view state during explicit initialization', async () => {
	const layoutService = new TestSessionsLayoutService();
	let storedViewState: string | undefined;
	let viewStateReadCount = 0;
	const storageService = createStorageService(
		Event.None,
		() => {},
		key => {
			if (key !== 'workbench.editor.viewState') {
				return undefined;
			}
			viewStateReadCount += 1;
			return storedViewState;
		},
	);
	const instantiationService = createInstantiationService(layoutService, storageService);
	const editorParts = instantiationService.createInstance(SessionsEditorParts);
	assert.equal(viewStateReadCount, 0);

	editorParts.initialize();
	const input = new TestEditorInput();
	const restoredViewState = { cursor: 71 };
	storedViewState = JSON.stringify({
		version: 2,
		entries: [{
			key: {
				groupId: editorParts.activeGroup.id,
				paneId: input.editorId,
				resourceKey: input.resource.toString(),
			},
			state: restoredViewState,
		}],
	});

	let pane: TestEditorPane | undefined;
	class RegisteredRestoringEditorPane extends TestEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const paneRegistration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId: input.editorId,
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: RegisteredRestoringEditorPane,
	}));
	const serializerRegistration = editorInputSerializerRegistry.register(
		input.typeId,
		new TestEditorInputSerializer(),
	);

	try {
		editorParts.mainPart.initialize();
		assert.equal(viewStateReadCount, 1);
		const openResult = editorParts.openEditor(input);
		await editorParts.mainPart.openEditor(openResult.editor, undefined, { newInGroup: true });
		assert.deepEqual(pane?.restoredViewStates, [restoredViewState]);
	} finally {
		paneRegistration.dispose();
		serializerRegistration.dispose();
		editorParts.dispose();
		instantiationService.dispose();
	}
});

test('Sessions Editor Part preserves its Pane across collapse and expansion', async () => {
	const layoutService = new TestSessionsLayoutService();
	const willSaveStateEmitter = new Emitter<IWillSaveStateEvent>();
	const storedValues = new Map<string, string>();
	const instantiationService = createInstantiationService(
		layoutService,
		createStorageService(
			willSaveStateEmitter.event,
			(key, value) => storedValues.set(key, value),
		),
	);
	const editorParts = instantiationService.createInstance(SessionsEditorParts);
	editorParts.initialize();
	const mainPart = editorParts.mainPart;
	mainPart.initialize();

	let pane: TestEditorPane | undefined;
	class RegisteredTestEditorPane extends TestEditorPane {
		constructor() {
			super();
			pane = this;
		}
	}
	const paneRegistration = editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
		paneId: 'test.sessionEditorPane',
		modeId: 'test',
		contentClassNames: [],
		inputConstructor: TestEditorInput,
		paneConstructor: RegisteredTestEditorPane,
	}));
	const input = new TestEditorInput();
	const serializerRegistration = editorInputSerializerRegistry.register(
		input.typeId,
		new TestEditorInputSerializer(),
	);

	try {
		const openResult = editorParts.openEditor(input);
		await mainPart.openEditor(openResult.editor, undefined, { newInGroup: true });
		const editorElement = mainPart.getElement();
		assert.equal(getWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor), editorElement);
		assert.equal(editorElement.querySelector('[data-test-editor-pane="true"]'), pane?.element);
		const editorFrame = editorElement.querySelector<HTMLElement>('.comet-editor-frame');
		assert.ok(editorFrame);
		assert.deepEqual({
			partType: mainPart instanceof SessionsMainEditorPart,
			setInputCount: pane?.setInputCount,
			visibility: pane?.visibility,
		}, {
			partType: true,
			setInputCount: 1,
			visibility: [false],
		});
		const contextKeyService = instantiationService.invokeFunction(accessor => accessor.get(IContextKeyService));
		editorFrame.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		assert.equal(contextKeyService.getContextKeyValue(ActiveEditorFocusedContext.key), false);

		layoutService.setEditorCollapsed(false);
		editorFrame.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		assert.equal(contextKeyService.getContextKeyValue(ActiveEditorFocusedContext.key), true);
		editorFrame.dispatchEvent(new window.FocusEvent('focusout', {
			bubbles: true,
			relatedTarget: document.body,
		}));
		assert.equal(contextKeyService.getContextKeyValue(ActiveEditorFocusedContext.key), false);
		editorFrame.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
		layoutService.setEditorCollapsed(true);
		assert.equal(contextKeyService.getContextKeyValue(ActiveEditorFocusedContext.key), false);
		mainPart.revealEditor(640);
		if (!pane) {
			throw new Error('Expected the registered Editor Pane to be active.');
		}
		pane.viewState = { cursor: 37 };
		const saveParticipants: Promise<void>[] = [];
		willSaveStateEmitter.fire({
			reason: WillSaveStateReason.SHUTDOWN,
			join: promise => saveParticipants.push(promise),
		});
		await Promise.all(saveParticipants);
		assert.deepEqual(
			JSON.parse(storedValues.get('workbench.editor.viewState') ?? 'null'),
			{
				version: 2,
				entries: [{
					key: {
						groupId: editorParts.activeGroup.id,
						paneId: 'test.sessionEditorPane',
						resourceKey: input.resource.toString(),
					},
					state: { cursor: 37 },
				}],
			},
		);

		assert.deepEqual({
			sameElement: mainPart.getElement() === editorElement,
			samePane: editorElement.querySelector('[data-test-editor-pane="true"]') === pane?.element,
			disposeCount: pane?.disposeCount,
			setInputCount: pane?.setInputCount,
			visibility: pane?.visibility,
			layoutState: layoutService.getLayoutState(),
		}, {
			sameElement: true,
			samePane: true,
			disposeCount: 0,
			setInputCount: 1,
			visibility: [false, true, false, true],
			layoutState: {
				mode: 'agent',
				isSidebarVisible: true,
				sidebarSize: 260,
				isEditorCollapsed: false,
				expandedEditorSize: 640,
			},
		});
	} finally {
		paneRegistration.dispose();
		serializerRegistration.dispose();
		editorParts.dispose();
		instantiationService.dispose();
		willSaveStateEmitter.dispose();
	}

	assert.equal(pane?.disposeCount, 1);
	assert.equal(getWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor), null);
});
