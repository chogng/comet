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
import { createEditorPartController, type EditorPartControllerContext } from 'cs/workbench/browser/parts/editor/editorPart';
import { PdfEditorInput, PdfEditorInputSerializer } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorGroupsService } from 'cs/workbench/services/editor/browser/editorGroupsService';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { EditorService } from 'cs/workbench/services/editor/browser/editorService';

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

test('Workbench registers exactly one Editor groups service', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === IEditorGroupsService);
	assert.equal(registrations.length, 1);
});

test('EditorService sends typed and untyped inputs through one group path and reveals deterministically', async () => {
	let resolveCount = 0;
	let isEditorCollapsed = true;
	const revealCalls: Array<{ collapsed: boolean; expandedEditorSize: number | undefined }> = [];
	const serializerRegistration = editorInputSerializerRegistry.register(
		PdfEditorInput.ID,
		new PdfEditorInputSerializer(),
	);
	const instantiationService = new InstantiationService(new ServiceCollection());
	const storageService = createStorageService();
	const editorGroupsService = new EditorGroupsService(storageService, instantiationService);
	const editorService = new EditorService(
		editorGroupsService,
		{
			resolveEditor: ({ resource }: { resource: URI }) => {
				resolveCount += 1;
				return { editor: new PdfEditorInput({ resource }) };
			},
		} as never,
		{
			getLayoutState: () => ({ isEditorCollapsed, expandedEditorSize: 420 }),
			setEditorCollapsed(collapsed: boolean, expandedEditorSize?: number) {
				isEditorCollapsed = collapsed;
				revealCalls.push({ collapsed, expandedEditorSize });
			},
		} as never,
	);
	const context = {
		ui: {},
		viewPartProps: {},
		nativeHost: {},
		dialogService: {},
		instantiationService,
		editorGroupsService,
		editorService,
		storageService,
		commandService: {},
	} as unknown as EditorPartControllerContext;
	const controller = createEditorPartController(context);

	assert.equal(controller.getSnapshot().group.count, 0);
	assert.equal(resolveCount, 0);

	const typedInput = new PdfEditorInput({ resource: URI.parse('test:/typed-editor') });
	const openedTyped = await editorService.openEditor(typedInput);
	assert.equal(openedTyped, typedInput);
	assert.equal(resolveCount, 0);
	assert.deepEqual(revealCalls, [{ collapsed: false, expandedEditorSize: 420 }]);

	isEditorCollapsed = true;
	const openedUntyped = await editorService.openEditor({ resource: URI.parse('test:/untyped-editor') });
	assert.equal(resolveCount, 1);
	assert.equal(controller.getSnapshot().group.count, 2);
	assert.equal(controller.getSnapshot().group.activeEditor, openedUntyped);
	assert.deepEqual(revealCalls, [
		{ collapsed: false, expandedEditorSize: 420 },
		{ collapsed: false, expandedEditorSize: 420 },
	]);
	controller.dispose();
	editorGroupsService.dispose();
	serializerRegistration.dispose();
	instantiationService.dispose();
});
