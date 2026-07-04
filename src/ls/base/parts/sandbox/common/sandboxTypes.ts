import type { EditorDraftStyleSettings } from 'ls/base/common/editorDraftStyle';
import type { UriComponents } from 'ls/base/common/uri';

export type Locale = 'zh' | 'en';
export type AppTheme = 'light' | 'dark' | 'system';
export type AppStartupLayout = 'agent' | 'flow';
export type ThemeColorCustomizations = Record<string, string>;

export interface ArticleFigure {
  id: string | null;
  title: string | null;
  captionText: string | null;
  imageUrl: string | null;
  fullSizeUrl: string | null;
}

export interface Article {
  title: string;
  articleType: string | null;
  doi: string | null;
  authors: string[];
  abstractText: string | null;
  descriptionText: string | null;
  figures?: ArticleFigure[];
  publishedAt: string | null;
  sourceUrl: string;
  fetchedAt: string;
  sourceId?: string | null;
  journalTitle?: string | null;
  archiveHtmlPath?: string | null;
  archiveTextPath?: string | null;
  archivePdfPath?: string | null;
}

export interface BatchSource {
  id: string;
  url: string;
  journalTitle: string;
  preferredExtractorId?: string | null;
}

export interface JournalSourceOverride {
  url: string;
  journalTitle?: string;
  preferredExtractorId?: string | null;
}

export type LlmProviderId =
  | 'glm'
  | 'kimi'
  | 'deepseek'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'custom';

export interface LlmProviderSettings {
  apiKey: string;
  baseUrl: string;
  selectedModelOption: string;
  enabledModelOptions?: string[];
  useMaxContextWindow?: boolean;
}

export interface LlmSettings {
  activeProvider: LlmProviderId;
  providers: Record<LlmProviderId, LlmProviderSettings>;
}

export type TranslationProviderId = 'deepl' | 'glm' | 'openai-compatible';

export interface TranslationProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface TranslationSettings {
  activeProvider: TranslationProviderId;
  providers: Record<TranslationProviderId, TranslationProviderSettings>;
}

export type LibraryStorageMode = 'linked-original' | 'managed-copy';

export interface KnowledgeBaseSettings {
  enabled: boolean;
  autoIndexDownloadedPdf: boolean;
  downloadDirectory: string | null;
  libraryStorageMode: LibraryStorageMode;
  libraryDirectory: string | null;
  maxConcurrentIndexJobs: number;
}

export type RagProviderId = 'moark';

export interface RagProviderSettings {
  apiKey: string;
  baseUrl: string;
  embeddingModel: string;
  rerankerModel: string;
  embeddingPath: string;
  rerankPath: string;
}

export interface RagSettings {
  enabled: boolean;
  activeProvider: RagProviderId;
  providers: Record<RagProviderId, RagProviderSettings>;
  retrievalCandidateCount: number;
  retrievalTopK: number;
}

export interface FetchBatchSource {
  sourceId?: string;
  pageUrl?: string;
  journalTitle?: string;
  preferredExtractorId?: string | null;
}

export type DateRange = import('ls/base/common/date').DateRange;

export interface StoredAppSettings {
  defaultDownloadDir: string | null;
  pdfFileNameUseSelectionOrder: boolean;
  browserTabKeepAliveLimit: number;
  defaultBatchLimit: number;
  journalSourceOverrides: JournalSourceOverride[];
  systemNotificationsEnabled: boolean;
  warningNotificationsEnabled: boolean;
  menuBarIconEnabled: boolean;
  completionNotificationsEnabled: boolean;
  statusbarVisible: boolean;
  startupLayout: AppStartupLayout;
  useMica: boolean;
  theme: AppTheme;
  'workbench.colorCustomizations': ThemeColorCustomizations;
  locale: Locale;
  userSettingsPathOverride?: string | null;
  editorDraftStyle: EditorDraftStyleSettings;
  llm: LlmSettings;
  translation: TranslationSettings;
  knowledgeBase: KnowledgeBaseSettings;
  rag: RagSettings;
}

export interface AppSettings extends StoredAppSettings {
  configPath: string;
  defaultConfigPath: string;
}

export type WindowControlAction =
  | 'minimize'
  | 'maximize'
  | 'unmaximize'
  | 'toggle-maximize'
  | 'close';

export interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
}

export type FetchStrategy = 'network-first' | 'web-content-first' | 'compare';
export type FetchChannel = 'network' | 'web-content';
export type WebContentReuseMode = 'snapshot' | 'live-extract';

export interface FetchStatus {
  sourceId: string;
  pageUrl: string;
  pageNumber: number;
  fetchChannel: FetchChannel;
  fetchDetail?: string | null;
  webContentReuseMode?: WebContentReuseMode | null;
  extractorId: string | null;
  paginationStopped?: boolean;
  paginationStopReason?: string | null;
}

export type DocumentTranslationProgressPhase = 'started' | 'batch' | 'completed' | 'failed';

export interface DocumentTranslationProgress {
  phase: DocumentTranslationProgressPhase;
  current: number;
  total: number;
  provider: string;
  model: string;
  message?: string | null;
}

export interface FetchLatestArticlesPayload {
  sources?: FetchBatchSource[];
  startDate?: string | null;
  endDate?: string | null;
  fetchStrategy?: FetchStrategy;
}

export interface WebContentPdfDownloadPayload {
  pageUrl?: string;
  downloadUrl?: string;
  doi?: string;
  articleTitle?: string;
  authors?: string[];
  publishedAt?: string | null;
  sourceId?: string | null;
  journalTitle?: string;
  customDownloadDir?: string | null;
}

export interface WebContentHtmlArchivePayload {
  pageUrl?: string;
  pageTitle?: string | null;
}

export interface WebContentHtmlArchiveResult {
  filePath: string;
  htmlPath: string;
  textPath: string;
  pdfPath: string | null;
  sourceUrl: string;
  pdfSourceUrl: string | null;
  extractedText: string;
  article: Article;
}

export interface ExportArticlesDocxPayload {
  articles?: Article[];
  preferredDirectory?: string | null;
  locale?: Locale;
}

