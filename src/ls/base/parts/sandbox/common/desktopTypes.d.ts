import type { EditorDraftStyleSettings } from 'ls/base/common/editorDraftStyle';

export type Locale = 'zh' | 'en';
export type AppTheme = 'light' | 'dark' | 'system';
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
  useMica: boolean;
  theme: AppTheme;
  'workbench.colorCustomizations': ThemeColorCustomizations;
  locale: Locale;
  editorDraftStyle: EditorDraftStyleSettings;
  llm: LlmSettings;
  translation: TranslationSettings;
  knowledgeBase: KnowledgeBaseSettings;
  rag: RagSettings;
}

export interface AppSettings extends StoredAppSettings {
  configPath: string;
}

export type AppErrorCode =
  | 'MAIN_WINDOW_UNAVAILABLE'
  | 'UNKNOWN_COMMAND'
  | 'URL_EMPTY'
  | 'URL_PROTOCOL_UNSUPPORTED'
  | 'DATE_START_INVALID'
  | 'DATE_END_INVALID'
  | 'DATE_RANGE_INVALID'
  | 'HTTP_REQUEST_FAILED'
  | 'BATCH_PAGE_URLS_EMPTY'
  | 'BATCH_SOURCE_FETCH_FAILED'
  | 'BATCH_NO_MATCH_IN_DATE_RANGE'
  | 'BATCH_NO_VALID_ARTICLES'
  | 'PDF_LINK_NOT_FOUND'
  | 'PDF_DOWNLOAD_FAILED'
  | 'DOCX_EXPORT_NO_ARTICLES'
  | 'DOCX_EXPORT_FAILED'
  | 'PREVIEW_NOT_READY'
  | 'LLM_PROVIDER_UNSUPPORTED'
  | 'LLM_API_KEY_MISSING'
  | 'LLM_MODEL_MISSING'
  | 'LLM_BASE_URL_INVALID'
  | 'LLM_CONNECTION_FAILED'
  | 'RAG_PROVIDER_UNSUPPORTED'
  | 'RAG_API_KEY_MISSING'
  | 'RAG_BASE_URL_INVALID'
  | 'RAG_EMBEDDING_MODEL_MISSING'
  | 'RAG_RERANKER_MODEL_MISSING'
  | 'RAG_CONNECTION_FAILED'
  | 'RAG_QUERY_EMPTY'
  | 'UNKNOWN_ERROR';

