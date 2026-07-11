/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getComparisonKey } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { Emitter } from 'cs/base/common/event';
import { EditorInputCapabilities } from 'cs/workbench/common/editor';
import type { IEditorSerializer } from 'cs/workbench/common/editor';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { normalizeUrl } from 'cs/workbench/common/url';
import { EmptyPdfEditorUrl, PdfEditorInputScheme } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorResources';
import { Codicon } from 'cs/base/common/codicons';
import { localize } from 'cs/nls';

export interface PdfEditorInputData {
	readonly id: string;
	readonly title: string;
	readonly url: string;
	readonly resource: string;
}

export class PdfEditorInputSerializer implements IEditorSerializer {
	canSerialize(editorInput: EditorInput): editorInput is PdfEditorInput {
		return editorInput instanceof PdfEditorInput;
	}

	serialize(editorInput: EditorInput): string | undefined {
		return this.canSerialize(editorInput)
			? JSON.stringify(editorInput.serialize())
			: undefined;
	}

	deserialize(_instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined {
		const data = JSON.parse(serializedEditor) as PdfEditorInputData;
		return new PdfEditorInput({ ...data, resource: URI.parse(data.resource) });
	}
}

export interface PdfEditorInputOptions {
	readonly id?: string;
	readonly title?: string;
	readonly url?: string;
	readonly resource?: URI;
}

function getPdfEditorTitle(url: string): string {
	if (url === EmptyPdfEditorUrl) {
		return '';
	}
	const uri = URI.parse(url);
	return uri.path.split('/').filter(Boolean).at(-1) ?? uri.authority;
}

export class PdfEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.pdf';
	static readonly EDITOR_ID = 'workbench.editor.pdf';

	private readonly _id: string;
	private _title: string;
	private _url: string;
	private readonly sourceChangeEmitter = this._register(new Emitter<string>());
	readonly resource: URI;
	readonly onDidChangeSource = this.sourceChangeEmitter.event;

	constructor(options: PdfEditorInputOptions = {}) {
		super();
		this._id = options.id ?? generateUuid();
		this._url = normalizeUrl(options.url?.trim() || EmptyPdfEditorUrl);
		this._title = options.title?.trim()
			|| getPdfEditorTitle(this._url);
		this.resource = options.resource ?? URI.from({ scheme: PdfEditorInputScheme, path: this._id });
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

	get url(): string {
		return this._url;
	}

	get typeId(): string {
		return PdfEditorInput.ID;
	}

	get editorId(): string {
		return PdfEditorInput.EDITOR_ID;
	}

	get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return this._title || localize('pdf.untitledLabel', "New PDF");
	}

	override getIcon() {
		return Codicon.filePdf;
	}

	getUrl(): string {
		return this._url;
	}

	override rename(name: string): boolean {
		const nextTitle = name.trim();
		if (!nextTitle || nextTitle === this._title) {
			return false;
		}
		this._title = nextTitle;
		this._onDidChangeLabel.fire();
		return true;
	}

	setSource(url: string, title?: string): void {
		const nextUrl = normalizeUrl(url.trim() || EmptyPdfEditorUrl);
		const nextTitle = title?.trim()
			|| getPdfEditorTitle(nextUrl);
		if (this._url === nextUrl && this._title === nextTitle) {
			return;
		}

		const labelChanged = this._title !== nextTitle;
		this._url = nextUrl;
		this._title = nextTitle;
		this.sourceChangeEmitter.fire(this._url);
		if (labelChanged) {
			this._onDidChangeLabel.fire();
		}
	}

	override matches(otherInput: EditorInput): boolean {
		return otherInput instanceof PdfEditorInput
			&& getComparisonKey(this.resource) === getComparisonKey(otherInput.resource);
	}

	serialize(): PdfEditorInputData {
		return {
			id: this._id,
			title: this._title,
			url: this._url,
			resource: this.resource.toString(),
		};
	}
}
