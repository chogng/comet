/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import { EditorResolverService } from 'cs/workbench/services/editor/browser/editorResolverService';
import type { IEditorOptions } from 'cs/workbench/common/editor';

class TestEditorInput extends EditorInput {
	constructor(
		private readonly inputTypeId: string,
		readonly resource: URI,
	) {
		super();
	}

	get typeId(): string {
		return this.inputTypeId;
	}
}

function registerTestEditor(
	service: EditorResolverService,
	params: {
		readonly globPattern: string;
		readonly id: string;
		readonly priority: RegisteredEditorPriority;
		readonly canSupportResource?: (resource: URI) => boolean;
	},
) {
	return service.registerEditor(
		params.globPattern,
		{
			id: params.id,
			label: params.id,
			priority: params.priority,
		},
		{
			canSupportResource: params.canSupportResource ?? (() => true),
		},
		{
			createEditorInput: ({ resource, options }) => ({
				editor: new TestEditorInput(params.id, resource),
				options,
			}),
		},
	);
}

test('editor resolver resolves resources through scheme glob registrations', () => {
	const service = new EditorResolverService();
	const resource = URI.parse('vscode-browser:/browser-a');
	const options: IEditorOptions = {
		override: 'browser',
		viewState: {
			url: 'https://example.com',
		},
	};

	registerTestEditor(service, {
		globPattern: 'vscode-browser:/**',
		id: 'browser',
		priority: RegisteredEditorPriority.exclusive,
	});

	const resolved = service.resolveEditor({ resource, options });

	assert.equal(resolved?.editor.typeId, 'browser');
	assert.equal(resolved?.editor.resource?.toString(), 'vscode-browser:/browser-a');
	assert.equal(resolved?.options, options);
});

test('editor resolver prefers higher priority registrations', () => {
	const service = new EditorResolverService();
	const resource = URI.parse('vscode-browser:/browser-a');

	registerTestEditor(service, {
		globPattern: 'vscode-browser:/**',
		id: 'builtin-browser',
		priority: RegisteredEditorPriority.builtin,
	});
	registerTestEditor(service, {
		globPattern: 'vscode-browser:/**',
		id: 'exclusive-browser',
		priority: RegisteredEditorPriority.exclusive,
	});

	const resolved = service.resolveEditor({ resource });

	assert.equal(resolved?.editor.typeId, 'exclusive-browser');
});

test('editor resolver prefers a more specific glob when priorities match', () => {
	const service = new EditorResolverService();
	const resource = URI.parse('vscode-browser:/browser-a');

	registerTestEditor(service, {
		globPattern: 'vscode-browser:/**',
		id: 'scheme-browser',
		priority: RegisteredEditorPriority.default,
	});
	registerTestEditor(service, {
		globPattern: resource.toString(),
		id: 'exact-browser',
		priority: RegisteredEditorPriority.default,
	});

	const resolved = service.resolveEditor({ resource });

	assert.equal(resolved?.editor.typeId, 'exact-browser');
});

test('editor resolver unregisters registrations', () => {
	const service = new EditorResolverService();
	const resource = URI.parse('vscode-browser:/browser-a');
	const registration = registerTestEditor(service, {
		globPattern: 'vscode-browser:/**',
		id: 'browser',
		priority: RegisteredEditorPriority.exclusive,
	});

	assert.equal(service.resolveEditor({ resource })?.editor.typeId, 'browser');

	registration.dispose();

	assert.equal(service.resolveEditor({ resource }), undefined);
});

test('editor resolver requires both glob and resource support to match', () => {
	const service = new EditorResolverService();
	const resource = URI.parse('vscode-browser:/browser-a');

	registerTestEditor(service, {
		globPattern: 'vscode-browser:/**',
		id: 'browser',
		priority: RegisteredEditorPriority.exclusive,
		canSupportResource: () => false,
	});

	assert.equal(service.resolveEditor({ resource }), undefined);
});

test('editor resolver honors an explicit editor override', () => {
	const service = new EditorResolverService();
	const resource = URI.parse('test:/resource');
	registerTestEditor(service, {
		globPattern: '*',
		id: 'default-editor',
		priority: RegisteredEditorPriority.default,
	});
	registerTestEditor(service, {
		globPattern: '*',
		id: 'alternate-editor',
		priority: RegisteredEditorPriority.builtin,
	});

	const resolved = service.resolveEditor({
		resource,
		options: { override: 'alternate-editor' },
	});
	assert.equal(resolved?.editor.typeId, 'alternate-editor');
});