export interface AppErrorPayload {
  code: AppErrorCode;
  details?: Record<string, unknown>;
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

export interface WebContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WebContentLayoutPhase = 'hidden' | 'measuring' | 'visible';
export type WebContentOwnership = 'active' | 'inactive';

export interface WebContentState {
  targetId: string | null;
  activeTargetId: string | null;
  ownership: WebContentOwnership;
  layoutPhase: WebContentLayoutPhase;
  url: string;
  pageTitle?: string;
  faviconUrl?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  visible: boolean;
}

export interface WebContentSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebContentSelectionSnapshot {
  text: string;
  rects: WebContentSelectionRect[];
}

export type WebContentNavigationMode = 'browser' | 'strict';
export type WebContentBridgeMethod =
  | 'activateTarget'
  | 'clearHistory'
  | 'disposeTarget'
  | 'executeJavaScript'
  | 'getState'
  | 'goBack'
  | 'goForward'
  | 'hardReload'
  | 'navigateTo'
  | 'printToPDF'
  | 'releaseTarget'
  | 'reload';

export interface WebContentBridgeCommand {
  requestId: string;
  method: WebContentBridgeMethod;
  args?: unknown[];
}

export interface WebContentBridgeResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface WebContentTargetPayload {
  targetId?: string | null;
}

export interface WebContentNavigatePayload extends WebContentTargetPayload {
  url: string;
  mode?: WebContentNavigationMode;
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

export interface ArticleDetailsModalLabels {
  untitled: string;
  unknown: string;
  articleType: string;
  authors: string;
  abstract: string;
  description: string;
  publishedAt: string;
  source: string;
  fetchedAt: string;
  archiveHtmlPath: string;
  archiveTextPath: string;
  archivePdfPath: string;
  revealPath: string;
  controlsAriaLabel: string;
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
}

export interface OpenArticleDetailsModalPayload {
  article?: Article;
  labels?: ArticleDetailsModalLabels;
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
  path?: string;
}

export interface ReadPdfFilePayload {
  url?: string;
  path?: string;
}

export interface ReadPdfFileResult {
  filePath: string;
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

export interface ArticleDetailsModalState {
  kind: 'article-details';
  article: Article;
  labels: ArticleDetailsModalLabels;
  locale: Locale;
}

export type NativeModalState = ArticleDetailsModalState;

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
  open_article_details_modal: OpenArticleDetailsModalPayload;
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
  pick_pdf_file: string | null;
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
  open_article_details_modal: boolean;
}

export type AppCommand = keyof AppCommandPayloadMap;

export type ElectronInvoke = {
  <TCommand extends AppCommand>(
    command: TCommand,
    args?: AppCommandPayloadMap[TCommand],
  ): Promise<AppCommandResultMap[TCommand]>;
  <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
};

export type WindowStateListener = (state: WindowState) => void;

export interface ElectronWindowControls {
  perform: (action: WindowControlAction) => void;
  getState: () => Promise<WindowState>;
  onStateChange: (listener: WindowStateListener) => () => void;
}

export interface ElectronWebContentApi {
  activate: (targetId?: string | null) => void;
  dispose: (targetId?: string | null) => void;
  release: (targetId?: string | null) => void;
  navigate: (
    url: string,
    targetId?: string | null,
    mode?: WebContentNavigationMode,
  ) => Promise<WebContentState>;
  getState: (targetId?: string | null) => Promise<WebContentState>;
  setBounds: (bounds: WebContentBounds | null) => void;
  setVisible: (visible: boolean) => void;
  setLayoutPhase: (phase: WebContentLayoutPhase) => void;
  clearHistory: (targetId?: string | null) => void;
  hardReload: (targetId?: string | null) => void;
  reload: (targetId?: string | null) => void;
  goBack: (targetId?: string | null) => void;
  goForward: (targetId?: string | null) => void;
  executeJavaScript?: <T = unknown>(
    targetId: string | null | undefined,
    script: string,
    timeoutMs?: number,
  ) => Promise<T | null>;
  getSelection: (targetId?: string | null) => Promise<WebContentSelectionSnapshot | null>;
  onStateChange: (listener: (state: WebContentState) => void) => () => void;
  onBridgeCommand?: (listener: (command: WebContentBridgeCommand) => void) => () => void;
  respondToBridgeCommand?: (response: WebContentBridgeResponse) => void;
  reportBridgeReady?: () => void;
  reportState?: (state: WebContentState) => void;
}

export interface ElectronFetchApi {
  onFetchStatus: (listener: (status: FetchStatus) => void) => () => void;
}

export interface ElectronDocumentApi {
  onTranslationProgress: (listener: (progress: DocumentTranslationProgress) => void) => () => void;
}

export interface ElectronModalApi {
  getState: () => Promise<NativeModalState | null>;
  onStateChange: (listener: (state: NativeModalState | null) => void) => () => void;
}

export interface ElectronToastApi {
  show: (options: NativeToastOptions) => void;
  dismiss: (id: number) => void;
  getState: () => Promise<NativeToastState>;
  onStateChange: (listener: (state: NativeToastState) => void) => () => void;
  reportLayout: (layout: NativeToastLayout) => void;
  setHovering: (hovering: boolean) => void;
}

export interface ElectronAPI {
  invoke: ElectronInvoke;
  windowControls?: ElectronWindowControls;
  webContent?: ElectronWebContentApi;
  fetch?: ElectronFetchApi;
  document?: ElectronDocumentApi;
  modal?: ElectronModalApi;
  toast?: ElectronToastApi;
}
