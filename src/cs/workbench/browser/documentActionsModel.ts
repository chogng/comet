/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter } from 'cs/base/common/event';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type { LibraryDocumentSummary } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { parseAppErrorData } from 'cs/base/parts/sandbox/common/appError';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { generateUuid } from 'cs/base/common/uuid';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import { formatLocaleMessage, localizeAppError } from 'cs/workbench/common/errorMessages';
import type { ArticleBatchTaskProgress } from 'cs/workbench/browser/articleBatchTask';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorOpenTypes';
import {
	canExportArticlesDocx,
	preparePdfDownload,
	resolvePreferredDirectory,
} from 'cs/workbench/services/document/documentActionService';
import {
	markPdfDownloadCancelled,
	markPdfDownloadFailed,
	markPdfDownloadStarted,
	markPdfDownloadSucceeded,
} from 'cs/workbench/services/document/pdfDownloadStatus';
import { syncLibraryMetadataFromArticle } from 'cs/workbench/services/knowledgeBase/libraryMetadataService';
import {
	IFetchService,
	type ArticleDetail,
	type ArticleId,
} from 'cs/workbench/services/fetch/common/fetch';
import type { INotificationService } from 'cs/platform/notification/common/notification';
import type { EditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

export type DocumentActionsControllerContext = {
	desktopRuntime: boolean;
	invokeDesktop: ElectronInvoke;
	notificationService: INotificationService;
	locale: Locale;
	ui: LocaleMessages;
	knowledgeBaseEnabled: boolean;
	pdfDownloadDir: string;
	knowledgeBasePdfDownloadDir: string;
	pdfFileNameUseSelectionOrder: boolean;
	getExportableArticleIds: () => readonly ArticleId[];
	onUnavailableArticleIds: (articleIds: readonly ArticleId[]) => void;
	onOpenEditor: EditorOpenHandler;
	onExportArticleSummaries: (articleIds: readonly ArticleId[], translateSummaries: boolean) => void | Promise<void>;
	activeDraftExport: {
		title: string;
		document: WritingEditorDocument;
		editorDraftStyle?: EditorDraftStyleSettings;
	} | null;
	onLibraryDocumentUpserted?: (document: LibraryDocumentSummary) => void;
	onLibraryUpdated?: () => void | Promise<void>;
};

export type DocumentActionsControllerSnapshot = {
	canExportDocx: boolean;
	downloadAllProgress: ArticleBatchTaskProgress | null;
};

type DocumentDownloadTask = {
	taskId: string;
	source: CancellationTokenSource;
};

type SharedPdfDownloadOptions = {
	taskId?: string;
	token?: CancellationToken;
	order?: number | null;
};

function buildDownloadArticleTitle(article: ArticleDetail, order: number | null) {
	return typeof order === 'number' ? `${order}. ${article.title}` : article.title;
}

function resolveSciencePdfQueueMessage(ui: LocaleMessages) {
	return ui.toastSciencePdfQueued;
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

function createSnapshot(
	context: DocumentActionsControllerContext,
	downloadAllProgress: ArticleBatchTaskProgress | null = null,
): DocumentActionsControllerSnapshot {
	return {
		canExportDocx:
			Boolean(context.activeDraftExport) ||
			canExportArticlesDocx(context.getExportableArticleIds().length),
		downloadAllProgress,
	};
}

function sameArticleBatchTaskProgress(
	left: ArticleBatchTaskProgress | null,
	right: ArticleBatchTaskProgress | null,
) {
	if (left === right) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	return left.phase === right.phase && left.current === right.current && left.total === right.total;
}

export class DocumentActionsController {
	private context: DocumentActionsControllerContext;
	private snapshot: DocumentActionsControllerSnapshot;
	private readonly onDidChangeEmitter = new EventEmitter<void>();
	private sciencePdfDownloadCount = 0;
	private currentDownloadTask: DocumentDownloadTask | null = null;

	constructor(
		context: DocumentActionsControllerContext,
		@IFetchService private readonly fetchService: IFetchService,
	) {
		this.context = context;
		this.snapshot = createSnapshot(context);
	}

	readonly subscribe = (listener: () => void) => this.onDidChangeEmitter.event(listener);

	readonly getSnapshot = () => this.snapshot;

	readonly setContext = (context: DocumentActionsControllerContext) => {
		this.context = context;
		this.setSnapshot(createSnapshot(context, this.snapshot.downloadAllProgress));
	};

	readonly dispose = () => {
		this.currentDownloadTask?.source.cancel();
		this.currentDownloadTask?.source.dispose();
		this.currentDownloadTask = null;
		this.onDidChangeEmitter.dispose();
	};

	readonly handleSharedPdfDownload = async (
		articleId: ArticleId,
		options: SharedPdfDownloadOptions = {},
	) => {
		let article: ArticleDetail | null;
		try {
			article = await this.resolveArticleDetail(articleId, options.token);
		} catch (error) {
			if (!options.token?.isCancellationRequested) {
				const localizedError = localizeAppError(this.context.ui, parseAppErrorData(error));
				this.context.notificationService.error(
					formatLocaleMessage(this.context.ui.toastPdfDownloadFailed, { error: localizedError }),
				);
			}
			return;
		}
		if (!article) {
			this.context.onUnavailableArticleIds([articleId]);
			this.context.notificationService.info(this.context.ui.articleDetailsUnavailable);
			return;
		}

		const {
			desktopRuntime,
			invokeDesktop,
			notificationService,
			ui,
			knowledgeBaseEnabled,
			pdfDownloadDir,
			knowledgeBasePdfDownloadDir,
			onLibraryUpdated,
			onLibraryDocumentUpserted,
		} = this.context;
		const sourceUrl = article.url.toString(true);
		const preparedPdfDownload = preparePdfDownload(sourceUrl, article.doi);
		if (!preparedPdfDownload) {
			if (!options.token?.isCancellationRequested) {
				notificationService.error(ui.toastEnterArticleUrl);
			}
			return;
		}

		if (!desktopRuntime) {
			if (!options.token?.isCancellationRequested) {
				notificationService.info(ui.toastDesktopPdfDownloadOnly);
			}
			return;
		}

		if (knowledgeBaseEnabled) {
			try {
				await syncLibraryMetadataFromArticle({
					enabled: knowledgeBaseEnabled,
					invokeDesktop,
					article: {
						title: article.title,
						doi: article.doi,
						authors: article.authors.map(author => author.name),
						journalTitle: article.publication.title,
						publishedAt: article.publishedAt,
						sourceUrl: preparedPdfDownload.normalizedSourceUrl,
						sourceId: null,
					},
					onDocumentUpserted: onLibraryDocumentUpserted,
				});
			} catch (metadataError) {
				console.error('Failed to upsert library document metadata.', metadataError);
			}
		}
		if (options.token?.isCancellationRequested) {
			markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
			return;
		}
		markPdfDownloadStarted(preparedPdfDownload.normalizedSourceUrl);

		if (preparedPdfDownload.isSciencePdfDownload && this.sciencePdfDownloadCount > 0) {
			notificationService.info(resolveSciencePdfQueueMessage(ui));
		}
		if (preparedPdfDownload.isSciencePdfDownload) {
			this.sciencePdfDownloadCount += 1;
		}

		try {
			const result = await invokeDesktop('web_content_download_pdf', {
				taskId: options.taskId,
				pageUrl: preparedPdfDownload.normalizedSourceUrl,
				downloadUrl: preparedPdfDownload.preferredPdfUrl,
				doi: article.doi,
				articleTitle: buildDownloadArticleTitle(article, options.order ?? null),
				authors: article.authors.map(author => author.name),
				publishedAt: article.publishedAt ?? null,
				sourceId: null,
				journalTitle: article.publication.title,
				customDownloadDir: resolvePreferredDirectory(
					knowledgeBaseEnabled ? knowledgeBasePdfDownloadDir : pdfDownloadDir,
				),
			});
			if (options.token?.isCancellationRequested) {
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}
			markPdfDownloadSucceeded(preparedPdfDownload.normalizedSourceUrl, result);
			void onLibraryUpdated?.();
			notificationService.info(
				formatLocaleMessage(ui.toastPdfDownloaded, {
					filePath: result.filePath,
					sourceUrl: result.sourceUrl,
				}),
			);
		} catch (downloadError) {
			if (options.token?.isCancellationRequested) {
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}

			const parsedError = parseAppErrorData(downloadError);
			if (isScienceValidationWindowClosedCancel(parsedError) || isDesktopCancellation(parsedError)) {
				markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
				return;
			}

			const localizedError = localizeAppError(ui, parsedError);
			markPdfDownloadFailed(preparedPdfDownload.normalizedSourceUrl, localizedError);
			notificationService.error(
				formatLocaleMessage(ui.toastPdfDownloadFailed, { error: localizedError }),
			);
		} finally {
			if (preparedPdfDownload.isSciencePdfDownload) {
				this.sciencePdfDownloadCount = Math.max(0, this.sciencePdfDownloadCount - 1);
			}
		}
	};

	readonly handleOpenArticleDetails = async (articleId: ArticleId) => {
		const article = this.fetchService.getArticle(articleId);
		if (!article) {
			this.context.onUnavailableArticleIds([articleId]);
			return;
		}

		this.context.onOpenEditor({
			kind: 'browser',
			disposition: 'reveal-or-open',
			resource: BrowserViewUri.forId(generateUuid()),
			options: { viewState: { url: article.url.toString(true) } },
		});
	};

	readonly handleDownloadAllArticles = async (articleIds: readonly ArticleId[]) => {
		if (this.currentDownloadTask) {
			this.cancelDownloadAllArticles();
			return;
		}
		const unavailableArticleIds = articleIds.filter(articleId => !this.fetchService.getArticle(articleId));
		if (unavailableArticleIds.length > 0) {
			this.context.onUnavailableArticleIds(unavailableArticleIds);
			this.context.notificationService.info(this.context.ui.articleDetailsUnavailable);
		}
		const availableArticleIds = articleIds.filter(articleId => this.fetchService.getArticle(articleId));
		if (availableArticleIds.length === 0) {
			return;
		}

		const source = new CancellationTokenSource();
		const taskId = createDocumentBatchTaskId();
		this.currentDownloadTask = { taskId, source };
		let completed = 0;
		this.setDownloadAllProgress({ phase: 'running', current: completed, total: availableArticleIds.length });

		try {
			for (const [index, articleId] of availableArticleIds.entries()) {
				if (source.token.isCancellationRequested) {
					break;
				}
				await this.handleSharedPdfDownload(articleId, {
					taskId,
					token: source.token,
					order: this.context.pdfFileNameUseSelectionOrder ? index + 1 : null,
				});
				if (source.token.isCancellationRequested) {
					break;
				}
				completed += 1;
				if (this.currentDownloadTask?.taskId === taskId) {
					this.setDownloadAllProgress({ phase: 'running', current: completed, total: availableArticleIds.length });
				}
			}
		} finally {
			if (this.currentDownloadTask?.taskId === taskId) {
				this.currentDownloadTask = null;
				this.setDownloadAllProgress(null);
			}
			source.dispose();
		}
	};

	readonly handleExportDocx = async () => {
		const {
			desktopRuntime,
			invokeDesktop,
			locale,
			ui,
			pdfDownloadDir,
			getExportableArticleIds,
			activeDraftExport,
			onExportArticleSummaries,
		} = this.context;
		if (!desktopRuntime) {
			return;
		}
		if (activeDraftExport) {
			try {
				const result = await invokeDesktop('export_editor_docx', {
					document: activeDraftExport.document,
					editorDraftStyle: activeDraftExport.editorDraftStyle,
					title: activeDraftExport.title,
					preferredDirectory: resolvePreferredDirectory(pdfDownloadDir),
					locale,
				});
				if (!result) {
					return;
				}
				this.context.notificationService.info(
					formatLocaleMessage(ui.toastEditorDocxExported, {
						title: result.title,
						filePath: result.filePath,
					}),
				);
			} catch (exportError) {
				const localizedError = localizeAppError(ui, parseAppErrorData(exportError));
				this.context.notificationService.error(
					formatLocaleMessage(ui.toastDocxExportFailed, { error: localizedError }),
				);
			}
			return;
		}

		await onExportArticleSummaries(getExportableArticleIds(), true);
	};

	private async resolveArticleDetail(articleId: ArticleId, token?: CancellationToken) {
		if (!this.fetchService.getArticle(articleId)) {
			return null;
		}
		return this.fetchService.getArticleDetail(articleId)
			?? this.fetchService.fetchArticle(articleId, token ?? CancellationTokenNone);
	}

	private cancelDownloadAllArticles() {
		const task = this.currentDownloadTask;
		if (!task) {
			return;
		}
		task.source.cancel();
		this.currentDownloadTask = null;
		this.setDownloadAllProgress(null);
		void this.context.invokeDesktop('cancel_document_task', { taskId: task.taskId })
			.catch(error => console.warn('Failed to cancel document download task.', error));
	}

	private setSnapshot(nextSnapshot: DocumentActionsControllerSnapshot) {
		if (
			this.snapshot.canExportDocx === nextSnapshot.canExportDocx &&
			sameArticleBatchTaskProgress(this.snapshot.downloadAllProgress, nextSnapshot.downloadAllProgress)
		) {
			return;
		}
		this.snapshot = nextSnapshot;
		this.onDidChangeEmitter.fire();
	}

	private setDownloadAllProgress(progress: ArticleBatchTaskProgress | null) {
		this.setSnapshot(createSnapshot(this.context, progress));
	}
}

export function createDocumentActionsController(
	context: DocumentActionsControllerContext,
	fetchService: IFetchService,
) {
	return new DocumentActionsController(context, fetchService);
}
