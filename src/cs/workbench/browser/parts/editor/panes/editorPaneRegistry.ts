/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AnyEditorPane, EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

type EditorInputConstructor<TInput extends EditorInput> = abstract new (...args: never[]) => TInput;
export type EditorPaneConstructor<TPane extends AnyEditorPane = AnyEditorPane> = new (...args: never[]) => TPane;

export interface IEditorPaneDescriptor {
	readonly paneId: string;
	readonly modeId: string;
	readonly contentClassNames: readonly string[];
	readonly paneConstructor: EditorPaneConstructor;
	acceptsInput(input: EditorInput): boolean;
}

export interface EditorPaneDescriptorOptions<
	TInput extends EditorInput,
	TPane extends EditorPane<TInput, unknown>,
> {
	readonly paneId: string;
	readonly modeId: string;
	readonly contentClassNames: readonly string[];
	readonly inputConstructor: EditorInputConstructor<TInput>;
	readonly paneConstructor: EditorPaneConstructor<TPane>;
}

export class EditorPaneDescriptor<
	TInput extends EditorInput,
	TPane extends EditorPane<TInput, unknown>,
> implements IEditorPaneDescriptor {
	readonly paneId: string;
	readonly modeId: string;
	readonly contentClassNames: readonly string[];
	readonly paneConstructor: EditorPaneConstructor<TPane>;

	constructor(private readonly options: EditorPaneDescriptorOptions<TInput, TPane>) {
		this.paneId = options.paneId;
		this.modeId = options.modeId;
		this.contentClassNames = options.contentClassNames;
		this.paneConstructor = options.paneConstructor;
	}

	acceptsInput(input: EditorInput): boolean {
		return input instanceof this.options.inputConstructor;
	}
}

export class EditorPaneRegistry {
	private readonly descriptors = new Map<string, IEditorPaneDescriptor>();

	registerEditorPane(descriptor: IEditorPaneDescriptor): IDisposable {
		if (this.descriptors.has(descriptor.paneId)) {
			throw new Error(`Editor pane '${descriptor.paneId}' is already registered.`);
		}
		this.descriptors.set(descriptor.paneId, descriptor);
		return toDisposable(() => {
			if (this.descriptors.get(descriptor.paneId) === descriptor) {
				this.descriptors.delete(descriptor.paneId);
			}
		});
	}

	getEditorPane(input: EditorInput): IEditorPaneDescriptor {
		const matchingDescriptors = [...this.descriptors.values()]
			.filter(descriptor => descriptor.acceptsInput(input));
		if (matchingDescriptors.length === 0) {
			throw new Error(`No editor pane descriptor found for input type '${input.typeId}'.`);
		}
		if (matchingDescriptors.length === 1) {
			return matchingDescriptors[0]!;
		}

		const preferredDescriptors = matchingDescriptors
			.filter(descriptor => descriptor.paneId === input.editorId);
		if (preferredDescriptors.length !== 1) {
			throw new Error(`Multiple editor panes match '${input.typeId}' and no unique preferred pane is registered.`);
		}
		return preferredDescriptors[0]!;
	}
}

export const editorPaneRegistry = new EditorPaneRegistry();
