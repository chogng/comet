/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { EditorDraftDefaultBodyStyle } from 'cs/base/common/editorDraftStyle';
import {
	areEditorDraftStyleCatalogSnapshotsEqual,
	getEditorDraftStyleCatalogSnapshot,
	normalizeEditorDraftStyleCatalogSnapshot,
} from 'cs/editor/browser/services/editorDraftStyleCatalog';
import type {
	EditorDraftStyleServiceInput,
	EditorDraftStyleServiceSnapshot,
	IEditorDraftStyleService,
} from 'cs/editor/common/services/editorDraftStyleService';

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
