/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from 'cs/base/common/assert';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { cloneAndChange } from 'cs/base/common/objects';
import { getComparisonKey } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import {
	applyWritingEditorEdits,
	type WritingEditorApplyEditFailureReason,
} from 'cs/editor/common/writingEditorDocument';
import { localize } from 'cs/nls';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { INotificationService } from 'cs/platform/notification/common/notification';
import {
	IChatService as IChatServiceDecorator,
	type ChatMessage,
	type ChatPatchProposal,
	type IChatModel,
	type IChatModelInitialState,
	type IChatModelReference,
	type IChatModelSnapshot,
	type IChatRequestCompletion,
	type IChatRequestTransaction,
	type IPreparedChatRequestState,
	type IChatService,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';
import {
	parseChatImageAttachments,
	type IChatImageAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';

interface ILiveChatModel {
	readonly model: ChatModel;
	referenceCount: number;
}

function cloneStructuredValue<T>(value: T): T {
	return cloneAndChange(value, () => undefined);
}

function freezeStructuredValue<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
		return value;
	}
	for (const child of Object.values(value)) {
		freezeStructuredValue(child);
	}
	return Object.freeze(value);
}

function cloneMessage(message: ChatMessage): ChatMessage {
	if (message.role === 'user') {
		return {
			...message,
			imageAttachments: parseChatImageAttachments(message.imageAttachments),
		};
	}

	return {
		...message,
		imageAttachments: parseChatImageAttachments(message.imageAttachments),
		articleList: message.articleList
			? { articleIds: [...message.articleList.articleIds] }
			: undefined,
		result: message.result ? cloneStructuredValue(message.result) : message.result,
		patchProposal: message.patchProposal
			? {
				...message.patchProposal,
				patch: cloneStructuredValue(message.patchProposal.patch),
				target: {
					resource: message.patchProposal.target.resource,
					document: cloneStructuredValue(message.patchProposal.target.document),
				},
			}
			: message.patchProposal,
	};
}

function createInitialSnapshot(initialState: IChatModelInitialState | undefined): IChatModelSnapshot {
	return {
		input: initialState?.input ?? '',
		messages: initialState?.messages?.map(cloneMessage) ?? [],
		activeRequest: undefined,
		errorMessage: initialState?.errorMessage,
		checkedArticleIds: [...new Set(initialState?.checkedArticleIds ?? [])],
	};
}

function createArticleFetchEmptyMessageContent(sourceLabel: string, message: string): string {
	const normalizedSourceLabel = sourceLabel.trim();
	return [
		`> ${message}`,
		normalizedSourceLabel ? `> ${normalizedSourceLabel}` : '',
	].filter(Boolean).join('\n');
}

function canApplyChatPatch(patchProposal: ChatPatchProposal): boolean {
	return patchProposal.accepted
		&& !patchProposal.requiresCustomExecutor
		&& !patchProposal.validationError
		&& !patchProposal.isApplied;
}

function createChatPatchProposal(
	completion: IChatRequestCompletion['patchProposal'],
): ChatPatchProposal | null {
	if (!completion) {
		return null;
	}

	return {
		...completion.proposal,
		patch: cloneStructuredValue(completion.proposal.patch),
		target: {
			resource: completion.target.resource,
			document: cloneStructuredValue(completion.target.document),
		},
		isApplied: false,
		applyError: null,
	};
}

function requireActiveRequest(
	resource: URI,
	snapshot: IChatModelSnapshot,
	requestId: string,
) {
	const activeRequest = snapshot.activeRequest;
	if (!activeRequest) {
		throw new Error(`No Chat request is active for ${resource.toString()}.`);
	}

	if (activeRequest.id !== requestId) {
		throw new Error(
			`Chat request ${requestId} does not match active request ${activeRequest.id} for ${resource.toString()}.`,
		);
	}

	return activeRequest;
}

function documentKey(document: ChatPatchProposal['target']['document']): string {
	return JSON.stringify(document);
}

function localizePatchEditFailure(
	reason: WritingEditorApplyEditFailureReason,
	blockId: string,
): string {
	switch (reason) {
		case 'unknown-block':
			return localize('chat.patch.unknownBlock', "The patch targets a draft block that no longer exists: {0}.", blockId);
		case 'unsupported-structured-content':
			return localize('chat.patch.structuredContent', "The patch cannot edit structured content in draft block {0}.", blockId);
		case 'expected-text-mismatch':
			return localize('chat.patch.textChanged', "The text in draft block {0} changed after this patch was generated.", blockId);
		case 'match-not-found':
			return localize('chat.patch.matchNotFound', "The text targeted by this patch no longer exists in draft block {0}.", blockId);
		default:
			return assertNever(reason);
	}
}

