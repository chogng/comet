/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DisposableHandle, IDisposable } from 'cs/base/common/lifecycle';
import { EventEmitter } from 'cs/base/common/event';
import {
	areEditorDraftStyleCatalogSnapshotsEqual,
	getEditorDraftStyleCatalogSnapshot,
	normalizeEditorDraftStyleCatalogSnapshot,
	type EditorDraftStyleCatalogSnapshot,
} from 'cs/editor/browser/services/editorDraftStyleCatalog';
import type {
	EditorDraftDefaultBodyStyle,
	EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export type EditorDraftStyleServiceSnapshot = EditorDraftStyleCatalogSnapshot;
type EditorDraftStyleServiceInput = EditorDraftStyleSettings | EditorDraftStyleCatalogSnapshot;

export interface IEditorDraftStyleService {
	readonly _serviceBrand: undefined;
	getSnapshot(): EditorDraftStyleServiceSnapshot;
	subscribe(listener: () => void): DisposableHandle;
	setSnapshot(nextSnapshot: EditorDraftStyleServiceInput): void;
	setDefaultBodyStyle(nextDefaultBodyStyle: EditorDraftDefaultBodyStyle): void;
}

export const IEditorDraftStyleService = createDecorator<IEditorDraftStyleService>('editorDraftStyleService');

export class EditorDraftStyleService implements IEditorDraftStyleService, IDisposable {
	declare readonly _serviceBrand: undefined;

	private snapshot: EditorDraftStyleServiceSnapshot;
	private readonly onDidChangeEmitter = new EventEmitter<void>();

	constructor(
		initialSnapshot: EditorDraftStyleServiceInput = getEditorDraftStyleCatalogSnapshot(),
	) {
		this.snapshot = normalizeEditorDraftStyleCatalogSnapshot(initialSnapshot);
	}

	getSnapshot() {
		return this.snapshot;
	}

	subscribe(listener: () => void) {
		return this.onDidChangeEmitter.event(listener);
	}

	setSnapshot(nextSnapshot: EditorDraftStyleServiceInput) {
		const normalizedSnapshot = normalizeEditorDraftStyleCatalogSnapshot(nextSnapshot);
		if (areEditorDraftStyleCatalogSnapshotsEqual(this.snapshot, normalizedSnapshot)) {
			return;
		}

		this.snapshot = normalizedSnapshot;
		this.onDidChangeEmitter.fire();
	}

	setDefaultBodyStyle(nextDefaultBodyStyle: EditorDraftDefaultBodyStyle) {
		this.setSnapshot({
			...this.snapshot,
			defaultBodyStyle: {
				fontFamilyValue: nextDefaultBodyStyle.fontFamilyValue,
				fontSizeValue: nextDefaultBodyStyle.fontSizeValue,
				lineHeight: nextDefaultBodyStyle.lineHeight,
				paragraphSpacingBeforePt: nextDefaultBodyStyle.paragraphSpacingBeforePt,
				paragraphSpacingAfterPt: nextDefaultBodyStyle.paragraphSpacingAfterPt,
				color: nextDefaultBodyStyle.color,
				inlineStyleDefaults: {
					bold: nextDefaultBodyStyle.inlineStyleDefaults.bold,
					italic: nextDefaultBodyStyle.inlineStyleDefaults.italic,
					underline: nextDefaultBodyStyle.inlineStyleDefaults.underline,
				},
			},
		});
	}

	dispose() {
		this.onDidChangeEmitter.dispose();
	}
}

registerSingleton(
	IEditorDraftStyleService,
	EditorDraftStyleService,
	InstantiationType.Delayed,
);
