import { toast } from "ls/base/browser/ui/toast/toast";
import { EventEmitter } from "ls/base/common/event";
import type {
  AgentMessagePayload,
  Article,
  LlmSettings,
  MainAgentPatchProposal,
  RagAnswerResult,
  RagSettings,
  RunMainAgentTurnResult,
} from "ls/base/parts/sandbox/common/sandboxTypes";
import type { ElectronInvoke } from "ls/base/parts/sandbox/common/electronTypes";
import {
  applyWritingEditorEdits,
  collectWritingEditorTextUnits,
} from "ls/editor/common/writingEditorDocument";
import type {
  WritingEditorDocument,
  WritingEditorStableSelectionTarget,
} from "ls/editor/common/writingEditorDocument";
import type { LocaleMessages } from "language/locales";
import {
  formatLocalized,
  localizeDesktopInvokeError,
  parseDesktopInvokeError,
} from "ls/workbench/services/desktop/desktopError";

export type AssistantModelContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
  ui: LocaleMessages;
  isKnowledgeBaseModeEnabled: boolean;
  articles: Article[];
  llmSettings: LlmSettings;
  ragSettings: RagSettings;
  fallbackWritingContext?: string;
  getFallbackWritingContext?: () => string;
  getDraftBody?: () => string;
  getDraftDocument?: () => WritingEditorDocument | null;
  setDraftDocument?: (value: WritingEditorDocument) => void;
  getActiveDraftStableSelectionTarget?: () => WritingEditorStableSelectionTarget | null;
};

export type AssistantPatchProposal = MainAgentPatchProposal & {
  isApplied: boolean;
  applyError: string | null;
};

export type AssistantChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      result: RagAnswerResult;
      patchProposal?: AssistantPatchProposal | null;
    };

export type AssistantConversation = {
  id: string;
  title: string;
  autoTitleIndex: number | null;
  question: string;
  result: RagAnswerResult | null;
  messages: AssistantChatMessage[];
  isAsking: boolean;
  errorMessage: string | null;
};

type AssistantModelState = {
  conversations: AssistantConversation[];
  activeConversationId: string;
};

export type AssistantModelSnapshot = AssistantModelState & {
  activeConversation: AssistantConversation | null;
  question: string;
  messages: AssistantChatMessage[];
  result: RagAnswerResult | null;
  isAsking: boolean;
  errorMessage: string | null;
};