class ChatModel extends Disposable implements IChatModel {
	private readonly onDidChangeEmitter = this._register(new EventEmitter<void>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChange = this.onDidChangeEmitter.event;
	private snapshot: IChatModelSnapshot;
	private isDisposed = false;

	constructor(
		readonly resource: URI,
		initialState: IChatModelInitialState | undefined,
	) {
		super();
		this.snapshot = freezeStructuredValue(createInitialSnapshot(initialState));
	}

	getSnapshot(): IChatModelSnapshot {
		this.assertNotDisposed();
		return this.snapshot;
	}

	update(updater: (snapshot: IChatModelSnapshot) => IChatModelSnapshot): void {
		this.assertNotDisposed();
		const nextSnapshot = updater(this.snapshot);
		if (Object.is(nextSnapshot, this.snapshot)) {
			return;
		}

		this.snapshot = freezeStructuredValue(nextSnapshot);
		this.onDidChangeEmitter.fire();
	}

	commitPreparedSnapshot(
		expectedSnapshot: IChatModelSnapshot,
		preparedSnapshot: IChatModelSnapshot,
	): void {
		this.update(snapshot => {
			if (snapshot !== expectedSnapshot) {
				throw new Error(`Chat model changed before a prepared state was committed: ${this.resource.toString()}`);
			}
			return preparedSnapshot;
		});
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		super.dispose();
	}

	private assertNotDisposed(): void {
		if (this.isDisposed) {
			throw new Error(`Chat model has been disposed: ${this.resource.toString()}`);
		}
	}
}

class ChatRequestTransaction implements IChatRequestTransaction {
	private active = true;

	constructor(
		private readonly model: ChatModel,
		private readonly requestId: string,
		private readonly initialSnapshot: IChatModelSnapshot,
	) {}

	prepareCompletion(completion: IChatRequestCompletion): IPreparedChatRequestState {
		const normalizedContent = completion.content.trim();
		return this.prepare(snapshot => {
			requireActiveRequest(this.model.resource, snapshot, this.requestId);
			if (!normalizedContent) {
				throw new Error('Chat request completion content must not be empty.');
			}

			return {
				...snapshot,
				messages: [
					...snapshot.messages,
					{
						id: generateUuid(),
						role: 'assistant',
						content: normalizedContent,
						imageAttachments: [],
						result: completion.result
							? cloneStructuredValue(completion.result)
							: completion.result,
						patchProposal: createChatPatchProposal(completion.patchProposal),
					},
				],
				activeRequest: undefined,
				errorMessage: undefined,
			};
		});
	}

	prepareFailure(errorMessage: string): IPreparedChatRequestState {
		const normalizedErrorMessage = errorMessage.trim();
		return this.prepare(snapshot => {
			const activeRequest = requireActiveRequest(this.model.resource, snapshot, this.requestId);
			if (!normalizedErrorMessage) {
				throw new Error('Chat request error message must not be empty.');
			}

			return {
				...snapshot,
				input: activeRequest.prompt,
				activeRequest: undefined,
				errorMessage: normalizedErrorMessage,
			};
		});
	}

	rollback(): void {
		this.assertActive();
		this.model.update(snapshot => {
			requireActiveRequest(this.model.resource, snapshot, this.requestId);
			return this.initialSnapshot;
		});
		this.active = false;
	}

	private prepare(
		prepareSnapshot: (snapshot: IChatModelSnapshot) => IChatModelSnapshot,
	): IPreparedChatRequestState {
		this.assertActive();
		const expectedSnapshot = this.model.getSnapshot();
		const preparedSnapshot = freezeStructuredValue(prepareSnapshot(expectedSnapshot));
		let committed = false;
		return Object.freeze({
			snapshot: preparedSnapshot,
			commit: () => {
				if (committed) {
					throw new Error(`Prepared Chat state was already committed: ${this.model.resource.toString()}`);
				}
				this.assertActive();
				this.model.commitPreparedSnapshot(expectedSnapshot, preparedSnapshot);
				this.active = false;
				committed = true;
			},
		});
	}

	private assertActive(): void {
		if (!this.active) {
			throw new Error(`Chat request transaction is no longer active: ${this.model.resource.toString()}`);
		}
	}
}

export class ChatService implements IChatService {
	declare readonly _serviceBrand: undefined;

	private readonly models = new Map<string, ILiveChatModel>();

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@IDraftEditorService private readonly draftEditorService: IDraftEditorService,
	) {}

	createModel(
		resource: URI,
		initialState?: IChatModelInitialState,
	): IChatModelReference {
		const resourceKey = getComparisonKey(resource);
		if (this.models.has(resourceKey)) {
			throw new Error(`Chat model already exists: ${resource.toString()}`);
		}

		const liveModel: ILiveChatModel = {
			model: new ChatModel(resource, initialState),
			referenceCount: 0,
		};
		this.models.set(resourceKey, liveModel);
		return this.createReference(resourceKey, liveModel);
	}

