/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import type { URI } from 'cs/base/common/uri';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';

export const enum DocumentActionsCommandId {
	ExportDraftDocument = 'workbench.action.exportDraftDocument',
}

export interface IArticleSelectionSnapshot {
	readonly resource: URI;
	readonly articleIds: readonly ArticleId[];
}

export interface IDraftDocumentExportSnapshot {
	readonly title: string;
	readonly document: WritingEditorDocument;
	readonly editorDraftStyle?: EditorDraftStyleSettings;
}

export const IDocumentActionsService = createDecorator<IDocumentActionsService>('documentActionsService');

export interface IDocumentActionsService {
	readonly _serviceBrand: undefined;
	openArticleDetails(articleId: ArticleId, articleSelectionResource?: URI): Promise<void>;
	downloadArticlePdf(articleId: ArticleId, articleSelectionResource?: URI): Promise<void>;
	downloadArticlePdfs(selection: IArticleSelectionSnapshot): Promise<void>;
	cancelArticlePdfDownloads(): void;
	exportArticleSummaries(selection: IArticleSelectionSnapshot): Promise<void>;
	exportDraftDocument(snapshot: IDraftDocumentExportSnapshot): Promise<void>;
	dispose(): void;
}