export interface WritingEditorMarkPayload {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface WritingEditorNodePayload {
  type: string;
  attrs?: Record<string, unknown>;
  content?: WritingEditorNodePayload[];
  marks?: WritingEditorMarkPayload[];
  text?: string;
}

export type WritingEditorDocumentPayload = WritingEditorNodePayload;
export type WritingEditorStableSelectionTargetPayload =
  import('ls/editor/common/writingEditorDocument').WritingEditorStableSelectionTarget;
export type WritingEditorTextUnitPayload =
  import('ls/editor/common/writingEditorDocument').WritingEditorTextUnit;

export interface ExportEditorDocxPayload {
  document?: WritingEditorDocumentPayload;
  editorDraftStyle?: EditorDraftStyleSettings;
  title?: string | null;
  preferredDirectory?: string | null;
  locale?: Locale;
}

export interface FetchArticlePayload {
  url?: string;
}

export interface SaveSettingsPayload {
  settings?: Partial<StoredAppSettings>;
}

export interface TestLlmConnectionPayload {
  provider?: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: import('ls/workbench/services/llm/types').LlmReasoningEffort;
  serviceTier?: import('ls/workbench/services/llm/types').LlmServiceTier;
}

export interface LlmConnectionTestResult {
  provider: LlmProviderId;
  model: string;
  reasoningEffort?: import('ls/workbench/services/llm/types').LlmReasoningEffort;
  baseUrl: string;
  responsePreview: string;
}

export interface TestTranslationConnectionPayload {
  provider?: TranslationProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface TranslationConnectionTestResult {
  provider: TranslationProviderId;
  baseUrl: string;
  responsePreview: string;
}

export interface TestRagConnectionPayload {
  provider?: RagProviderId;
  apiKey?: string;
  baseUrl?: string;
  embeddingModel?: string;
  rerankerModel?: string;
  embeddingPath?: string;
  rerankPath?: string;
}

export interface RagConnectionTestResult {
  provider: RagProviderId;
  baseUrl: string;
  embeddingModel: string;
  rerankerModel: string;
  embeddingDimensions: number;
  rerankCount: number;
}

export interface OpenPathPayload {
  resource: UriComponents;
}

export interface PickUserSettingsFilePayload {
  defaultPath?: string;
}

export interface ReadPdfFilePayload {
  resource: UriComponents;
}

export interface ReadPdfFileResult {
  resource: UriComponents;
  data: Uint8Array;
}

export interface PdfDownloadResult {
  filePath: string;
  sourceUrl: string;
  libraryRegistration?: LibraryRegistrationResult | null;
}

export interface DocxExportResult {
  filePath: string;
  articleCount: number;
}

export interface EditorDocxExportResult {
  filePath: string;
  title: string;
}

export type LibraryIngestStatus = 'registered' | 'queued' | 'indexing' | 'ready' | 'failed';

export type LibraryJobType = 'register' | 'extract' | 'chunk' | 'embed' | 'reindex';

export type LibraryJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type LibraryDedupeReason =
  | 'new'
  | 'file_path'
  | 'doi'
  | 'file_sha256'
  | 'title_author_year';

export interface IndexDownloadedPdfPayload {
  filePath?: string;
  sourceUrl?: string;
  sourceId?: string | null;
  doi?: string | null;
  articleTitle?: string | null;
  authors?: string[];
  journalTitle?: string | null;
  publishedAt?: string | null;
}

export interface UpsertLibraryDocumentMetadataPayload {
  documentId?: string;
  sourceUrl?: string;
  sourceId?: string | null;
  doi?: string | null;
  articleTitle?: string | null;
  authors?: string[];
  journalTitle?: string | null;
  publishedAt?: string | null;
}

export interface DeleteLibraryDocumentPayload {
  documentId?: string;
}

export interface LibraryRegistrationResult {
  documentId: string;
  fileId: string;
  jobId: string;
  dedupeReason: LibraryDedupeReason;
  storageMode: LibraryStorageMode;
  ingestStatus: LibraryIngestStatus;
  filePath: string;
}

export interface LibraryDocumentStatusPayload {
  documentId?: string;
  sourceUrl?: string;
  doi?: string;
  filePath?: string;
}

export interface LibraryDocumentSummary {
  documentId: string;
  title: string | null;
  doi: string | null;
  authors: string[];
  journalTitle: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  sourceId: string | null;
  ingestStatus: LibraryIngestStatus;
  fileCount: number;
  latestFilePath: string | null;
  latestDownloadedAt: string | null;
  latestJobType: LibraryJobType | null;
  latestJobStatus: LibraryJobStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListLibraryDocumentsPayload {
  limit?: number;
}

export interface LibraryDocumentsResult {
  items: LibraryDocumentSummary[];
  totalCount: number;
  fileCount: number;
  queuedJobCount: number;
  libraryDbFile: string;
  defaultManagedDirectory: string;
  ragCacheDir: string;
}

export interface ReindexLibraryDocumentPayload {
  documentId?: string;
}

export interface ReindexLibraryDocumentResult {
  jobId: string;
  documentId: string;
  status: LibraryJobStatus;
  jobType: LibraryJobType;
}

export interface RagEvidenceItem {
  rank: number;
  title: string;
  journalTitle: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  score: number | null;
  excerpt: string;
}

export interface RagAnswerArticlesPayload {
  question?: string;
  writingContext?: string | null;
  articles?: Article[];
  llm?: LlmSettings;
  rag?: RagSettings;
}

export interface RagAnswerResult {
  answer: string;
  evidence: RagEvidenceItem[];
  provider: RagProviderId;
  llmProvider: LlmProviderId;
  llmModel: string;
  embeddingModel: string;
  rerankerModel: string;
  rerankApplied: boolean;
}

export type AgentMessagePayload = import('ls/agent/common/protocol').AgentMessage;
export type AgentStopReasonPayload = import('ls/agent/common/protocol').AgentStopReason;
export type AgentEditorPatchPayload =
  import('ls/agent/common/editorTools').AgentEditorPatch;
export type MainAgentAvailableToolId =
  Extract<
    import('ls/agent/common/editorTools').AgentEditorToolId,
    | 'get_selection_context'
    | 'list_text_units'
    | 'apply_editor_patch'
    | 'retrieve_evidence'
  >;

export interface MainAgentPatchProposal {
  patch: AgentEditorPatchPayload;
  accepted: boolean;
  operationsValidated: number;
  failedOperationIndex: number | null;
  requiresCustomExecutor: boolean;
  validationError: string | null;
}

export interface RunMainAgentTurnPayload {
  question?: string;
  systemPrompt?: string;
  messages?: AgentMessagePayload[];
  writingContext?: string | null;
  draftBody?: string | null;
  editorSelection?: WritingEditorStableSelectionTargetPayload | null;
  editorDocument?: WritingEditorDocumentPayload | null;
  editorTextUnits?: WritingEditorTextUnitPayload[];
  articles?: Article[];
  llm?: LlmSettings;
  rag?: RagSettings;
  availableTools?: MainAgentAvailableToolId[];
  maxSteps?: number;
}

export interface MainAgentToolTrace {
  step: number;
  toolName: string;
  isError: boolean;
}

export interface RunMainAgentTurnResult {
  messages: AgentMessagePayload[];
  stopReason: AgentStopReasonPayload;
  finalText: string;
  llmProvider: LlmProviderId;
  llmModel: string;
  lastEvidenceResult: RagAnswerResult | null;
  lastPatchProposal: MainAgentPatchProposal | null;
  toolTrace: MainAgentToolTrace[];
}

export type NativeToastType = 'info' | 'success' | 'error' | 'warning';

export interface NativeToastOptions {
  message: string;
  type?: NativeToastType;
  duration?: number;
}

export interface NativeToastItem {
  id: number;
  message: string;
  type: NativeToastType;
}

export interface NativeToastState {
  items: NativeToastItem[];
}

export interface NativeToastLayout {
  width: number;
  height: number;
}

export interface AppCommandPayloadMap {
  fetch_article: FetchArticlePayload;
  fetch_latest_articles: FetchLatestArticlesPayload;
  clear_web_cache: undefined;
  clear_web_cookies: undefined;
  load_settings: undefined;
  save_settings: SaveSettingsPayload;
  test_llm_connection: TestLlmConnectionPayload;
  test_translation_connection: TestTranslationConnectionPayload;
  test_rag_connection: TestRagConnectionPayload;
  pick_download_directory: undefined;
  pick_user_settings_file: PickUserSettingsFilePayload;
  pick_pdf_file: undefined;
  read_pdf_file: ReadPdfFilePayload;
  open_path: OpenPathPayload;
  web_content_download_pdf: WebContentPdfDownloadPayload;
  web_content_archive_html: WebContentHtmlArchivePayload;
  index_downloaded_pdf: IndexDownloadedPdfPayload;
  upsert_library_document_metadata: UpsertLibraryDocumentMetadataPayload;
  delete_library_document: DeleteLibraryDocumentPayload;
  get_library_document_status: LibraryDocumentStatusPayload;
  list_library_documents: ListLibraryDocumentsPayload;
  reindex_library_document: ReindexLibraryDocumentPayload;
  rag_answer_articles: RagAnswerArticlesPayload;
  run_main_agent_turn: RunMainAgentTurnPayload;
  export_articles_docx: ExportArticlesDocxPayload;
  export_editor_docx: ExportEditorDocxPayload;
}

export interface AppCommandResultMap {
  fetch_article: Article;
  fetch_latest_articles: Article[];
  clear_web_cache: boolean;
  clear_web_cookies: boolean;
  load_settings: AppSettings;
  save_settings: AppSettings;
  test_llm_connection: LlmConnectionTestResult;
  test_translation_connection: TranslationConnectionTestResult;
  test_rag_connection: RagConnectionTestResult;
  pick_download_directory: string | null;
  pick_user_settings_file: string | null;
  pick_pdf_file: UriComponents | null;
  read_pdf_file: ReadPdfFileResult;
  open_path: boolean;
  web_content_download_pdf: PdfDownloadResult;
  web_content_archive_html: WebContentHtmlArchiveResult;
  index_downloaded_pdf: LibraryRegistrationResult;
  upsert_library_document_metadata: LibraryDocumentSummary;
  delete_library_document: boolean;
  get_library_document_status: LibraryDocumentSummary | null;
  list_library_documents: LibraryDocumentsResult;
  reindex_library_document: ReindexLibraryDocumentResult;
  rag_answer_articles: RagAnswerResult;
  run_main_agent_turn: RunMainAgentTurnResult;
  export_articles_docx: DocxExportResult | null;
  export_editor_docx: EditorDocxExportResult | null;
}

export type AppCommand = keyof AppCommandPayloadMap;
