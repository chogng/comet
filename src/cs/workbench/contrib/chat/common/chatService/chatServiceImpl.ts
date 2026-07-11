/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import type {
  AgentMessagePayload,
  ArticleContextInput,
  MainAgentPatchProposal,
  RagAnswerResult,
  RunMainAgentTurnResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  applyWritingEditorEdits,
  collectWritingEditorTextUnits,
} from 'cs/editor/common/writingEditorDocument';
import type {
	ChatConversation,
	ChatMessage,
	ChatPatchProposal,
	ChatServiceContext,
	ChatServiceSnapshot,
	IChatService,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatService as IChatServiceDecorator } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
  formatChatAnswerFailedMessage,
  formatChatPatchApplyFailedMessage,
  localizeChatError,
} from 'cs/workbench/common/chatErrorMessages';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';
import { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import type { LocaleMessages } from 'language/locales';

type ChatServiceState = {
  conversations: ChatConversation[];
  activeConversationId: string;
  checkedArticleIds: readonly ArticleId[];
};

function toAgentMessage(
  message: Extract<ChatMessage, { role: "user" | "assistant" }>,
): AgentMessagePayload {
  return {
    role: message.role,
    parts: [
      {
        type: "text",
        text: message.content,
      },
    ],
  };
}

function createChatResultFromAgentTurn(
  result: RunMainAgentTurnResult,
  context: ChatServiceContext,
): RagAnswerResult {
  const evidenceResult = result.lastEvidenceResult;
  const ragProvider = evidenceResult?.provider ?? context.ragSettings.activeProvider;
  const ragProviderSettings = context.ragSettings.providers[ragProvider];

  return {
    answer: result.finalText || evidenceResult?.answer || "",
    evidence: evidenceResult?.evidence ?? [],
    provider: ragProvider,
    llmProvider: evidenceResult?.llmProvider ?? result.llmProvider,
    llmModel: evidenceResult?.llmModel ?? result.llmModel,
    embeddingModel:
      evidenceResult?.embeddingModel ?? ragProviderSettings.embeddingModel,
    rerankerModel:
      evidenceResult?.rerankerModel ?? ragProviderSettings.rerankerModel,
    rerankApplied: evidenceResult?.rerankApplied ?? false,
  };
}

function createChatPatchProposal(
  patchProposal: MainAgentPatchProposal | null,
): ChatPatchProposal | null {
  if (!patchProposal) {
    return null;
  }

  return {
    ...patchProposal,
    isApplied: false,
    applyError: null,
  };
}

function canApplyChatPatch(
  patchProposal: ChatPatchProposal,
) {
  return (
    patchProposal.accepted &&
    !patchProposal.requiresCustomExecutor &&
    !patchProposal.validationError &&
    !patchProposal.isApplied
  );
}

function createMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAgentTextMessage(
  message: ChatMessage,
): message is Extract<ChatMessage, { role: "user" | "assistant" }> {
  return (
    (message.role === "user" || message.role === "assistant") &&
    message.includeInAgentHistory !== false
  );
}

function createArticleFetchEmptyMessageContent(
  sourceLabel: string,
  message: string,
): string {
  const normalizedSourceLabel = sourceLabel.trim();
  return [
    `> ${message}`,
    normalizedSourceLabel ? `> ${normalizedSourceLabel}` : '',
  ].filter(Boolean).join('\n');
}

function createConversationId() {
  return `conversation-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createDefaultConversationTitle(ui: LocaleMessages, index: number) {
  void index;
  return ui.assistantSidebarNewConversation;
}

function createConversation(
  ui: LocaleMessages,
  index: number,
): ChatConversation {
  return {
    id: createConversationId(),
    title: createDefaultConversationTitle(ui, index),
    autoTitleIndex: index,
    question: "",
    result: null,
    messages: [],
    isAsking: false,
    errorMessage: null,
  };
}

function normalizeState(state: ChatServiceState): ChatServiceState {
  const activeConversationExists = state.conversations.some(
    (conversation) => conversation.id === state.activeConversationId
  );
  const nextActiveConversationId =
    activeConversationExists
      ? state.activeConversationId
      : state.conversations[0]?.id ?? "";

  if (nextActiveConversationId === state.activeConversationId) {
    return state;
  }

  return {
    ...state,
    activeConversationId: nextActiveConversationId,
  };
}

function createSnapshot(state: ChatServiceState): ChatServiceSnapshot {
  const activeConversation =
    state.conversations.find(
      (conversation) => conversation.id === state.activeConversationId
    ) ?? state.conversations[0] ?? null;

  return {
    ...state,
    activeConversation,
    question: activeConversation?.question ?? "",
    messages: activeConversation?.messages ?? [],
    result: activeConversation?.result ?? null,
    isAsking: activeConversation?.isAsking ?? false,
    errorMessage: activeConversation?.errorMessage ?? null,
  };
}

export class ChatService implements IChatService {
  declare readonly _serviceBrand: undefined;
  private context: ChatServiceContext | null = null;
  private state: ChatServiceState = {
    conversations: [],
    activeConversationId: '',
    checkedArticleIds: [],
  };
  private snapshot: ChatServiceSnapshot = createSnapshot(this.state);
  private readonly onDidChangeEmitter = new EventEmitter<void>();

  constructor(
    @INotificationService private readonly notificationService: INotificationService,
    @IFetchService private readonly fetchService: IFetchService,
  ) {}

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: ChatServiceContext) => {
    this.context = context;
    this.updateState((state) => {
      if (state.conversations.length === 0) {
        const initialConversation = createConversation(context.ui, 0);
        return {
          ...state,
          conversations: [initialConversation],
          activeConversationId: initialConversation.id,
        };
      }

      let changed = false;
      const nextConversations = state.conversations.map((conversation) => {
        if (conversation.autoTitleIndex === null) {
          return conversation;
        }

        const nextTitle = createDefaultConversationTitle(
          context.ui,
          conversation.autoTitleIndex,
        );
        if (conversation.title === nextTitle) {
          return conversation;
        }

        changed = true;
        return {
          ...conversation,
          title: nextTitle,
        };
      });

      if (!changed) {
        return state;
      }

      return {
        ...state,
        conversations: nextConversations,
      };
    });
  };

  readonly setQuestion = (value: string) => {
    this.updateActiveConversation((conversation) => ({
      ...conversation,
      question: value,
      errorMessage: null,
    }));
  };

  readonly createConversation = () => {
    const context = this.getContext();
    let nextConversationId = '';
    this.updateState((state) => {
      const nextConversation = createConversation(
        context.ui,
        state.conversations.length,
      );
      nextConversationId = nextConversation.id;
      return {
        ...state,
        conversations: [...state.conversations, nextConversation],
        activeConversationId: nextConversation.id,
      };
    });
    return nextConversationId;
  };

  readonly activateConversation = (conversationId: string) => {
    this.updateState((state) => {
      if (
        state.activeConversationId === conversationId ||
        !state.conversations.some(
          (conversation) => conversation.id === conversationId
        )
      ) {
        return state;
      }

      return {
        ...state,
        activeConversationId: conversationId,
      };
    });
  };

  readonly closeConversation = (conversationId: string) => {
    this.updateState((state) => {
      if (state.conversations.length <= 1) {
        return state;
      }

      const closedConversationIndex = state.conversations.findIndex(
        (conversation) => conversation.id === conversationId
      );
      if (closedConversationIndex < 0) {
        return state;
      }

      const nextConversations = state.conversations.filter(
        (conversation) => conversation.id !== conversationId
      );
      const nextActiveConversationId =
        state.activeConversationId === conversationId
          ? nextConversations[
              Math.min(closedConversationIndex, nextConversations.length - 1)
            ]?.id ?? nextConversations[0]?.id ?? ""
          : state.activeConversationId;

      return {
        ...state,
        conversations: nextConversations,
        activeConversationId: nextActiveConversationId,
      };
    });
  };

  readonly insertContextMessage = (
    title: string,
    content: string,
  ) => {
    const context = this.getContext();
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      return;
    }

    this.updateActiveConversation((conversation) => {
      const isFirstMessage = conversation.messages.length === 0;
      const firstContentLine = normalizedContent.split(/\r?\n/, 1)[0] ?? '';
      const titleContent = normalizedTitle || firstContentLine;

      return {
        ...conversation,
        title: isFirstMessage
          ? titleContent.slice(0, 18) ||
            createDefaultConversationTitle(
              context.ui,
              conversation.autoTitleIndex ?? 0,
            )
          : conversation.title,
        autoTitleIndex: isFirstMessage ? null : conversation.autoTitleIndex,
        messages: [
          ...conversation.messages,
          {
            id: createMessageId(),
            role: "user",
            content: normalizedContent,
          },
        ],
        errorMessage: null,
      };
    });
  };

  readonly insertArticleList = (
    sourceLabel: string,
    articleIds: readonly ArticleId[],
    content: string,
  ) => {
    if (articleIds.length === 0 || !content.trim()) {
      return;
    }

    const context = this.getContext();
    const activeConversation = this.snapshot.activeConversation;
    if (!activeConversation) {
      return;
    }

    this.updateState((state) => {
      const insertedMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content,
        includeInAgentHistory: false,
        articleList: { articleIds: [...articleIds] },
      };
      let changed = false;
      const nextConversations = state.conversations.map((conversation) => {
        if (conversation.id !== activeConversation.id) {
          return conversation;
        }

        const isFirstMessage = conversation.messages.length === 0;
        const sourceTitle = sourceLabel.trim().slice(0, 18);

        changed = true;
        return {
          ...conversation,
          title: isFirstMessage
            ? sourceTitle ||
              createDefaultConversationTitle(
                context.ui,
                conversation.autoTitleIndex ?? 0,
              )
            : conversation.title,
          autoTitleIndex: isFirstMessage ? null : conversation.autoTitleIndex,
          messages: [
            ...conversation.messages,
            insertedMessage,
          ],
          errorMessage: null,
        };
      });

      if (!changed) {
        return state;
      }

      return {
        ...state,
        conversations: nextConversations,
      };
    });
  };

  readonly insertArticleFetchEmptyResult = (
    sourceLabel: string,
    message: string,
  ) => {
    const context = this.getContext();
    this.updateActiveConversation((conversation) => {
      const isFirstMessage = conversation.messages.length === 0;
      const sourceTitle = sourceLabel.trim().slice(0, 18);

      return {
        ...conversation,
        title: isFirstMessage
          ? sourceTitle ||
            createDefaultConversationTitle(
              context.ui,
              conversation.autoTitleIndex ?? 0,
            )
          : conversation.title,
        autoTitleIndex: isFirstMessage ? null : conversation.autoTitleIndex,
        messages: [
          ...conversation.messages,
          {
            id: createMessageId(),
            role: "assistant",
            content: createArticleFetchEmptyMessageContent(sourceLabel, message),
            includeInAgentHistory: false,
          },
        ],
        errorMessage: null,
      };
    });
  };

  readonly applyPatch = (messageId: string) => {
    const activeConversation = this.snapshot.activeConversation;
    if (!activeConversation) {
      return;
    }
    const context = this.getContext();

    const assistantMessage = activeConversation.messages.find(
      (message): message is Extract<ChatMessage, { role: "assistant" }> =>
        message.id === messageId && message.role === "assistant",
    );
    const patchProposal = assistantMessage?.patchProposal ?? null;
    if (!patchProposal || !canApplyChatPatch(patchProposal)) {
      return;
    }

    const unavailableMessage = context.ui.assistantSidebarPatchUnavailable;
    const currentDocument = context.getDraftDocument?.() ?? null;
    const setDraftDocument = context.setDraftDocument;
    if (!currentDocument || !setDraftDocument) {
      this.updateConversationMessageById(
        activeConversation.id,
        messageId,
        (message) =>
          message.role !== "assistant" || !message.patchProposal
            ? message
            : {
                ...message,
                patchProposal: {
                  ...message.patchProposal,
                  applyError: unavailableMessage,
                },
              },
      );
      this.notificationService.error(
        formatChatPatchApplyFailedMessage(context.ui, unavailableMessage),
      );
      return;
    }

    const textEdits = patchProposal.patch.operations.flatMap((operation) =>
      operation.kind === "text-edit" ? [operation.edit] : [],
    );
    if (textEdits.length !== patchProposal.patch.operations.length) {
      const applyError = context.ui.assistantSidebarPatchRequiresExecutor;
      this.updateConversationMessageById(
        activeConversation.id,
        messageId,
        (message) =>
          message.role !== "assistant" || !message.patchProposal
            ? message
            : {
                ...message,
                patchProposal: {
                  ...message.patchProposal,
                  applyError,
                },
              },
      );
      this.notificationService.error(
        formatChatPatchApplyFailedMessage(context.ui, applyError),
      );
      return;
    }

    const applyResult = applyWritingEditorEdits(currentDocument, textEdits);
    if (!applyResult.ok) {
      this.updateConversationMessageById(
        activeConversation.id,
        messageId,
        (message) =>
          message.role !== "assistant" || !message.patchProposal
            ? message
            : {
                ...message,
                patchProposal: {
                  ...message.patchProposal,
                  applyError: applyResult.message,
                },
              },
      );
      this.notificationService.error(
        formatChatPatchApplyFailedMessage(context.ui, applyResult.message),
      );
      return;
    }

    setDraftDocument(applyResult.document);
    this.updateConversationMessageById(
      activeConversation.id,
      messageId,
      (message) =>
        message.role !== "assistant" || !message.patchProposal
          ? message
          : {
              ...message,
              patchProposal: {
                ...message.patchProposal,
                isApplied: true,
                applyError: null,
              },
            },
    );
    this.notificationService.info(context.ui.toastAssistantPatchApplied);
  };

  readonly ask = async () => {
    const activeConversation = this.snapshot.activeConversation;
    if (!activeConversation) {
      return;
    }
    const context = this.getContext();

    const normalizedQuestion = activeConversation.question.trim();
    if (!normalizedQuestion) {
      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        errorMessage: context.ui.assistantSidebarQuestionRequired,
      }));
      return;
    }

    if (!context.desktopRuntime) {
      this.notificationService.info(context.ui.toastDesktopLlmTestOnly);
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: normalizedQuestion,
    };

    this.updateConversationById(activeConversation.id, (conversation) => ({
      ...conversation,
      title:
        conversation.messages.length === 0
          ? normalizedQuestion.slice(0, 18) ||
            createDefaultConversationTitle(
              context.ui,
              conversation.autoTitleIndex ?? 0,
            )
          : conversation.title,
      autoTitleIndex: null,
      messages: [...conversation.messages, userMessage],
      question: "",
      isAsking: true,
      errorMessage: null,
    }));

    try {
      const articleContexts = await this.resolveCheckedArticleContexts();
      const fallbackWritingContext =
        context.getFallbackWritingContext?.() ?? context.fallbackWritingContext ?? '';
      const draftBody = context.getDraftBody?.() ?? '';
      const draftDocument = context.getDraftDocument?.() ?? null;
      const activeDraftStableSelectionTarget =
        context.getActiveDraftStableSelectionTarget?.() ?? null;
      const nextResult = await context.invokeDesktop<RunMainAgentTurnResult>("run_main_agent_turn", {
        messages: [...activeConversation.messages, userMessage]
          .filter(isAgentTextMessage)
          .map((message) => toAgentMessage(message)),
        writingContext: fallbackWritingContext.trim() || null,
        draftBody: draftBody.trim() || null,
        editorSelection: activeDraftStableSelectionTarget,
        editorDocument: draftDocument,
        editorTextUnits: draftDocument
          ? collectWritingEditorTextUnits(draftDocument)
          : [],
        articleContexts,
        llm: context.llmSettings,
        rag: context.ragSettings,
        availableTools: [
          "get_selection_context",
          "list_text_units",
          ...(draftDocument ? ["apply_editor_patch" as const] : []),
          ...(articleContexts.length > 0 ? ["retrieve_evidence" as const] : []),
        ],
      });
      const assistantResult = createChatResultFromAgentTurn(
        nextResult,
        context,
      );
      const assistantContent =
        nextResult.finalText.trim() || assistantResult.answer || "No answer returned.";

      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        result: assistantResult,
        messages: [
          ...conversation.messages,
          {
            id: createMessageId(),
            role: "assistant",
            content: assistantContent,
            result: assistantResult,
            patchProposal: createChatPatchProposal(
              nextResult.lastPatchProposal,
            ),
          },
        ],
      }));
    } catch (askError) {
      const localizedError = localizeChatError(context.ui, askError);

      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        errorMessage: localizedError,
        question: normalizedQuestion,
      }));
      this.notificationService.error(
        formatChatAnswerFailedMessage(context.ui, localizedError)
      );
    } finally {
      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        isAsking: false,
      }));
    }
  };

  readonly isArticleChecked = (articleId: ArticleId) => {
    return this.snapshot.checkedArticleIds.includes(articleId);
  };

  readonly setArticleChecked = (articleId: ArticleId, checked: boolean) => {
    this.updateState((state) => {
      const isChecked = state.checkedArticleIds.includes(articleId);
      if (isChecked === checked) {
        return state;
      }

      return {
        ...state,
        checkedArticleIds: checked
          ? [...state.checkedArticleIds, articleId]
          : state.checkedArticleIds.filter(id => id !== articleId),
      };
    });
  };

  readonly removeArticleChecks = (articleIds: readonly ArticleId[]) => {
    if (articleIds.length === 0) {
      return;
    }

    const removedArticleIds = new Set(articleIds);
    this.updateState((state) => {
      const checkedArticleIds = state.checkedArticleIds.filter(
        (articleId) => !removedArticleIds.has(articleId),
      );
      return checkedArticleIds.length === state.checkedArticleIds.length
        ? state
        : { ...state, checkedArticleIds };
    });
  };

  private getContext() {
    if (!this.context) {
      throw new Error('Chat service context has not been set.');
    }

    return this.context;
  }

  private async resolveCheckedArticleContexts(): Promise<ArticleContextInput[]> {
    const cancellation = new CancellationTokenSource();
    const unavailableIds: ArticleId[] = [];
    const contexts: ArticleContextInput[] = [];

    try {
      for (const articleId of this.snapshot.checkedArticleIds) {
        const article = this.fetchService.getArticle(articleId);
        if (!article) {
          unavailableIds.push(articleId);
          continue;
        }

        const detail = this.fetchService.getArticleDetail(articleId)
          ?? await this.fetchService.fetchArticle(articleId, cancellation.token);
        contexts.push({
          sourceUrl: detail.url.toString(true),
          doi: detail.doi,
          title: detail.title,
          authors: detail.authors.map(author => author.name),
          abstract: detail.abstract,
          journalTitle: detail.publication.title,
          publishedAt: detail.publishedAt,
        });
      }
    } finally {
      cancellation.dispose();
    }

    if (unavailableIds.length > 0) {
      this.updateState(state => ({
        ...state,
        checkedArticleIds: state.checkedArticleIds.filter(articleId => !unavailableIds.includes(articleId)),
      }));
      this.notificationService.info(this.getContext().ui.articleDetailsUnavailable);
    }

    return contexts;
  }

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setState(nextState: ChatServiceState) {
    if (Object.is(this.state, nextState)) {
      return;
    }

    this.state = nextState;
    this.snapshot = createSnapshot(this.state);
    this.emitChange();
  }

  private updateState(
    updater: (state: ChatServiceState) => ChatServiceState
  ) {
    const nextState = normalizeState(updater(this.state));
    this.setState(nextState);
  }

  private updateActiveConversation(
    updater: (
      conversation: ChatConversation
    ) => ChatConversation
  ) {
    const activeConversation = this.snapshot.activeConversation;
    if (!activeConversation) {
      return;
    }

    this.updateConversationById(activeConversation.id, updater);
  }

  private updateConversationById(
    conversationId: string,
    updater: (
      conversation: ChatConversation
    ) => ChatConversation
  ) {
    this.updateState((state) => {
      let changed = false;
      const nextConversations = state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        const nextConversation = updater(conversation);
        if (!Object.is(nextConversation, conversation)) {
          changed = true;
        }
        return nextConversation;
      });

      if (!changed) {
        return state;
      }

      return {
        ...state,
        conversations: nextConversations,
      };
    });
  }

  private updateConversationMessageById(
    conversationId: string,
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) {
    this.updateConversationById(conversationId, (conversation) => {
      let changed = false;
      const nextMessages = conversation.messages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const nextMessage = updater(message);
        if (!Object.is(nextMessage, message)) {
          changed = true;
        }
        return nextMessage;
      });

      if (!changed) {
        return conversation;
      }

      return {
        ...conversation,
        messages: nextMessages,
      };
    });
  }
}

registerSingleton(IChatServiceDecorator, ChatService, InstantiationType.Delayed);
