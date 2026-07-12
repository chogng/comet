/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { cloneEditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import { parseAppErrorData } from 'cs/base/parts/sandbox/common/appError';
import { generateUuid } from 'cs/base/common/uuid';
import { normalizeWritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { INativeHostService } from 'cs/platform/native/common/native';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { formatLocaleMessage, localizeAppError } from 'cs/workbench/common/errorMessages';
import {
	IArticleSummaryTranslationExportService,
	type IArticleSummaryTranslationExportService as IArticleSummaryTranslationExportServiceContract,
} from 'cs/workbench/contrib/translation/common/articleSummaryTranslationExport';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	IDocumentActionsService,
	type IArticleSelectionSnapshot,
	type IDraftDocumentExportSnapshot,
} from 'cs/workbench/services/document/common/documentActions';
import {
	preparePdfDownload,
	resolvePreferredDirectory,
} from 'cs/workbench/services/document/documentActionService';
import {
	markPdfDownloadCancelled,
	markPdfDownloadFailed,
	markPdfDownloadStarted,
	markPdfDownloadSucceeded,
} from 'cs/workbench/services/document/pdfDownloadStatus';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	IFetchService,
	type ArticleDetail,
	type ArticleId,
} from 'cs/workbench/services/fetch/common/fetch';
import {
	ILibraryModel,
	LibraryModel,
} from 'cs/workbench/services/knowledgeBase/libraryModel';
import { syncLibraryMetadataFromArticle } from 'cs/workbench/services/knowledgeBase/libraryMetadataService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISettingsModel, SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import type { LocaleMessages } from 'language/locales';

type DocumentDownloadTask = {
	readonly taskId: string;
	readonly source: CancellationTokenSource;
};

type ArticlePdfDownloadContext = {
	readonly lifecycle: number;
	readonly knowledgeBaseEnabled: boolean;
	readonly pdfDownloadDir: string;
	readonly knowledgeBasePdfDownloadDir: string;
	readonly pdfFileNameUseSelectionOrder: boolean;
};

type ArticlePdfDownloadOptions = {
	readonly context: ArticlePdfDownloadContext;
	readonly taskId?: string;
	readonly token?: CancellationToken;
	readonly order?: number;
	readonly articleSelectionResource?: IArticleSelectionSnapshot['resource'];
};

function buildDownloadArticleTitle(article: ArticleDetail, order: number | undefined) {
	return typeof order === 'number' ? `${order}. ${article.title}` : article.title;
}

function isScienceValidationWindowClosedCancel(error: ReturnType<typeof parseAppErrorData>) {
	return (
		error.code === 'PDF_DOWNLOAD_FAILED' &&
		String(error.details?.status ?? '').toUpperCase() === 'SCIENCE_VALIDATION_REQUIRED' &&
		String(error.details?.statusText ?? '') ===
			'Science validation window was closed before verification completed.'
	);
}

function isDesktopCancellation(error: ReturnType<typeof parseAppErrorData>) {
	return error.message === 'Canceled' || error.details?.message === 'Canceled';
}

let documentBatchTaskCounter = 0;

function createDocumentBatchTaskId() {
	documentBatchTaskCounter += 1;
	return `document-batch-${Date.now()}-${documentBatchTaskCounter}`;
}

export class DocumentActionsService implements IDocumentActionsService {
	declare readonly _serviceBrand: undefined;

