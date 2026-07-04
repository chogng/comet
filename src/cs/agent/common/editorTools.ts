import type {
  WritingEditorDocument,
  WritingEditorStableEditTarget,
  WritingEditorStableSelectionTarget,
  WritingEditorTextUnit,
  WritingEditorTextUnitKind,
} from 'cs/editor/common/writingEditorDocument';
import type { AgentToolDescriptor } from 'cs/agent/common/protocol';

export type AgentEditorToolId =
  | 'get_selection_context'
  | 'list_text_units'
  | 'apply_editor_patch'
  | 'insert_citation_from_articles'
  | 'retrieve_evidence'
  | 'open_article_source';

export type AgentEditorPatchOperation =
  | {
      kind: 'text-edit';
      edit: WritingEditorStableEditTarget;
    }
  | {
      kind: 'insert-citation';
      anchorBlockId: string;
      citationIds: string[];
    }
  | {
      kind: 'insert-figure-ref';
      anchorBlockId: string;
      figureId: string;
    };

export type AgentEditorPatch = {
  label: string;
  summary?: string;
  operations: AgentEditorPatchOperation[];
};

export type GetSelectionContextInput = {
  includeDocument?: boolean;
};

export type GetSelectionContextResult = {
  selection: WritingEditorStableSelectionTarget | null;
  draftBody: string;
  document?: WritingEditorDocument;
};

export type ListTextUnitsInput = {
  kinds?: WritingEditorTextUnitKind[];
};

export type ListTextUnitsResult = {
  units: WritingEditorTextUnit[];
};

export type ApplyEditorPatchInput = AgentEditorPatch;

export type ApplyEditorPatchResult = {
  accepted: boolean;
  operationsValidated: number;
  failedOperationIndex: number | null;
  requiresCustomExecutor: boolean;
  validationError?: string;
};

export type InsertCitationFromArticlesInput = {
  articleSourceUrls: string[];
  anchorBlockId?: string | null;
  style?: 'inline' | 'narrative';
};

export type InsertCitationFromArticlesResult = {
  citationIds: string[];
  patch: AgentEditorPatch;
};

export type RetrieveEvidenceInput = {
  question: string;
  selectedSourceUrls?: string[];
  includeWritingContext?: boolean;
};

export type RetrieveEvidenceItem = {
  rank: number;
  title: string;
  journalTitle: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  score: number | null;
  excerpt: string;
};

export type RetrieveEvidenceResult = {
  answer: string;
  evidenceCount: number;
  sourceUrls: string[];
  evidence: RetrieveEvidenceItem[];
  provider?: string;
  llmProvider?: string;
  llmModel?: string;
  embeddingModel?: string;
  rerankerModel?: string;
  rerankApplied?: boolean;
};

export type OpenArticleSourceInput = {
  sourceUrl: string;
};

export type OpenArticleSourceResult = {
  opened: boolean;
  sourceUrl: string;
};

export type AgentEditorToolSpec = AgentToolDescriptor & {
  id: AgentEditorToolId;
};

export const agentEditorToolSpecs = [
  {
    id: 'get_selection_context',
    displayName: 'Get Selection Context',
    description:
      'Read the current stable editor selection, plus draft context for planning a targeted edit.',
    surface: 'renderer',
    safety: 'read',
    tags: ['editor', 'selection'],
    inputSchema: {
      type: 'object',
      properties: {
        includeDocument: {
          type: 'boolean',
          description: 'Include the normalized ProseMirror document snapshot.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'list_text_units',
    displayName: 'List Text Units',
    description:
      'List block-addressable writing units with stable blockId anchors for precise edits.',
    surface: 'renderer',
    safety: 'read',
    tags: ['editor', 'block-id'],
    inputSchema: {
      type: 'object',
      properties: {
        kinds: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'paragraph',
              'heading1',
              'heading2',
              'heading3',
              'blockquote',
              'figcaption',
            ],
          },
          description: 'Optional text-unit kind filter.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    id: 'apply_editor_patch',
    displayName: 'Apply Editor Patch',
    description:
      'Propose a reviewed editor patch for the current draft. Use list_text_units first, prefer text-edit operations, and only emit structured operations when a custom executor is strictly required.',
    surface: 'renderer',
    safety: 'write',
    requiresConfirmation: true,
    tags: ['editor', 'patch'],
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Short user-facing patch label.',
        },
        summary: {
          type: 'string',
          description: 'Optional patch summary shown in review UI.',
        },
        operations: {
          type: 'array',
          description: 'Patch operations in application order.',
        },
      },
      required: ['label', 'operations'],
      additionalProperties: false,
    },
  },
  {
    id: 'insert_citation_from_articles',
    displayName: 'Insert Citation From Articles',
    description:
      'Resolve article selections into editor citation nodes instead of raw text citations.',
    surface: 'renderer',
    safety: 'write',
    requiresConfirmation: true,
    tags: ['editor', 'citation'],
    inputSchema: {
      type: 'object',
      properties: {
        articleSourceUrls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Ordered source URLs backing the citation.',
        },
        anchorBlockId: {
          type: 'string',
          description: 'Optional insertion anchor in the current document.',
        },
        style: {
          type: 'string',
          enum: ['inline', 'narrative'],
          description: 'Preferred citation rendering style.',
        },
      },
      required: ['articleSourceUrls'],
      additionalProperties: false,
    },
  },
  {
    id: 'retrieve_evidence',
    displayName: 'Retrieve Evidence',
    description:
      'Run evidence retrieval over the knowledge base and optional writing context before drafting.',
    surface: 'main',
    safety: 'external',
    tags: ['rag', 'knowledge-base'],
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Evidence retrieval question.',
        },
        selectedSourceUrls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Optional source filter.',
        },
        includeWritingContext: {
          type: 'boolean',
          description: 'Blend the active writing context into retrieval.',
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    id: 'open_article_source',
    displayName: 'Open Article Source',
    description:
      'Open a cited or retrieved source in the existing article surface for validation.',
    surface: 'renderer',
    safety: 'external',
    tags: ['navigation', 'source'],
    inputSchema: {
      type: 'object',
      properties: {
        sourceUrl: {
          type: 'string',
          description: 'Article source URL to open.',
        },
      },
      required: ['sourceUrl'],
      additionalProperties: false,
    },
  },
] satisfies ReadonlyArray<AgentEditorToolSpec>;

export const agentEditorToolIds: AgentEditorToolId[] = agentEditorToolSpecs.map(
  (tool) => tool.id,
);

export function isStructuredEditorPatchOperation(
  operation: AgentEditorPatchOperation,
): boolean {
  return operation.kind !== 'text-edit';
}

export function createTextEditPatch(
  label: string,
  edits: WritingEditorStableEditTarget[],
  summary?: string,
): AgentEditorPatch {
  return {
    label,
    summary,
    operations: edits.map((edit) => ({
      kind: 'text-edit',
      edit,
    })),
  };
}
