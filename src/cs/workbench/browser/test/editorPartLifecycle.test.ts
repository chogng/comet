/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import type { IStorageService } from 'cs/platform/storage/common/storage';
import { createEditorPartController, type EditorPartControllerContext } from 'cs/workbench/browser/parts/editor/editorPart';
import { PdfEditorInput, PdfEditorInputSerializer } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorGroupsService } from 'cs/workbench/services/editor/browser/editorGroupsService';

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

test('EditorPart starts with an empty generic group and resolves inputs only when opened', async () => {
	let resolveCount = 0;
	const serializerRegistration = editorInputSerializerRegistry.register(
		PdfEditorInput.ID,
		new PdfEditorInputSerializer(),
	);
	const instantiationService = new InstantiationService(new ServiceCollection());
	const storageService = createStorageService();
	const editorGroupsService = new EditorGroupsService(storageService, instantiationService);
	const context = {
		ui: {},
		viewPartProps: {},
		nativeHost: {},
		dialogService: {},
		instantiationService,
		editorResolverService: {
			resolveEditor: ({ resource }: { resource: URI }) => {
				resolveCount += 1;
				return { editor: new PdfEditorInput({ resource }) };
			},
		},
		editorGroupsService,
		storageService,
		commandService: {},
		ensureEditorPartVisible() {},
	} as unknown as EditorPartControllerContext;
	const controller = createEditorPartController(context);

	assert.equal(controller.getSnapshot().group.count, 0);
	assert.equal(resolveCount, 0);
	const opened = await controller.openEditor({ resource: URI.parse('test:/editor-a') });
	assert.equal(resolveCount, 1);
	assert.equal(controller.getSnapshot().group.activeEditor, opened);
	controller.dispose();
	editorGroupsService.dispose();
	serializerRegistration.dispose();
	instantiationService.dispose();
});
