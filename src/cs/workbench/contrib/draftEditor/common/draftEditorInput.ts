/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getComparisonKey } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { Emitter } from 'cs/base/common/event';
import {
	normalizeWritingEditorDocument,
	type WritingEditorDocument,
} from 'cs/editor/common/writingEditorDocument';
import { EditorInputCapabilities } from 'cs/workbench/common/editor';
import type { IEditorSerializer } from 'cs/workbench/common/editor';
import {
	createDecorator,
	type IInstantiationService,
} from 'cs/platform/instantiation/common/instantiation';
import {
	EditorInput,
	type IEditorCloseHandler,
} from 'cs/workbench/common/editor/editorInput';
import { DraftEditorInputScheme } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';
import { Codicon } from 'cs/base/common/codicons';
import { localize } from 'cs/nls';

export const IDraftEditorCloseService = createDecorator<IDraftEditorCloseService>('draftEditorCloseService');

export interface IDraftEditorCloseService {
	readonly _serviceBrand: undefined;
	confirmClose(input: DraftEditorInput): Promise<boolean>;
}

export interface DraftEditorInputData {
	readonly id: string;
	readonly title: string;
	readonly document: WritingEditorDocument;
	readonly resource: string;
}

export class DraftEditorInputSerializer implements IEditorSerializer {
	canSerialize(editorInput: EditorInput): editorInput is DraftEditorInput {
		return editorInput instanceof DraftEditorInput;
	}

	serialize(editorInput: EditorInput): string | undefined {
		return this.canSerialize(editorInput)
			? JSON.stringify(editorInput.serialize())
			: undefined;
	}

	deserialize(instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined {
		const data = JSON.parse(serializedEditor) as DraftEditorInputData;
		return instantiationService.createInstance(DraftEditorInput, {
			id: data.id,
			title: data.title,
			document: data.document,
			resource: URI.parse(data.resource),
		});
	}
}

export interface DraftEditorInputOptions extends Partial<Omit<DraftEditorInputData, 'document' | 'resource'>> {
	readonly document: WritingEditorDocument;
	readonly resource?: URI;
}

/** Stable coordinates captured by the Draft Pane for its current selection. */
export interface DraftEditorSelectionSnapshot {
	readonly blockId: string;
	readonly startOffset: number;
	readonly endOffset: number;
}

function createDocumentKey(document: WritingEditorDocument): string {
	return JSON.stringify(normalizeWritingEditorDocument(document));
}

export class DraftEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.draft';
	static readonly EDITOR_ID = 'workbench.editor.draft';

	private readonly _id: string;
	private _title: string;
	private _document: WritingEditorDocument;
	private savedTitle: string;
	private savedDocumentKey: string;
	private paneSelectionSnapshot: DraftEditorSelectionSnapshot | null | undefined;
	private readonly documentChangeEmitter = this._register(new Emitter<WritingEditorDocument>());
	readonly resource: URI;
	readonly closeHandler: IEditorCloseHandler;
	readonly onDidChangeDocument = this.documentChangeEmitter.event;

	constructor(
		options: DraftEditorInputOptions,
		@IDraftEditorCloseService closeService: IDraftEditorCloseService,
	) {
		super();
		this._id = options.id ?? generateUuid();
		this._title = options.title?.trim() ?? '';
		this._document = normalizeWritingEditorDocument(options.document);
		this.savedTitle = this._title;
		this.savedDocumentKey = createDocumentKey(this._document);
		this.resource = options.resource ?? URI.from({ scheme: DraftEditorInputScheme, path: this._id });
		this.closeHandler = {
			confirmClose: async () => {
				if (!this.isDirty()) {
					return true;
				}
				return closeService.confirmClose(this);
			},
		};
	}

	get inputId(): string {
		return this._id;
	}

	get id(): string {
		return this._id;
	}

	get title(): string {
		return this._title;
	}

	get document(): WritingEditorDocument {
		return this._document;
	}

	get typeId(): string {
		return DraftEditorInput.ID;
	}

	get editorId(): string {
		return DraftEditorInput.EDITOR_ID;
	}

	get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Untitled;
	}

	override getName(): string {
		return this._title || localize('draft.untitledLabel', "Untitled Draft");
	}

	override getIcon() {
		return Codicon.edit;
	}

	getTitleValue(): string {
		return this._title;
	}

	getDocument(): WritingEditorDocument {
		return this._document;
	}

	getPaneSelectionSnapshot(): DraftEditorSelectionSnapshot | null | undefined {
		return this.paneSelectionSnapshot
			? { ...this.paneSelectionSnapshot }
			: this.paneSelectionSnapshot;
	}

	setPaneSelectionSnapshot(selection: DraftEditorSelectionSnapshot | null): void {
		this.paneSelectionSnapshot = selection ? { ...selection } : null;
	}

	clearPaneSelectionSnapshot(): void {
		this.paneSelectionSnapshot = undefined;
	}

	setTitle(title: string): void {
		const nextTitle = title.trim();
		if (this._title === nextTitle) {
			return;
		}
		const wasDirty = this.isDirty();
		this._title = nextTitle;
		this._onDidChangeLabel.fire();
		if (wasDirty !== this.isDirty()) {
			this._onDidChangeDirty.fire();
		}
	}

	override rename(name: string): boolean {
		this.setTitle(name);
		return true;
	}

	setDocument(document: WritingEditorDocument): void {
		const nextDocument = normalizeWritingEditorDocument(document);
		if (createDocumentKey(this._document) === createDocumentKey(nextDocument)) {
			return;
		}
		const wasDirty = this.isDirty();
		this._document = nextDocument;
		this.documentChangeEmitter.fire(this._document);
		if (wasDirty !== this.isDirty()) {
			this._onDidChangeDirty.fire();
		}
	}

	override isDirty(): boolean {
		return this._title !== this.savedTitle || createDocumentKey(this._document) !== this.savedDocumentKey;
	}

	override async save(): Promise<boolean> {
		const wasDirty = this.isDirty();
		this.savedTitle = this._title;
		this.savedDocumentKey = createDocumentKey(this._document);
		if (wasDirty) {
			this._onDidChangeDirty.fire();
		}
		return true;
	}

	override matches(otherInput: EditorInput): boolean {
		return otherInput instanceof DraftEditorInput
			&& getComparisonKey(this.resource) === getComparisonKey(otherInput.resource);
	}

	serialize(): DraftEditorInputData {
		return {
			id: this._id,
			title: this._title,
			document: this._document,
			resource: this.resource.toString(),
		};
	}
}