	private sciencePdfDownloadCount = 0;
	private currentDownloadTask: DocumentDownloadTask | undefined;
	private disposed = false;
	private lifecycle = 0;

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@ISettingsModel private readonly settingsModel: SettingsModel,
		@IFetchService private readonly fetchService: IFetchService,
		@IEditorService private readonly editorService: IEditorService,
		@IChatService private readonly chatService: IChatService,
		@ILibraryModel private readonly libraryModel: LibraryModel,
		@IArticleSummaryTranslationExportService
		private readonly articleSummaryTranslationExportService: IArticleSummaryTranslationExportServiceContract,
	) {}

	async openArticleDetails(
		articleId: ArticleId,
		articleSelectionResource?: IArticleSelectionSnapshot['resource'],
	): Promise<void> {
		this.beginOperation();
		const article = this.fetchService.getArticle(articleId);
		if (!article) {
			this.removeUnavailableArticleIds(articleSelectionResource, [articleId]);
			return;
		}

		await this.editorService.openEditor({
			resource: BrowserViewUri.forId(generateUuid()),
			options: { viewState: { url: article.url.toString(true) } },
		});
	}

	async downloadArticlePdf(
		articleId: ArticleId,
		articleSelectionResource?: IArticleSelectionSnapshot['resource'],
	): Promise<void> {
		await this.downloadArticlePdfWithOptions(articleId, {
			context: this.createArticlePdfDownloadContext(),
			articleSelectionResource,
		});
	}

	async downloadArticlePdfs(selection: IArticleSelectionSnapshot): Promise<void> {
		const context = this.createArticlePdfDownloadContext();
		if (this.currentDownloadTask) {
			throw new Error('An Article PDF batch download is already active.');
		}

		const articleIds = [...selection.articleIds];
		const unavailableArticleIds = articleIds.filter(articleId => !this.fetchService.getArticle(articleId));
		if (unavailableArticleIds.length > 0) {
			this.removeUnavailableArticleIds(selection.resource, unavailableArticleIds);
			this.notificationService.info(this.getUi().articleDetailsUnavailable);
		}
		const availableArticleIds = articleIds.filter(articleId => this.fetchService.getArticle(articleId));
		if (availableArticleIds.length === 0) {
			return;
		}

		const source = new CancellationTokenSource();
		const taskId = createDocumentBatchTaskId();
		this.currentDownloadTask = { taskId, source };

		try {
			for (const [index, articleId] of availableArticleIds.entries()) {
				if (source.token.isCancellationRequested) {
					break;
				}
				await this.downloadArticlePdfWithOptions(articleId, {
					context,
					taskId,
					token: source.token,
					order: context.pdfFileNameUseSelectionOrder ? index + 1 : undefined,
					articleSelectionResource: selection.resource,
				});
			}
		} finally {
			if (this.currentDownloadTask?.taskId === taskId) {
				this.currentDownloadTask = undefined;
			}
			source.dispose();
		}
	}

	cancelArticlePdfDownloads(): void {
		const task = this.currentDownloadTask;
		if (!task) {
			return;
		}

		task.source.cancel();
		task.source.dispose();
		this.currentDownloadTask = undefined;
		void this.nativeHostService.invoke('cancel_document_task', { taskId: task.taskId })
			.catch(error => console.warn('Failed to cancel document download task.', error));
	}

	async exportArticleSummaries(selection: IArticleSelectionSnapshot): Promise<void> {
		const lifecycle = this.beginOperation();
		if (!this.nativeHostService.canInvoke()) {
			return;
		}

		const articleIds = [...selection.articleIds];
		await this.articleSummaryTranslationExportService.handleExportArticleSummaries(
			articleIds,
			true,
			unavailableArticleIds => {
				if (this.isOperationActive(lifecycle)) {
					this.chatService.removeArticleChecks(selection.resource, unavailableArticleIds);
				}
			},
		);
	}

	async exportDraftDocument(snapshot: IDraftDocumentExportSnapshot): Promise<void> {
		const lifecycle = this.beginOperation();
		if (!this.nativeHostService.canInvoke()) {
			return;
		}

		const locale = this.localeService.getLocale();
		const ui = this.languageService.getLocaleMessages(locale);
		const pdfDownloadDir = this.settingsModel.getSnapshot().pdfDownloadDir;
		const document = normalizeWritingEditorDocument(snapshot.document);
		const editorDraftStyle = snapshot.editorDraftStyle
			? cloneEditorDraftStyleSettings(snapshot.editorDraftStyle)
			: undefined;
		try {
			const result = await this.nativeHostService.invoke('export_editor_docx', {
				document,
				editorDraftStyle,
				title: snapshot.title,
				preferredDirectory: resolvePreferredDirectory(pdfDownloadDir),
				locale,
			});
			if (!this.isOperationActive(lifecycle) || !result) {
				return;
			}
			this.notificationService.info(
				formatLocaleMessage(ui.toastEditorDocxExported, {
					title: result.title,
					filePath: result.filePath,
				}),
			);
		} catch (error) {
			if (!this.isOperationActive(lifecycle)) {
				return;
			}
			const localizedError = localizeAppError(ui, parseAppErrorData(error));
			this.notificationService.error(
				formatLocaleMessage(ui.toastDocxExportFailed, { error: localizedError }),
			);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.lifecycle += 1;
		this.cancelArticlePdfDownloads();
	}

	private async downloadArticlePdfWithOptions(
		articleId: ArticleId,
		options: ArticlePdfDownloadOptions,
	): Promise<void> {
		if (!this.isOperationActive(options.context.lifecycle)) {
			return;
		}
		let article: ArticleDetail | null;
		try {
			article = await this.resolveArticleDetail(articleId, options.token);
		} catch (error) {
			if (
				!options.token?.isCancellationRequested &&
				this.isOperationActive(options.context.lifecycle)
			) {
				const ui = this.getUi();
				const localizedError = localizeAppError(ui, parseAppErrorData(error));
				this.notificationService.error(
					formatLocaleMessage(ui.toastPdfDownloadFailed, { error: localizedError }),
				);
			}
			return;
		}
		if (
			options.token?.isCancellationRequested ||
			!this.isOperationActive(options.context.lifecycle)
		) {
			return;
		}
		if (!article) {
			this.removeUnavailableArticleIds(options.articleSelectionResource, [articleId]);
			this.notificationService.info(this.getUi().articleDetailsUnavailable);
			return;
		}

		const preparedPdfDownload = preparePdfDownload(
			article.url.toString(true),
			article.pdfUrl?.toString(true),
		);
		if (!preparedPdfDownload) {
			if (!options.token?.isCancellationRequested) {
				this.notificationService.error(this.getUi().errorPdfLinkNotFound);
			}
			return;
		}

		if (!this.nativeHostService.canInvoke()) {
			if (!options.token?.isCancellationRequested) {
				this.notificationService.info(this.getUi().toastDesktopPdfDownloadOnly);
			}
			return;
		}

		if (options.context.knowledgeBaseEnabled) {
			try {
				await syncLibraryMetadataFromArticle({
					enabled: true,
					invokeDesktop: this.nativeHostService.invoke,
					article: {
						title: article.title,
						doi: article.doi,
						authors: article.authors.map(author => author.name),
						journalTitle: article.publication.title,
						publishedAt: article.publishedAt,
						sourceUrl: preparedPdfDownload.normalizedSourceUrl,
						sourceId: null,
					},
					onDocumentUpserted: document => {
						if (this.isOperationActive(options.context.lifecycle)) {
							this.libraryModel.upsertDocumentSummary(document);
						}
					},
				});
			} catch (error) {
				if (this.isOperationActive(options.context.lifecycle)) {
					console.error('Failed to upsert library document metadata.', error);
				}
			}
		}
		if (
			options.token?.isCancellationRequested ||
			!this.isOperationActive(options.context.lifecycle)
		) {
			if (!this.isOperationActive(options.context.lifecycle)) {
				return;
			}
			markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
			return;
		}
		markPdfDownloadStarted(preparedPdfDownload.normalizedSourceUrl);

		if (preparedPdfDownload.isSciencePdfDownload && this.sciencePdfDownloadCount > 0) {
			this.notificationService.info(this.getUi().toastSciencePdfQueued);
		}
		if (preparedPdfDownload.isSciencePdfDownload) {
			this.sciencePdfDownloadCount += 1;
		}

		try {
			const result = await this.nativeHostService.invoke('web_content_download_pdf', {
				taskId: options.taskId,
				pageUrl: preparedPdfDownload.normalizedSourceUrl,
				downloadUrl: preparedPdfDownload.preferredPdfUrl,
				doi: article.doi,
				articleTitle: buildDownloadArticleTitle(article, options.order),
				authors: article.authors.map(author => author.name),
				publishedAt: article.publishedAt ?? null,
				sourceId: null,
				journalTitle: article.publication.title,
				customDownloadDir: resolvePreferredDirectory(
					options.context.knowledgeBaseEnabled
						? options.context.knowledgeBasePdfDownloadDir
						: options.context.pdfDownloadDir,
				),
			});
			if (
				options.token?.isCancellationRequested ||
				!this.isOperationActive(options.context.lifecycle)
			) {
				if (!this.isOperationActive(options.context.lifecycle)) {
					markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
					return;
				}
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}
			markPdfDownloadSucceeded(preparedPdfDownload.normalizedSourceUrl, result);
			void this.libraryModel.refresh();
			const ui = this.getUi();
			this.notificationService.info(
				formatLocaleMessage(ui.toastPdfDownloaded, {
					filePath: result.filePath,
					sourceUrl: result.sourceUrl,
				}),
			);
		} catch (error) {
			if (!this.isOperationActive(options.context.lifecycle)) {
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}
			if (options.token?.isCancellationRequested) {
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}

			const parsedError = parseAppErrorData(error);
			if (isScienceValidationWindowClosedCancel(parsedError) || isDesktopCancellation(parsedError)) {
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}

			const ui = this.getUi();
			const localizedError = localizeAppError(ui, parsedError);
			markPdfDownloadFailed(preparedPdfDownload.normalizedSourceUrl, localizedError);
			this.notificationService.error(
				formatLocaleMessage(ui.toastPdfDownloadFailed, { error: localizedError }),
			);
		} finally {
			if (preparedPdfDownload.isSciencePdfDownload) {
				this.sciencePdfDownloadCount = Math.max(0, this.sciencePdfDownloadCount - 1);
			}
		}
	}

	private async resolveArticleDetail(articleId: ArticleId, token?: CancellationToken) {
		if (!this.fetchService.getArticle(articleId)) {
			return null;
		}
		return this.fetchService.getArticleDetail(articleId)
			?? this.fetchService.fetchArticle(articleId, token ?? CancellationTokenNone);
	}

	private createArticlePdfDownloadContext(): ArticlePdfDownloadContext {
		const lifecycle = this.beginOperation();
		const settings = this.settingsModel.getSnapshot();
		return {
			lifecycle,
			knowledgeBaseEnabled: settings.knowledgeBaseEnabled,
			pdfDownloadDir: settings.pdfDownloadDir,
			knowledgeBasePdfDownloadDir: settings.knowledgeBasePdfDownloadDir,
			pdfFileNameUseSelectionOrder: settings.pdfFileNameUseSelectionOrder,
		};
	}

	private removeUnavailableArticleIds(
		resource: IArticleSelectionSnapshot['resource'] | undefined,
		articleIds: readonly ArticleId[],
	): void {
		if (resource) {
			this.chatService.removeArticleChecks(resource, articleIds);
		}
	}

	private getUi(): LocaleMessages {
		return this.languageService.getLocaleMessages(this.localeService.getLocale());
	}

	private beginOperation(): number {
		if (this.disposed) {
			throw new Error('Document actions service is disposed.');
		}
		return this.lifecycle;
	}

	private isOperationActive(lifecycle: number): boolean {
		return !this.disposed && lifecycle === this.lifecycle;
	}
}

registerSingleton(IDocumentActionsService, DocumentActionsService, InstantiationType.Delayed);
