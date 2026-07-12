/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { Codicon } from 'cs/base/common/codicons';
import { Emitter, type Event as EventType } from 'cs/base/common/event';
import { Disposable, DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { getComparisonKey } from 'cs/base/common/resources';
import { generateUuid } from 'cs/base/common/uuid';
import type {
	AgentMessagePayload,
	ArticleContextInput,
	LlmProviderSettings,
	LlmSettings,
	MainAgentAvailableToolId,
	RagSettings,
	RunMainAgentTurnPayload,
	RunMainAgentTurnResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { writingEditorSchema } from 'cs/editor/browser/text/schema';
import {
	collectWritingEditorTextUnits,
	type WritingEditorNode,
	type WritingEditorTextUnit,
} from 'cs/editor/common/writingEditorDocument';
import { localize } from 'cs/nls';
import { INativeHostService } from 'cs/platform/native/common/native';
import { IStorageService } from 'cs/platform/storage/common/storage';
import {
	ChatInteractivity,
	type IChat,
	type ISession,
	type ISessionType,
	SessionStatus,
} from 'cs/sessions/services/sessions/common/session';
import {
	SessionTransitionKind,
	type ISessionDraftOptions,
	type ISessionsChangeEvent,
	type ISessionsProvider,
} from 'cs/sessions/services/sessions/common/sessionsProvider';
import {
	DefaultChat,
	DefaultSession,
} from 'cs/sessions/contrib/providers/default/browser/defaultSessionModels';
import {
	createDefaultSessionResource,
	DefaultSessionsProviderId,
	DefaultSessionTypeId,
	getDefaultSessionConversationId,
} from 'cs/sessions/contrib/providers/default/browser/defaultSessionResources';
import {
	DefaultSessionsProviderStorage,
	type IDefaultPersistedSession,
} from 'cs/sessions/contrib/providers/default/browser/defaultSessionsProviderStorage';
import {
	ChatRequestAttachmentKind,
	type IChatRequest,
	type IChatRequestArticleAttachment,
	type IChatRequestEditorAttachment,
	type IChatRequestImageAttachment,
	type IChatRequestTextAttachment,
} from 'cs/workbench/contrib/chat/common/chatRequest';
import {
	IChatService,
	type ChatMessage,
	type IChatModelSnapshot,
	type IChatModelReference,
	type IChatRequestTransaction,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { ILanguageModelChatMetadataAndIdentifier } from 'cs/workbench/contrib/chat/common/languageModels';
import {
	getLlmModelOptionsForProvider,
	llmProviderIds,
	parseLlmModelOptionValue,
} from 'cs/workbench/services/llm/registry';
import {
	assertMainAgentPayloadByteLimits,
	createMainAgentHistoryWindow,
} from 'cs/workbench/services/llm/mainAgentPayload';
import {
	IFetchService,
	type ArticleDetail,
} from 'cs/workbench/services/fetch/common/fetch';
import {
	ISettingsModel,
	SettingsModel,
	type SettingsModelSnapshot,
} from 'cs/workbench/services/settings/settingsModel';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

interface IDefaultSessionRecord {
	readonly session: DefaultSession;
	readonly chat: DefaultChat;
	readonly chatModelReference: IChatModelReference;
	readonly lifetime: DisposableStore;
}

interface IDefaultSessionPersistenceProjection {
	readonly record: IDefaultSessionRecord;
	readonly chatSnapshot: IChatModelSnapshot;
	readonly status: SessionStatus.Completed | SessionStatus.Failed;
	readonly updatedAt: Date;
}

interface IDefaultActiveRequest {
	readonly id: string;
	readonly cancellation: CancellationTokenSource;
}

interface IResolvedEditorContext {
	readonly attachment: IChatRequestEditorAttachment;
	readonly selection: IChatRequestEditorAttachment['selection'];
}

interface IResolvedRequestContext {
	readonly writingContext: string | null;
	readonly editorSelection: IChatRequestEditorAttachment['selection'];
	readonly editorDocument: IChatRequestEditorAttachment['document'] | null;
	readonly editorAttachment: IChatRequestEditorAttachment | undefined;
	readonly articleContexts: readonly ArticleContextInput[];
	readonly availableTools: readonly MainAgentAvailableToolId[];
}

function cloneLlmProviderSettings(settings: LlmProviderSettings): LlmProviderSettings {
	return {
		apiKey: settings.apiKey,
		baseUrl: settings.baseUrl,
		selectedModelOption: settings.selectedModelOption,
		enabledModelOptions: settings.enabledModelOptions
			? [...settings.enabledModelOptions]
			: undefined,
		useMaxContextWindow: settings.useMaxContextWindow,
	};
}

function cloneLlmSettings(snapshot: SettingsModelSnapshot): LlmSettings {
	return {
		activeProvider: snapshot.activeLlmProvider,
		providers: {
			glm: cloneLlmProviderSettings(snapshot.llmProviders.glm),
			kimi: cloneLlmProviderSettings(snapshot.llmProviders.kimi),
			deepseek: cloneLlmProviderSettings(snapshot.llmProviders.deepseek),
			anthropic: cloneLlmProviderSettings(snapshot.llmProviders.anthropic),
			openai: cloneLlmProviderSettings(snapshot.llmProviders.openai),
			gemini: cloneLlmProviderSettings(snapshot.llmProviders.gemini),
			custom: cloneLlmProviderSettings(snapshot.llmProviders.custom),
		},
	};
}

function cloneRagSettings(snapshot: SettingsModelSnapshot): RagSettings {
	const provider = snapshot.ragProviders.moark;
	return {
		enabled: snapshot.knowledgeBaseEnabled,
		activeProvider: snapshot.activeRagProvider,
		providers: {
			moark: {
				apiKey: provider.apiKey,
				baseUrl: provider.baseUrl,
				embeddingModel: provider.embeddingModel,
				rerankerModel: provider.rerankerModel,
				embeddingPath: provider.embeddingPath,
				rerankPath: provider.rerankPath,
			},
		},
		retrievalCandidateCount: snapshot.retrievalCandidateCount,
		retrievalTopK: snapshot.retrievalTopK,
	};
}

function getEnabledModelOptions(
	snapshot: SettingsModelSnapshot,
): readonly ReturnType<typeof getLlmModelOptionsForProvider>[number][] {
	return llmProviderIds.flatMap(providerId => {
		const enabledModelOptions = snapshot.llmProviders[providerId].enabledModelOptions;
		if (!enabledModelOptions) {
			return [];
		}

		return getLlmModelOptionsForProvider(providerId, enabledModelOptions, {
			enabledOnly: true,
		});
	});
}

function createModelMetadata(
	snapshot: SettingsModelSnapshot,
	selectedModelId: string | undefined,
): readonly ILanguageModelChatMetadataAndIdentifier[] {
	return getEnabledModelOptions(snapshot).map(option => ({
		identifier: option.value,
		metadata: {
			name: option.label,
			id: option.value,
			vendor: option.providerId,
			version: option.model.id,
			family: option.model.id,
			detail: option.model.description,
			tooltip: option.title,
			maxInputTokens: option.model.input_token_limit,
			maxOutputTokens: option.model.max_output_tokens,
			isDefault: selectedModelId === option.value,
			isUserSelectable: true,
			targetChatSessionType: DefaultSessionTypeId,
			capabilities: {
				vision: option.model.supports_image_input,
				agentMode: true,
			},
		},
	}));
}

function createModelSignature(snapshot: SettingsModelSnapshot): string {
	return getEnabledModelOptions(snapshot).map(option => option.value).join('\n');
}

function createRequestLlmSettings(
	snapshot: SettingsModelSnapshot,
	modelId: string | undefined,
): LlmSettings {
	const settings = cloneLlmSettings(snapshot);
	if (modelId === undefined) {
		const activeProvider = settings.activeProvider;
		const enabledModelOptions = settings.providers[activeProvider].enabledModelOptions;
		if (!enabledModelOptions || getLlmModelOptionsForProvider(
			activeProvider,
			enabledModelOptions,
			{ enabledOnly: true },
		).length === 0) {
			throw new Error(localize(
				'defaultSessions.models.noneEnabled',
				"No enabled language model is available for automatic routing.",
			));
		}

		return {
			...settings,
			providers: {
				...settings.providers,
				[activeProvider]: {
					...settings.providers[activeProvider],
					selectedModelOption: '',
				},
			},
		};
	}

	if (!getEnabledModelOptions(snapshot).some(option => option.value === modelId)) {
		throw new Error(localize('defaultSessions.models.unavailable', "The selected language model is no longer enabled."));
	}
	const parsedModel = parseLlmModelOptionValue(modelId);
	if (!parsedModel) {
		throw new Error(`Enabled language model identifier '${modelId}' is invalid.`);
	}

	return {
		...settings,
		activeProvider: parsedModel.providerId,
		providers: {
			...settings.providers,
			[parsedModel.providerId]: {
				...settings.providers[parsedModel.providerId],
				selectedModelOption: modelId,
			},
		},
	};
}

function toAgentMessage(message: ChatMessage): AgentMessagePayload {
	return {
		role: message.role,
		parts: [
			{ type: 'text', text: message.content },
			...message.imageAttachments.map(attachment => ({
				type: 'image' as const,
				id: attachment.id,
				name: attachment.name,
				mimeType: attachment.mimeType,
				data: attachment.data,
			})),
		],
	};
}

const editorTrackedBlockNodeTypes = new Set([
	'paragraph',
	'heading',
	'blockquote',
	'bullet_list',
	'ordered_list',
	'figure',
	'figcaption',
]);

function validateEditorBlockIds(node: WritingEditorNode, blockIds: Set<string>): void {
	if (editorTrackedBlockNodeTypes.has(node.type)) {
		const blockId = node.attrs?.blockId;
		if (typeof blockId !== 'string' || !blockId.trim()) {
			throw new Error(localize(
				'defaultSessions.editor.missingBlock',
				"The Editor attachment contains a block without a stable ID.",
			));
		}
		if (blockIds.has(blockId)) {
			throw new Error(localize(
				'defaultSessions.editor.duplicateBlock',
				"The Editor attachment contains duplicate block IDs.",
			));
		}
		blockIds.add(blockId);
	}
	for (const child of node.content ?? []) {
		validateEditorBlockIds(child, blockIds);
	}
}

function validateEditorSelection(
	attachment: IChatRequestEditorAttachment,
	textUnits: readonly WritingEditorTextUnit[],
): void {
	const selection = attachment.selection;
	if (!selection) {
		return;
	}
	if (!selection.blockId.trim()
		|| !Number.isInteger(selection.startOffset)
		|| !Number.isInteger(selection.endOffset)
		|| selection.startOffset < 0
		|| selection.endOffset < selection.startOffset) {
		throw new Error(localize(
			'defaultSessions.editor.invalidSelectionOffsets',
			"The attached editor selection has invalid offsets.",
		));
	}

	const matchingTextUnits = textUnits.filter(textUnit => textUnit.blockId === selection.blockId);
	if (matchingTextUnits.length !== 1) {
		throw new Error(localize(
			'defaultSessions.editor.selectionBlockUnavailable',
			"The attached editor selection does not identify exactly one text block.",
		));
	}
	const textUnit = matchingTextUnits[0]!;
	if (selection.endOffset > textUnit.text.length) {
		throw new Error(localize(
			'defaultSessions.editor.selectionOutOfBounds',
			"The attached editor selection exceeds its text block.",
		));
	}
}

function resolveEditorContext(attachment: IChatRequestEditorAttachment): IResolvedEditorContext {
	if (!attachment.resource.scheme) {
		throw new Error(localize(
			'defaultSessions.editor.invalidResource',
			"An Editor attachment requires an absolute resource URI.",
		));
	}
	try {
		writingEditorSchema.nodeFromJSON(attachment.document);
	} catch (error) {
		throw new Error(
			localize('defaultSessions.editor.invalidDocument', "The Editor attachment contains an invalid document."),
			{ cause: error },
		);
	}

	const blockIds = new Set<string>();
	validateEditorBlockIds(attachment.document, blockIds);
	const textUnits = collectWritingEditorTextUnits(attachment.document);
	for (const textUnit of textUnits) {
		if (!blockIds.has(textUnit.blockId)) {
			throw new Error(localize(
				'defaultSessions.editor.untrackedTextBlock',
				"The Editor attachment contains a text block without a stable ID.",
			));
		}
	}
	validateEditorSelection(attachment, textUnits);
	return {
		attachment,
		selection: attachment.selection,
	};
}

function toArticleContext(detail: ArticleDetail): ArticleContextInput {
	return {
		sourceUrl: detail.url.toString(true),
		doi: detail.doi,
		title: detail.title,
		authors: detail.authors.map(author => author.name),
		abstract: detail.abstract,
		journalTitle: detail.publication.title,
		publishedAt: detail.publishedAt,
	};
}

function requestErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}
	const message = String(error).trim();
	return message || localize(
		'defaultSessions.request.failedWithoutMessage',
		"The agent request failed without an error message.",
	);
}

/** Default single-Chat Sessions provider backed by the desktop main-agent command. */
export class DefaultSessionsProvider extends Disposable implements ISessionsProvider {
	readonly id = DefaultSessionsProviderId;
	private readonly sessionTypesChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChangeSessionTypes: EventType<void> = this.sessionTypesChangeEmitter.event;
	private providerLabel: string;
	private sessionTypesValue: readonly ISessionType[];

	get label(): string {
		return this.providerLabel;
	}

	get sessionTypes(): readonly ISessionType[] {
		return this.sessionTypesValue;
	}

	private readonly sessionsChangeEmitter = this._register(new Emitter<ISessionsChangeEvent>());
	readonly onDidChangeSessions = this.sessionsChangeEmitter.event;
	private readonly modelsChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChangeModels = this.modelsChangeEmitter.event;

	private readonly sessions: IDefaultSessionRecord[] = [];
	private readonly activeRequests = new Map<string, IDefaultActiveRequest>();
	private readonly providerStorage: DefaultSessionsProviderStorage;
	private persistedSessions = new Map<string, IDefaultPersistedSession>();
	private draft: IDefaultSessionRecord | undefined;
	private modelSignature: string;
	private disposed = false;
	private modelPersistenceSuppression = 0;

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ISettingsModel private readonly settingsModel: SettingsModel,
		@IFetchService private readonly fetchService: IFetchService,
		@IChatService private readonly chatService: IChatService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		this.providerLabel = ui.defaultSessionsProviderLabel;
		this.sessionTypesValue = this.createSessionTypes(ui.defaultSessionsSessionType);
		if (!this.nativeHostService.canInvoke()) {
			throw new Error('The default Sessions provider requires the desktop native command bridge.');
		}

		this.providerStorage = new DefaultSessionsProviderStorage(storageService);
		this.restoreCommittedSessions();
		this.modelSignature = createModelSignature(this.settingsModel.getSnapshot());
		this._register(this.settingsModel.subscribe(() => this.handleSettingsChanged()));
		this._register(toDisposable(this.localeService.subscribe(() => this.handleLocaleChanged())));
	}

	getSessions(): readonly ISession[] {
		this.assertNotDisposed();
		return this.sessions.map(record => record.session);
	}

	getModels(session: ISession, chat: IChat): readonly ILanguageModelChatMetadataAndIdentifier[] {
		const record = this.requireRecord(session, true);
		this.requireMainChat(record, chat);
		return createModelMetadata(this.settingsModel.getSnapshot(), record.chat.modelId.get());
	}

	createSessionDraft(options: ISessionDraftOptions): ISession {
		this.assertNotDisposed();
		if (options.sessionType !== DefaultSessionTypeId) {
			throw new Error(`The default Sessions provider does not offer Session type '${options.sessionType}'.`);
		}
		if (this.draft) {
			throw new Error('The default Sessions provider already owns a Session draft.');
		}

		const resource = createDefaultSessionResource(generateUuid());
		const createdAt = new Date();
		const title = this.getNewChatTitle();
		const chat = new DefaultChat(resource, createdAt, createdAt, title, SessionStatus.Draft);
		const session = new DefaultSession(
			resource,
			chat,
			options.workspace,
			createdAt,
			createdAt,
			title,
			SessionStatus.Draft,
		);
		const lifetime = new DisposableStore();
		let chatModelReference: IChatModelReference;
		try {
			chatModelReference = lifetime.add(this.chatService.createModel(resource));
		} catch (error) {
			lifetime.dispose();
			throw error;
		}
		this.draft = { session, chat, chatModelReference, lifetime };
		return session;
	}

	discardSessionDraft(session: ISession): void {
		this.assertNotDisposed();
		const draft = this.draft;
		if (!draft || draft.session !== session) {
			throw new Error(`Session '${session.sessionId}' is not the default provider's current draft.`);
		}

		this.draft = undefined;
		draft.lifetime.dispose();
	}

	async sendRequest(session: ISession, chat: IChat, request: IChatRequest): Promise<void> {
		let record = this.requireRecord(session, true);
		const initialRecord = record;
		const startedAsDraft = record === this.draft;
		const initialStatus = record.session.status.get();
		const initialUpdatedAt = new Date(record.session.updatedAt.get());
		this.requireMainChat(record, chat);
		if (chat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error(`Chat '${chat.resource.toString()}' is not interactive.`);
		}
		const resourceKey = getComparisonKey(record.chat.resource);
		if (this.activeRequests.has(resourceKey)) {
			throw new Error(`Chat '${record.chat.resource.toString()}' already has an active provider request.`);
		}

		const requestId = generateUuid();
		const cancellation = new CancellationTokenSource();
		let chatRequestTransaction: IChatRequestTransaction | undefined;
		this.activeRequests.set(resourceKey, { id: requestId, cancellation });

		try {
			const imageAttachments = request.attachments.filter(
				(attachment): attachment is IChatRequestImageAttachment =>
					attachment.kind === ChatRequestAttachmentKind.Image,
			).map(attachment => ({
				id: attachment.id,
				name: attachment.name,
				mimeType: attachment.mimeType,
				data: attachment.data,
			}));
			chatRequestTransaction = this.runWithoutModelPersistence(() => this.chatService.startRequest(
				chat.resource,
				requestId,
				request.prompt,
				imageAttachments,
			));
			if (record === this.draft) {
				const draftSession = record.session;
				record = this.commitDraft(record, request.prompt);
				this.sessionsChangeEmitter.fire({
					transitions: [{
						kind: SessionTransitionKind.Replaced,
						from: draftSession,
						to: record.session,
					}],
				});
			} else {
				record.session.setActivity(SessionStatus.Running, new Date());
				this.fireChanged(record.session);
			}

			const settingsSnapshot = this.settingsModel.getSnapshot();
			const llmSettings = createRequestLlmSettings(settingsSnapshot, record.chat.modelId.get());
			const ragSettings = cloneRagSettings(settingsSnapshot);
			const requestContext = await this.resolveRequestContext(
				record.chat.resource,
				request,
				cancellation,
			);
			const allMessages = record.chatModelReference.object.getSnapshot().messages
				.filter(message => message.includeInAgentHistory !== false)
				.map(toAgentMessage);
			const messages = createMainAgentHistoryWindow(allMessages, llmSettings);
			const mainAgentPayload: RunMainAgentTurnPayload = {
				messages,
				writingContext: requestContext.writingContext,
				editorSelection: requestContext.editorSelection,
				editorDocument: requestContext.editorDocument,
				articleContexts: [...requestContext.articleContexts],
				llm: llmSettings,
				rag: ragSettings,
				availableTools: [...requestContext.availableTools],
			};
			assertMainAgentPayloadByteLimits(mainAgentPayload);
			const result = await this.nativeHostService.invoke(
				'run_main_agent_turn',
				mainAgentPayload,
			) as RunMainAgentTurnResult;
			if (this.disposed) {
				throw new Error('The default Sessions provider was disposed while a request was running.');
			}

			const content = result.finalText.trim();
			if (!content) {
				throw new Error(localize('defaultSessions.request.emptyResponse', "The agent returned an empty response."));
			}
			if (result.lastPatchProposal && !requestContext.editorAttachment) {
				throw new Error('The main-agent command returned an editor patch without an Editor attachment.');
			}

			const preparedCompletion = chatRequestTransaction.prepareCompletion({
				content,
				result: result.lastEvidenceResult,
				patchProposal: result.lastPatchProposal && requestContext.editorAttachment
					? {
						proposal: result.lastPatchProposal,
						target: {
							resource: requestContext.editorAttachment.resource,
							document: requestContext.editorAttachment.document,
						},
					}
					: null,
			});
			const completedAt = new Date();
			this.persistCommittedSessions(this.sessions, {
				record,
				chatSnapshot: preparedCompletion.snapshot,
				status: SessionStatus.Completed,
				updatedAt: completedAt,
			});
			this.runWithoutModelPersistence(() => preparedCompletion.commit());
			record.session.setActivity(SessionStatus.Completed, completedAt);
			this.fireChanged(record.session);
		} catch (error) {
			cancellation.cancel();
			if (!this.disposed && chatRequestTransaction) {
				const activeRequest = record.chatModelReference.object.getSnapshot().activeRequest;
				if (activeRequest?.id === requestId) {
					try {
						const preparedFailure = chatRequestTransaction.prepareFailure(
							requestErrorMessage(error),
						);
						const failedAt = new Date();
						this.persistCommittedSessions(this.sessions, {
							record,
							chatSnapshot: preparedFailure.snapshot,
							status: SessionStatus.Failed,
							updatedAt: failedAt,
						});
						this.runWithoutModelPersistence(() => preparedFailure.commit());
						record.session.setActivity(SessionStatus.Failed, failedAt);
						this.fireChanged(record.session);
					} catch (failureError) {
						const errors = [error, failureError];
						if (record.chatModelReference.object.getSnapshot().activeRequest?.id === requestId) {
							try {
								this.rollbackRequest(
									chatRequestTransaction,
									initialRecord,
									record,
									startedAsDraft,
									initialStatus,
									initialUpdatedAt,
								);
							} catch (rollbackError) {
								errors.push(rollbackError);
							}
						}
						throw new AggregateError(
							errors,
							errors.length > 2
								? localize(
									'defaultSessions.request.rollbackFailed',
									"The request could not commit a terminal state, and its rollback also failed.",
								)
								: localize(
									'defaultSessions.request.rolledBack',
									"The request could not commit a terminal state and was rolled back.",
								),
						);
					}
				}
			}
			throw error;
		} finally {
			const activeRequest = this.activeRequests.get(resourceKey);
			if (activeRequest?.id === requestId) {
				this.activeRequests.delete(resourceKey);
			}
			cancellation.dispose();
		}
	}

	private rollbackRequest(
		chatRequestTransaction: IChatRequestTransaction,
		initialRecord: IDefaultSessionRecord,
		currentRecord: IDefaultSessionRecord,
		startedAsDraft: boolean,
		initialStatus: SessionStatus,
		initialUpdatedAt: Date,
	): void {
		this.runWithoutModelPersistence(() => chatRequestTransaction.rollback());
		if (!startedAsDraft) {
			initialRecord.session.setActivity(initialStatus, initialUpdatedAt);
			this.fireChanged(initialRecord.session);
			return;
		}

		if (currentRecord === initialRecord) {
			return;
		}

		const index = this.sessions.indexOf(currentRecord);
		if (index === -1) {
			currentRecord.lifetime.dispose();
			throw new Error(`Session '${currentRecord.session.sessionId}' disappeared before its request rollback.`);
		}
		this.sessions.splice(index, 1);
		try {
			this.sessionsChangeEmitter.fire({
				transitions: [{ kind: SessionTransitionKind.Removed, session: currentRecord.session }],
			});
		} finally {
			currentRecord.lifetime.dispose();
		}
	}

	async createChat(session: ISession): Promise<IChat> {
		this.requireRecord(session, false);
		throw new Error('The default Sessions provider does not support additional Chats.');
	}

	async forkChat(session: ISession, sourceChat: IChat, _turnId: string): Promise<IChat> {
		const record = this.requireRecord(session, false);
		this.requireMainChat(record, sourceChat);
		throw new Error('The default Sessions provider does not support Chat forks.');
	}

	async renameSession(session: ISession, title: string): Promise<void> {
		const record = this.requireRecord(session, false);
		const normalizedTitle = this.requireTitle(title);
		const previousTitle = record.session.title.get();
		const previousUpdatedAt = record.session.updatedAt.get();
		record.session.setTitle(normalizedTitle);
		record.session.setUpdatedAt(new Date());
		try {
			this.persistCommittedSessions();
		} catch (error) {
			record.session.setTitle(previousTitle);
			record.session.setUpdatedAt(previousUpdatedAt);
			throw error;
		}
		this.fireChanged(record.session);
	}

	async renameChat(session: ISession, chat: IChat, title: string): Promise<void> {
		const record = this.requireRecord(session, false);
		this.requireMainChat(record, chat);
		const normalizedTitle = this.requireTitle(title);
		const previousTitle = record.chat.title.get();
		const previousUpdatedAt = record.session.updatedAt.get();
		record.chat.setTitle(normalizedTitle);
		record.session.setUpdatedAt(new Date());
		try {
			this.persistCommittedSessions();
		} catch (error) {
			record.chat.setTitle(previousTitle);
			record.session.setUpdatedAt(previousUpdatedAt);
			throw error;
		}
		this.fireChanged(record.session);
	}

	async setChatModel(session: ISession, chat: IChat, modelId: string | undefined): Promise<void> {
		const record = this.requireRecord(session, true);
		this.requireMainChat(record, chat);
		if (modelId !== undefined
			&& !createModelMetadata(this.settingsModel.getSnapshot(), record.chat.modelId.get())
				.some(model => model.identifier === modelId)) {
			throw new Error(`Language model '${modelId}' is not enabled for the default Sessions provider.`);
		}

		const previousModelId = record.chat.modelId.get();
		const previousUpdatedAt = record.session.updatedAt.get();
		record.chat.setModelId(modelId);
		record.session.setUpdatedAt(new Date());
		if (record === this.draft) {
			return;
		}
		try {
			this.persistCommittedSessions();
		} catch (error) {
			record.chat.setModelId(previousModelId);
			record.session.setUpdatedAt(previousUpdatedAt);
			throw error;
		}
		this.fireChanged(record.session);
	}

	async setSessionArchived(session: ISession, _archived: boolean): Promise<void> {
		this.requireRecord(session, false);
		throw new Error('The default Sessions provider does not support archiving.');
	}

	async deleteSession(session: ISession): Promise<void> {
		const record = this.requireRecord(session, false);
		if (record.session.status.get() === SessionStatus.Running) {
			throw new Error(`Running Session '${session.sessionId}' cannot be deleted.`);
		}
		const index = this.sessions.indexOf(record);
		if (index === -1) {
			throw new Error(`Session '${session.sessionId}' is not committed.`);
		}

		const remaining = this.sessions.filter(candidate => candidate !== record);
		this.persistCommittedSessions(remaining);
		this.sessions.splice(index, 1);
		this.sessionsChangeEmitter.fire({
			transitions: [{ kind: SessionTransitionKind.Removed, session: record.session }],
		});
		record.lifetime.dispose();
	}

	async deleteChat(session: ISession, chat: IChat): Promise<void> {
		const record = this.requireRecord(session, false);
		this.requireMainChat(record, chat);
		throw new Error('The default Sessions provider cannot delete its main Chat independently.');
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		for (const request of this.activeRequests.values()) {
			request.cancellation.cancel();
			request.cancellation.dispose();
		}
		this.activeRequests.clear();
		this.draft?.lifetime.dispose();
		this.draft = undefined;
		for (const record of this.sessions.splice(0)) {
			record.lifetime.dispose();
		}
		super.dispose();
	}

	private commitDraft(draft: IDefaultSessionRecord, prompt: string): IDefaultSessionRecord {
		if (this.draft !== draft) {
			throw new Error(`Session '${draft.session.sessionId}' is not the current default Session draft.`);
		}

		const title = prompt.trim().slice(0, 18).trimEnd();
		const createdAt = draft.session.createdAt;
		const updatedAt = new Date();
		const chat = new DefaultChat(draft.chat.resource, createdAt, updatedAt, title, SessionStatus.Running);
		chat.setModelId(draft.chat.modelId.get());
		const session = new DefaultSession(
			draft.session.resource,
			chat,
			draft.session.workspace.get(),
			createdAt,
			updatedAt,
			title,
			SessionStatus.Running,
		);
		const committed: IDefaultSessionRecord = {
			session,
			chat,
			chatModelReference: draft.chatModelReference,
			lifetime: draft.lifetime,
		};

		this.draft = undefined;
		this.sessions.push(committed);
		this.subscribeToRecord(committed);
		return committed;
	}

	private async resolveRequestContext(
		chatResource: IChat['resource'],
		request: IChatRequest,
		cancellation: CancellationTokenSource,
	): Promise<IResolvedRequestContext> {
		let editorAttachment: IChatRequestEditorAttachment | undefined;
		const articleAttachments: IChatRequestArticleAttachment[] = [];
		const articleIds = new Set<string>();
		const textAttachments: IChatRequestTextAttachment[] = [];

		for (const attachment of request.attachments) {
			switch (attachment.kind) {
				case ChatRequestAttachmentKind.Resource:
					throw new Error(localize(
						'defaultSessions.attachments.resourceUnsupported',
						"The default Sessions provider cannot read Resource attachments.",
					));
				case ChatRequestAttachmentKind.Text:
					if (!attachment.content.trim() || !attachment.mimeType.trim()) {
						throw new Error(localize(
							'defaultSessions.attachments.invalidText',
							"A Text attachment requires non-empty content and a MIME type.",
						));
					}
					textAttachments.push(attachment);
					break;
				case ChatRequestAttachmentKind.Article:
					if (!attachment.articleId.trim()) {
						throw new Error(localize(
							'defaultSessions.attachments.invalidArticle',
							"An Article attachment requires an Article ID.",
						));
					}
					if (articleIds.has(attachment.articleId)) {
						throw new Error(`Article '${attachment.articleId}' is attached more than once.`);
					}
					articleIds.add(attachment.articleId);
					articleAttachments.push(attachment);
					break;
				case ChatRequestAttachmentKind.Editor:
					if (editorAttachment) {
						throw new Error(localize(
							'defaultSessions.attachments.multipleEditors',
							"The default Sessions provider accepts at most one Editor attachment.",
						));
					}
					editorAttachment = attachment;
					break;
				case ChatRequestAttachmentKind.Image:
					break;
				default:
					throw new Error('The default Sessions provider received an unknown attachment kind.');
			}
		}

		const editorContext = editorAttachment ? resolveEditorContext(editorAttachment) : undefined;
		const writingContext = textAttachments.map(attachment => {
			return [`[attachment: ${attachment.name}]`, attachment.content].join('\n');
		}).join('\n\n');
		const resolvedArticles = articleAttachments.map(attachment => ({
			attachment,
			article: this.fetchService.getArticle(attachment.articleId),
		}));
		const unavailableArticleIds = resolvedArticles
			.filter(entry => !entry.article)
			.map(entry => entry.attachment.articleId);
		if (unavailableArticleIds.length > 0) {
			this.chatService.removeArticleChecks(chatResource, unavailableArticleIds);
			throw new Error(`Articles are unavailable: ${unavailableArticleIds.join(', ')}.`);
		}

		const articleContexts: ArticleContextInput[] = [];
		for (const { attachment, article } of resolvedArticles) {
			if (!article) {
				throw new Error('An Article disappeared from the captured request context.');
			}
			if (article.id !== attachment.articleId) {
				throw new Error(`Article record '${article.id}' does not match attachment '${attachment.articleId}'.`);
			}
			const detail = this.fetchService.getArticleDetail(attachment.articleId)
				?? await this.fetchService.fetchArticle(attachment.articleId, cancellation.token);
			if (detail.articleId !== attachment.articleId) {
				throw new Error(`Article detail '${detail.articleId}' does not match attachment '${attachment.articleId}'.`);
			}
			articleContexts.push(toArticleContext(detail));
		}

		const availableTools: MainAgentAvailableToolId[] = [];
		if (editorContext) {
			availableTools.push('get_selection_context', 'list_text_units', 'apply_editor_patch');
		}
		if (articleContexts.length > 0) {
			availableTools.push('retrieve_evidence');
		}

		return {
			writingContext: writingContext || null,
			editorSelection: editorContext?.selection ?? null,
			editorDocument: editorContext?.attachment.document ?? null,
			editorAttachment,
			articleContexts,
			availableTools,
		};
	}

	private restoreCommittedSessions(): void {
		const persisted = this.providerStorage.load();
		const records: IDefaultSessionRecord[] = [];
		const lifetimes: DisposableStore[] = [];
		try {
			for (const state of persisted) {
				const resource = createDefaultSessionResource(state.conversationId);
				const lifetime = new DisposableStore();
				lifetimes.push(lifetime);
				const chatModelReference = lifetime.add(this.chatService.createModel(resource, {
					input: state.chatState.input,
					messages: state.chatState.messages,
					errorMessage: state.chatState.errorMessage,
				}));
				const chat = new DefaultChat(
					resource,
					state.createdAt,
					state.updatedAt,
					state.chatTitle,
					state.status,
				);
				chat.setModelId(state.modelId);
				const session = new DefaultSession(
					resource,
					chat,
					state.workspace,
					state.createdAt,
					state.updatedAt,
					state.sessionTitle,
					state.status,
				);
				records.push({ session, chat, chatModelReference, lifetime });
			}
		} catch (error) {
			for (const lifetime of lifetimes) {
				lifetime.dispose();
			}
			throw error;
		}

		this.sessions.push(...records);
		this.persistedSessions = new Map(persisted.map(state => [state.conversationId, state]));
		for (const record of records) {
			this.subscribeToRecord(record);
		}
	}

	private subscribeToRecord(record: IDefaultSessionRecord): void {
		record.lifetime.add(record.chatModelReference.object.onDidChange(() => {
			if (this.modelPersistenceSuppression === 0) {
				this.persistCommittedSessions();
			}
		}));
	}

	private runWithoutModelPersistence<T>(callback: () => T): T {
		this.modelPersistenceSuppression += 1;
		try {
			return callback();
		} finally {
			this.modelPersistenceSuppression -= 1;
		}
	}

	private createPersistedSession(
		record: IDefaultSessionRecord,
		projection?: IDefaultSessionPersistenceProjection,
	): IDefaultPersistedSession | undefined {
		if (projection && projection.record !== record) {
			throw new Error('A default Session persistence projection targets a different record.');
		}
		const snapshot = projection?.chatSnapshot ?? record.chatModelReference.object.getSnapshot();
		const status = projection?.status ?? record.session.status.get();
		if (status === SessionStatus.Running || snapshot.activeRequest) {
			return undefined;
		}
		if (status !== SessionStatus.Completed && status !== SessionStatus.Failed) {
			throw new Error(`Committed default Session '${record.session.sessionId}' has a non-stable status.`);
		}
		if (!projection && record.chat.status.get() !== status) {
			throw new Error(`Default Session '${record.session.sessionId}' and its main Chat have different statuses.`);
		}
		if (!projection && record.session.updatedAt.get().getTime() !== record.chat.updatedAt.get().getTime()) {
			throw new Error(`Default Session '${record.session.sessionId}' and its main Chat have different activity times.`);
		}
		const updatedAt = projection?.updatedAt ?? record.session.updatedAt.get();
		return {
			conversationId: getDefaultSessionConversationId(record.session.resource),
			createdAt: new Date(record.session.createdAt),
			updatedAt: new Date(updatedAt),
			sessionTitle: record.session.title.get(),
			chatTitle: record.chat.title.get(),
			status,
			workspace: record.session.workspace.get(),
			modelId: record.chat.modelId.get(),
			chatState: {
				input: snapshot.input,
				messages: snapshot.messages,
				errorMessage: snapshot.errorMessage,
			},
		};
	}

	private persistCommittedSessions(
		records: readonly IDefaultSessionRecord[] = this.sessions,
		projection?: IDefaultSessionPersistenceProjection,
	): void {
		const candidate: IDefaultPersistedSession[] = [];
		for (const record of records) {
			const conversationId = getDefaultSessionConversationId(record.session.resource);
			const stable = this.createPersistedSession(
				record,
				projection?.record === record ? projection : undefined,
			);
			if (stable) {
				candidate.push(stable);
				continue;
			}
			const previous = this.persistedSessions.get(conversationId);
			if (previous) {
				candidate.push(previous);
			}
		}
		const normalized = this.providerStorage.store(candidate);
		this.persistedSessions = new Map(normalized.map(state => [state.conversationId, state]));
	}

	private requireRecord(session: ISession, includeDraft: boolean): IDefaultSessionRecord {
		this.assertNotDisposed();
		const committed = this.sessions.find(record => record.session === session);
		if (committed) {
			return committed;
		}
		if (includeDraft && this.draft?.session === session) {
			return this.draft;
		}
		throw new Error(`Session '${session.sessionId}' is not owned by the default Sessions provider.`);
	}

	private requireMainChat(record: IDefaultSessionRecord, chat: IChat): void {
		if (record.chat !== chat) {
			throw new Error(`Chat '${chat.resource.toString()}' is not the Session's default main Chat.`);
		}
	}

	private requireTitle(title: string): string {
		const normalizedTitle = title.trim();
		if (!normalizedTitle) {
			throw new Error('A default Session title must not be empty.');
		}
		return normalizedTitle;
	}

	private fireChanged(session: DefaultSession): void {
		this.sessionsChangeEmitter.fire({
			transitions: [{ kind: SessionTransitionKind.Changed, session }],
		});
	}

	private handleSettingsChanged(): void {
		const modelSignature = createModelSignature(this.settingsModel.getSnapshot());
		if (modelSignature === this.modelSignature) {
			return;
		}

		this.modelSignature = modelSignature;
		this.modelsChangeEmitter.fire();
	}

	private handleLocaleChanged(): void {
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		const draft = this.draft;
		if (draft) {
			const title = ui.assistantSidebarNewConversation;
			draft.session.setTitle(title);
			draft.chat.setTitle(title);
		}
		this.providerLabel = ui.defaultSessionsProviderLabel;
		this.sessionTypesValue = this.createSessionTypes(ui.defaultSessionsSessionType);
		this.sessionTypesChangeEmitter.fire();
	}

	private createSessionTypes(label: string): readonly ISessionType[] {
		return Object.freeze([Object.freeze({
			id: DefaultSessionTypeId,
			label,
			icon: Codicon.agent,
			supportsWorkspaceLess: true,
		})]);
	}

	private getNewChatTitle(): string {
		return this.languageService.getLocaleMessages(
			this.localeService.getLocale(),
		).assistantSidebarNewConversation;
	}

	private assertNotDisposed(): void {
		if (this.disposed) {
			throw new Error('The default Sessions provider has been disposed.');
		}
	}
}
