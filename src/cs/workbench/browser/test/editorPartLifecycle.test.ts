/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import type { IStorageService } from 'cs/platform/storage/common/storage';
import { PdfEditorInput, PdfEditorInputSerializer } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorGroupsService } from 'cs/workbench/services/editor/browser/editorGroupsService';
import {
	IEditorGroupsService,
	type IEditorPartHost,
} from 'cs/workbench/services/editor/common/editorGroupsService';
import { EditorService } from 'cs/workbench/services/editor/browser/editorService';
import type { IEditorOpenContext, IEditorOptions, IEditorPane } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

function createStorageService(): IStorageService {
	return {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: Event.None,
		init: async () => {},
		close: async () => {},
		get: () => undefined,
		getBoolean: () => undefined,
		getNumber: () => undefined,
		getObject: () => undefined,
		store() {},
		storeAll() {},
		remove() {},
		keys: () => [],
		log() {},
		optimize: async () => {},
		flush: async () => {},
	} as unknown as IStorageService;
}

class TestEditorParts extends EditorGroupsService {
	readonly mainPart: IEditorPartHost;

	constructor(
		storageService: IStorageService,
		instantiationService: InstantiationService,
		revealEditor: (expandedEditorSize?: number) => void,
		openEditor: (
			editor: EditorInput,
			options: IEditorOptions | undefined,
			context: IEditorOpenContext,
		) => Promise<void> = async () => {},
		activeEditorPane: IEditorPane | undefined = undefined,
	) {
		super(storageService, instantiationService);
		this.mainPart = {
			activeEditorPane,
			openEditor,
			revealEditor,
			focusPrimaryInput() {},
		};
	}
}

test('Workbench foundation does not register a product Editor groups service', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === IEditorGroupsService);
	assert.equal(registrations.length, 0);
});

test('EditorService sends typed and untyped inputs through one group path and reveals deterministically', async () => {
	let resolveCount = 0;
	const revealCalls: Array<number | undefined> = [];
	const paneOpenCalls: Array<{
		editor: EditorInput;
		options: IEditorOptions | undefined;
		context: IEditorOpenContext;
	}> = [];
	const serializerRegistration = editorInputSerializerRegistry.register(
		PdfEditorInput.ID,
		new PdfEditorInputSerializer(),
	);
	const instantiationService = new InstantiationService(new ServiceCollection());
	const storageService = createStorageService();
	const activeEditorPane: IEditorPane = { focus() {} };
	const editorGroupsService = new TestEditorParts(
		storageService,
		instantiationService,
		expandedEditorSize => revealCalls.push(expandedEditorSize),
		async (editor, editorOptions, context) => {
			paneOpenCalls.push({ editor, options: editorOptions, context });
		},
		activeEditorPane,
	);
	editorGroupsService.initialize();
	const editorService = new EditorService(
		editorGroupsService,
		{
			resolveEditor: ({ resource }: { resource: URI }) => {
				resolveCount += 1;
				return {
					editor: new PdfEditorInput({ resource }),
					options: { pinned: true },
				};
			},
		} as never,
	);

	assert.equal(editorGroupsService.activeGroup.count, 0);
	assert.equal(resolveCount, 0);

	const typedInput = new PdfEditorInput({ resource: URI.parse('test:/typed-editor') });
	const typedOptions = { viewState: { url: 'https://example.com/typed.pdf' } } satisfies IEditorOptions;
	const openedTyped = await editorService.openEditor(typedInput, {
		editorOptions: typedOptions,
		context: { newInGroup: false },
	});
	assert.equal(openedTyped, typedInput);
	assert.equal(editorService.activeEditor, typedInput);
	assert.equal(editorService.activeEditorPane, activeEditorPane);
	assert.equal(resolveCount, 0);
	assert.deepEqual(revealCalls, [undefined]);
	assert.deepEqual(paneOpenCalls[0], {
		editor: typedInput,
		options: typedOptions,
		context: { newInGroup: true },
	});

	const openedUntyped = await editorService.openEditor({ resource: URI.parse('test:/untyped-editor') });
	assert.equal(resolveCount, 1);
	assert.equal(editorGroupsService.activeGroup.count, 2);
	assert.equal(editorGroupsService.activeGroup.activeEditor, openedUntyped);
	assert.deepEqual(revealCalls, [undefined, undefined]);
	assert.deepEqual(paneOpenCalls[1], {
		editor: openedUntyped,
		options: { pinned: true },
		context: { newInGroup: true },
	});
	editorGroupsService.dispose();
	serializerRegistration.dispose();
	instantiationService.dispose();
});

test('EditorService propagates asynchronous Pane input errors', async () => {
	const expectedError = new Error('Pane input failed');
	const serializerRegistration = editorInputSerializerRegistry.register(
		PdfEditorInput.ID,
		new PdfEditorInputSerializer(),
	);
	const instantiationService = new InstantiationService(new ServiceCollection());
	const editorGroupsService = new TestEditorParts(
		createStorageService(),
		instantiationService,
		() => {},
		async () => { throw expectedError; },
	);
	editorGroupsService.initialize();
	const editorService = new EditorService(editorGroupsService, {} as never);
	const input = new PdfEditorInput({ resource: URI.parse('test:/pane-error') });

	try {
		await assert.rejects(editorService.openEditor(input), expectedError);
		assert.equal(editorGroupsService.activeGroup.activeEditor, input);
	} finally {
		editorGroupsService.dispose();
		serializerRegistration.dispose();
		instantiationService.dispose();
	}
});