	acquireModel(resource: URI): IChatModelReference {
		const resourceKey = getComparisonKey(resource);
		const liveModel = this.models.get(resourceKey);
		if (!liveModel) {
			throw new Error(`Chat model does not exist: ${resource.toString()}`);
		}

		return this.createReference(resourceKey, liveModel);
	}

	setInput(resource: URI, value: string): void {
		this.updateModel(resource, snapshot => {
			if (snapshot.input === value && snapshot.errorMessage === undefined) {
				return snapshot;
			}

			return {
				...snapshot,
				input: value,
				errorMessage: undefined,
			};
		});
	}

	insertContextMessage(
		resource: URI,
		content: string,
		imageAttachments: readonly IChatImageAttachment[],
	): void {
		const model = this.getModel(resource);
		const normalizedContent = content.trim();
		if (!normalizedContent) {
			throw new Error('A Chat context message requires non-empty content.');
		}
		const capturedImageAttachments = parseChatImageAttachments(imageAttachments);

		model.update(snapshot => ({
			...snapshot,
			messages: [
				...snapshot.messages,
				{
					id: generateUuid(),
					role: 'user',
					content: normalizedContent,
					imageAttachments: capturedImageAttachments,
				},
			],
			errorMessage: undefined,
		}));
	}

	insertArticleList(
		resource: URI,
		_sourceLabel: string,
		articleIds: readonly ArticleId[],
		content: string,
	): void {
		const model = this.getModel(resource);
		if (articleIds.length === 0 || !content.trim()) {
			return;
		}

		model.update(snapshot => ({
			...snapshot,
			messages: [
				...snapshot.messages,
				{
					id: generateUuid(),
					role: 'assistant',
					content,
					imageAttachments: [],
					includeInAgentHistory: false,
					articleList: { articleIds: [...articleIds] },
				},
			],
			errorMessage: undefined,
		}));
	}

	insertArticleFetchEmptyResult(resource: URI, sourceLabel: string, message: string): void {
		const model = this.getModel(resource);
		if (!message.trim()) {
			return;
		}

		model.update(snapshot => ({
			...snapshot,
			messages: [
				...snapshot.messages,
				{
					id: generateUuid(),
					role: 'assistant',
					content: createArticleFetchEmptyMessageContent(sourceLabel, message),
					imageAttachments: [],
					includeInAgentHistory: false,
				},
			],
			errorMessage: undefined,
		}));
	}

	applyPatch(resource: URI, messageId: string): void {
		const model = this.getModel(resource);
		const assistantMessage = model.getSnapshot().messages.find(
			(message): message is Extract<ChatMessage, { role: 'assistant' }> =>
				message.id === messageId && message.role === 'assistant',
		);
		const patchProposal = assistantMessage?.patchProposal ?? null;
		if (!patchProposal || !canApplyChatPatch(patchProposal)) {
			return;
		}

		const targetDocument = this.draftEditorService.getDocument(patchProposal.target.resource);
		if (!targetDocument) {
			this.reportPatchApplyFailure(
				model,
				messageId,
				localize('chat.patch.targetUnavailable', "The draft targeted by this patch is unavailable."),
			);
			return;
		}

		if (documentKey(targetDocument) !== documentKey(patchProposal.target.document)) {
			this.reportPatchApplyFailure(
				model,
				messageId,
				localize('chat.patch.targetChanged', "The draft changed after this patch was generated."),
			);
			return;
		}

		const textEdits = patchProposal.patch.operations.flatMap(operation =>
			operation.kind === 'text-edit' ? [operation.edit] : [],
		);
		if (textEdits.length !== patchProposal.patch.operations.length) {
			this.reportPatchApplyFailure(
				model,
				messageId,
				localize('chat.patch.requiresExecutor', "This patch requires an unsupported custom executor."),
			);
			return;
		}

		const applyResult = applyWritingEditorEdits(patchProposal.target.document, textEdits);
		if (!applyResult.ok) {
			this.reportPatchApplyFailure(
				model,
				messageId,
				localizePatchEditFailure(applyResult.reason, applyResult.blockId),
			);
			return;
		}

		this.draftEditorService.setDocument(patchProposal.target.resource, applyResult.document);
		this.updateMessage(model, messageId, message => {
			if (message.role !== 'assistant' || !message.patchProposal) {
				return message;
			}

			return {
				...message,
				patchProposal: {
					...message.patchProposal,
					isApplied: true,
					applyError: null,
				},
			};
		});
		this.notificationService.info(localize('chat.patch.applied', "Patch applied to the draft."));
	}