function toAgentMessage(
  message: AssistantChatMessage,
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

function createAssistantResultFromAgentTurn(
  result: RunMainAgentTurnResult,
  context: AssistantModelContext,
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

function createAssistantPatchProposal(
  patchProposal: MainAgentPatchProposal | null,
): AssistantPatchProposal | null {
  if (!patchProposal) {
    return null;
  }

  return {
    ...patchProposal,
    isApplied: false,
    applyError: null,
  };
}

function canApplyAssistantPatch(
  patchProposal: AssistantPatchProposal,
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
): AssistantConversation {
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

function normalizeState(state: AssistantModelState): AssistantModelState {
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

function createSnapshot(state: AssistantModelState): AssistantModelSnapshot {
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

export class AssistantModel {
  private context: AssistantModelContext;
  private state: AssistantModelState;
  private snapshot: AssistantModelSnapshot;
  private readonly onDidChangeEmitter = new EventEmitter<void>();

  constructor(context: AssistantModelContext) {
    this.context = context;

    const initialConversation = createConversation(context.ui, 0);
    this.state = {
      conversations: [initialConversation],
      activeConversationId: initialConversation.id,
    };
    this.snapshot = createSnapshot(this.state);
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: AssistantModelContext) => {
    this.context = context;
    this.updateState((state) => {
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

  readonly handleCreateConversation = () => {
    this.updateState((state) => {
      const nextConversation = createConversation(
        this.context.ui,
        state.conversations.length,
      );
      return {
        ...state,
        conversations: [...state.conversations, nextConversation],
        activeConversationId: nextConversation.id,
      };
    });
  };

  readonly handleActivateConversation = (conversationId: string) => {
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

  readonly handleCloseConversation = (conversationId: string) => {
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

  readonly handleApplyPatch = (messageId: string) => {
    const activeConversation = this.snapshot.activeConversation;
    if (!activeConversation) {
      return;
    }

    const assistantMessage = activeConversation.messages.find(
      (message): message is Extract<AssistantChatMessage, { role: "assistant" }> =>
        message.id === messageId && message.role === "assistant",
    );
    const patchProposal = assistantMessage?.patchProposal ?? null;
    if (!patchProposal || !canApplyAssistantPatch(patchProposal)) {
      return;
    }

    const unavailableMessage = this.context.ui.assistantSidebarPatchUnavailable;
    const currentDocument = this.context.getDraftDocument?.() ?? null;
    const setDraftDocument = this.context.setDraftDocument;
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
      toast.error(
        formatLocalized(this.context.ui.toastAssistantPatchApplyFailed, {
          error: unavailableMessage,
        }),
      );
      return;
    }

    const textEdits = patchProposal.patch.operations.flatMap((operation) =>
      operation.kind === "text-edit" ? [operation.edit] : [],
    );
    if (textEdits.length !== patchProposal.patch.operations.length) {
      const applyError = this.context.ui.assistantSidebarPatchRequiresExecutor;
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
      toast.error(
        formatLocalized(this.context.ui.toastAssistantPatchApplyFailed, {
          error: applyError,
        }),
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
      toast.error(
        formatLocalized(this.context.ui.toastAssistantPatchApplyFailed, {
          error: applyResult.message,
        }),
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
    toast.success(this.context.ui.toastAssistantPatchApplied);
  };

  readonly handleAsk = async () => {
    const activeConversation = this.snapshot.activeConversation;
    if (!activeConversation) {
      return;
    }

    const normalizedQuestion = activeConversation.question.trim();
    if (!normalizedQuestion) {
      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        errorMessage: this.context.ui.assistantSidebarQuestionRequired,
      }));
      return;
    }

    const context = this.context;
    if (!context.desktopRuntime) {
      toast.info(context.ui.toastDesktopLlmTestOnly);
      return;
    }

    const userMessage: AssistantChatMessage = {
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
      const retrievalArticles = context.isKnowledgeBaseModeEnabled
        ? context.articles
        : [];
      const fallbackWritingContext =
        context.getFallbackWritingContext?.() ?? context.fallbackWritingContext ?? '';
      const draftBody = context.getDraftBody?.() ?? '';
      const draftDocument = context.getDraftDocument?.() ?? null;
      const activeDraftStableSelectionTarget =
        context.getActiveDraftStableSelectionTarget?.() ?? null;
      const nextResult = await context.invokeDesktop("run_main_agent_turn", {
        messages: [...activeConversation.messages, userMessage].map((message) =>
          toAgentMessage(message),
        ),
        writingContext: fallbackWritingContext.trim() || null,
        draftBody: draftBody.trim() || null,
        editorSelection: activeDraftStableSelectionTarget,
        editorDocument: draftDocument,
        editorTextUnits: draftDocument
          ? collectWritingEditorTextUnits(draftDocument)
          : [],
        articles: retrievalArticles,
        llm: context.llmSettings,
        rag: context.ragSettings,
        availableTools: [
          "get_selection_context",
          "list_text_units",
          ...(draftDocument ? ["apply_editor_patch" as const] : []),
          ...(retrievalArticles.length > 0 ? ["retrieve_evidence" as const] : []),
        ],
      });
      const assistantResult = createAssistantResultFromAgentTurn(
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
            patchProposal: createAssistantPatchProposal(
              nextResult.lastPatchProposal,
            ),
          },
        ],
      }));
    } catch (askError) {
      const localizedError = localizeDesktopInvokeError(
        context.ui,
        parseDesktopInvokeError(askError)
      );

      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        errorMessage: localizedError,
        question: normalizedQuestion,
      }));
      toast.error(
        formatLocalized(context.ui.toastRagAnswerFailed, {
          error: localizedError,
        })
      );
    } finally {
      this.updateConversationById(activeConversation.id, (conversation) => ({
        ...conversation,
        isAsking: false,
      }));
    }
  };

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setState(nextState: AssistantModelState) {
    if (Object.is(this.state, nextState)) {
      return;
    }

    this.state = nextState;
    this.snapshot = createSnapshot(this.state);
    this.emitChange();
  }

  private updateState(
    updater: (state: AssistantModelState) => AssistantModelState
  ) {
    const nextState = normalizeState(updater(this.state));
    this.setState(nextState);
  }

  private updateActiveConversation(
    updater: (
      conversation: AssistantConversation
    ) => AssistantConversation
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
      conversation: AssistantConversation
    ) => AssistantConversation
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
    updater: (message: AssistantChatMessage) => AssistantChatMessage,
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

export function createAssistantModel(context: AssistantModelContext) {
  return new AssistantModel(context);
}