	isArticleChecked(resource: URI, articleId: ArticleId): boolean {
		return this.getModel(resource).getSnapshot().checkedArticleIds.includes(articleId);
	}

	setArticleChecked(resource: URI, articleId: ArticleId, checked: boolean): void {
		this.updateModel(resource, snapshot => {
			const isChecked = snapshot.checkedArticleIds.includes(articleId);
			if (isChecked === checked) {
				return snapshot;
			}

			return {
				...snapshot,
				checkedArticleIds: checked
					? [...snapshot.checkedArticleIds, articleId]
					: snapshot.checkedArticleIds.filter(id => id !== articleId),
			};
		});
	}

	removeArticleChecks(resource: URI, articleIds: readonly ArticleId[]): void {
		const model = this.getModel(resource);
		if (articleIds.length === 0) {
			return;
		}

		const removedArticleIds = new Set(articleIds);
		model.update(snapshot => {
			const checkedArticleIds = snapshot.checkedArticleIds.filter(
				articleId => !removedArticleIds.has(articleId),
			);
			if (checkedArticleIds.length === snapshot.checkedArticleIds.length) {
				return snapshot;
			}

			return { ...snapshot, checkedArticleIds };
		});
	}

	startRequest(
		resource: URI,
		requestId: string,
		prompt: string,
		imageAttachments: readonly IChatImageAttachment[],
	): IChatRequestTransaction {
		const model = this.getModel(resource);
		if (!requestId.trim()) {
			throw new Error('Chat request id must not be empty.');
		}

		const normalizedPrompt = prompt.trim();
		if (!normalizedPrompt) {
			throw new Error('Chat request prompt must not be empty.');
		}
		const capturedImageAttachments = parseChatImageAttachments(imageAttachments);

		const initialSnapshot = model.getSnapshot();
		model.update(snapshot => {
			if (snapshot.activeRequest) {
				throw new Error(
					`Chat request ${snapshot.activeRequest.id} is already active for ${resource.toString()}.`,
				);
			}

			return {
				...snapshot,
				input: '',
				messages: [
					...snapshot.messages,
					{
						id: generateUuid(),
						role: 'user',
						content: normalizedPrompt,
						imageAttachments: capturedImageAttachments,
					},
				],
				activeRequest: {
					id: requestId,
					prompt: normalizedPrompt,
				},
				errorMessage: undefined,
			};
		});

		return new ChatRequestTransaction(model, requestId, initialSnapshot);
	}

	private createReference(resourceKey: string, liveModel: ILiveChatModel): IChatModelReference {
		liveModel.referenceCount += 1;
		let isDisposed = false;
		return {
			object: liveModel.model,
			dispose: () => {
				if (isDisposed) {
					return;
				}

				isDisposed = true;
				liveModel.referenceCount -= 1;
				if (liveModel.referenceCount > 0) {
					return;
				}

				if (this.models.get(resourceKey) !== liveModel) {
					throw new Error(`Chat model registry ownership changed: ${liveModel.model.resource.toString()}`);
				}

				this.models.delete(resourceKey);
				liveModel.model.dispose();
			},
		};
	}

	private getModel(resource: URI): ChatModel {
		const liveModel = this.models.get(getComparisonKey(resource));
		if (!liveModel) {
			throw new Error(`Chat model does not exist: ${resource.toString()}`);
		}

		return liveModel.model;
	}

	private updateModel(
		resource: URI,
		updater: (snapshot: IChatModelSnapshot) => IChatModelSnapshot,
	): void {
		this.getModel(resource).update(updater);
	}

	private updateMessage(
		model: ChatModel,
		messageId: string,
		updater: (message: ChatMessage) => ChatMessage,
	): void {
		model.update(snapshot => {
			let changed = false;
			const messages = snapshot.messages.map(message => {
				if (message.id !== messageId) {
					return message;
				}

				const nextMessage = updater(message);
				changed ||= !Object.is(nextMessage, message);
				return nextMessage;
			});

			return changed ? { ...snapshot, messages } : snapshot;
		});
	}

	private reportPatchApplyFailure(model: ChatModel, messageId: string, errorMessage: string): void {
		this.updateMessage(model, messageId, message => {
			if (message.role !== 'assistant' || !message.patchProposal) {
				return message;
			}

			return {
				...message,
				patchProposal: {
					...message.patchProposal,
					applyError: errorMessage,
				},
			};
		});
		this.notificationService.error(
			localize('chat.patch.applyFailed', "Failed to apply patch: {0}", errorMessage),
		);
	}
}

registerSingleton(IChatServiceDecorator, ChatService, InstantiationType.Delayed);
