import type {
  FetchLatestArticlesPayload,
  WebContentPdfDownloadPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { normalizeUrl } from 'cs/base/common/url';
import {
  getWebContentDocumentSnapshot,
  getWebContentListingCandidateSnapshot,
  getWebContentState,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import type { WebContentExtractionSnapshot, WebContentSnapshot } from 'cs/code/electron-main/fetch/fetchStrategy';
import { shouldAllowScienceWebContentWhileLoading } from 'cs/code/electron-main/fetch/scienceValidationRules';

const BATCH_PREVIEW_EXTRACTION_TIMEOUT_MS = 2500;
const BATCH_PREVIEW_SNAPSHOT_TIMEOUT_MS = 1500;
const BATCH_PREVIEW_EXTRACTION_GATE_TIMEOUT_MS = 5000;
const BATCH_PREVIEW_EXTRACTION_GATE_POLL_MS = 120;
type WebContentBatchSource = NonNullable<FetchLatestArticlesPayload['sources']>[number];
type WebContentSourceInput = { pageUrl?: unknown } | null | undefined;
type WebContentExtractionAdmissionSnapshot = {
  extraction?: {
    candidates?: unknown[] | null;
    diagnostics?: Record<string, unknown> | null;
  } | null;
  webContentUrl?: string | null;
  isLoading?: boolean | null;
};
type WebContentAdmissionConfig = {
  stablePolls: number;
  stableMs: number;
  trailingSectionStablePolls: number;
  trailingSectionStableMs: number;
};
type WebContentAdmissionStatus = {
  candidateCount: number;
  sectionCount: number | null;
  selectedSectionIndex: number | null;
  structurallyReady: boolean;
  trailingSection: boolean;
  requiredStablePolls: number;
  requiredStableMs: number;
  stabilityReady: boolean;
  ready: boolean;
};

const DEFAULT_WEB_CONTENT_ADMISSION_CONFIG: WebContentAdmissionConfig = {
  stablePolls: 4,
  stableMs: 450,
  trailingSectionStablePolls: 8,
  trailingSectionStableMs: 900,
};

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getWebContentExtractionDiagnostics(snapshot: WebContentExtractionAdmissionSnapshot) {
  const diagnostics = snapshot?.extraction?.diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    return null;
  }

  return diagnostics;
}

function safeNormalizeWebContentUrl(value: unknown) {
  try {
    return normalizeUrl(value);
  } catch {
    return '';
  }
}

function resolveWebContentSourcePageUrl(source: WebContentSourceInput) {
  return safeNormalizeWebContentUrl(source?.pageUrl);
}

function normalizeWebContentTargetUrl(value: unknown) {
  const normalized = safeNormalizeWebContentUrl(value);
  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    url.hash = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    }
    return url.toString();
  } catch {
    return '';
  }
}

function matchesWebContentTargetUrl(left: unknown, right: unknown) {
  const normalizedLeft = normalizeWebContentTargetUrl(left);
  const normalizedRight = normalizeWebContentTargetUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function collectMatchedWebContentPageUrls(
  sources: ReadonlyArray<WebContentSourceInput>,
  webContentUrl: unknown,
) {
  const matchedPageUrls = new Set<string>();
  const normalizedWebContentUrl = safeNormalizeWebContentUrl(webContentUrl);
  if (!normalizedWebContentUrl) {
    return matchedPageUrls;
  }

  for (const source of sources) {
    const pageUrl = resolveWebContentSourcePageUrl(source);
    if (pageUrl && matchesWebContentTargetUrl(pageUrl, normalizedWebContentUrl)) {
      matchedPageUrls.add(pageUrl);
    }
  }

  return matchedPageUrls;
}

function buildWebContentAdmissionKey(snapshot: WebContentExtractionAdmissionSnapshot) {
  const diagnostics = getWebContentExtractionDiagnostics(snapshot);
  return JSON.stringify({
    candidateCount: snapshot?.extraction?.candidates?.length ?? 0,
    sectionCount: toFiniteNumber(diagnostics?.sectionCount),
    cardCount: toFiniteNumber(diagnostics?.cardCount),
    datedCandidateCount: toFiniteNumber(diagnostics?.datedCandidateCount),
    summarizedCandidateCount: toFiniteNumber(diagnostics?.summarizedCandidateCount),
    selectedSectionIndex: toFiniteNumber(diagnostics?.selectedSectionIndex),
    webContentUrl: safeNormalizeWebContentUrl(snapshot?.webContentUrl ?? ''),
  });
}

function evaluateWebContentAdmissionStatus(
  snapshot: WebContentExtractionAdmissionSnapshot,
  stability: { stablePolls: number; stableMs: number },
  config: WebContentAdmissionConfig = DEFAULT_WEB_CONTENT_ADMISSION_CONFIG,
): WebContentAdmissionStatus {
  const candidateCount = snapshot?.extraction?.candidates?.length ?? 0;
  if (!snapshot || candidateCount === 0) {
    return {
      candidateCount,
      sectionCount: null,
      selectedSectionIndex: null,
      structurallyReady: false,
      trailingSection: false,
      requiredStablePolls: config.stablePolls,
      requiredStableMs: config.stableMs,
      stabilityReady: false,
      ready: false,
    };
  }

  const diagnostics = getWebContentExtractionDiagnostics(snapshot);
  const sectionCount = toFiniteNumber(diagnostics?.sectionCount);
  const selectedSectionIndex = toFiniteNumber(diagnostics?.selectedSectionIndex);
  const trailingSection = Boolean(
    snapshot.isLoading &&
      sectionCount !== null &&
      selectedSectionIndex !== null &&
      selectedSectionIndex >= sectionCount - 1,
  );
  const requiredStablePolls = trailingSection
    ? config.trailingSectionStablePolls
    : config.stablePolls;
  const requiredStableMs = trailingSection
    ? config.trailingSectionStableMs
    : config.stableMs;
  const structurallyReady = candidateCount > 0;
  const stabilityReady = Boolean(
    !snapshot.isLoading ||
      (stability.stablePolls >= requiredStablePolls && stability.stableMs >= requiredStableMs),
  );

  return {
    candidateCount,
    sectionCount,
    selectedSectionIndex,
    structurallyReady,
    trailingSection,
    requiredStablePolls,
    requiredStableMs,
    stabilityReady,
    ready: structurallyReady && stabilityReady,
  };
}
function logWebContentBatchDiagnostic(event: string, details: Record<string, unknown>) {
  try {
    console.info(`[web-content-batch] ${event} ${JSON.stringify(details)}`);
  } catch {
    console.info(`[web-content-batch] ${event}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectMatchedWebContentSources(
  sources: ReadonlyArray<WebContentBatchSource>,
  webContentUrl: unknown,
) {
  const matchedSources: WebContentBatchSource[] = [];
  const normalizedWebContentUrl = safeNormalizeWebContentUrl(webContentUrl);
  if (!normalizedWebContentUrl) {
    return matchedSources;
  }

  for (const source of sources) {
    const pageUrl = resolveWebContentSourcePageUrl(source);
    if (pageUrl && matchesWebContentTargetUrl(pageUrl, normalizedWebContentUrl)) {
      matchedSources.push(source);
    }
  }

  return matchedSources;
}

function resolvePreferredExtractorIdForWebContentSources(
  sources: ReadonlyArray<WebContentBatchSource>,
) {
  for (const source of sources) {
    const preferredExtractorId = String(source.preferredExtractorId ?? '').trim();
    if (preferredExtractorId) {
      return preferredExtractorId;
    }
  }

  return null;
}

async function waitForWebContentPageExtraction({
  webContentUrl,
  matchedPageUrls,
  preferredExtractorId,
}: {
  webContentUrl: string;
  matchedPageUrls: string[];
  preferredExtractorId?: string | null;
}) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastStableKey = '';
  let stableSince = 0;
  let stablePolls = 0;
  let bestCandidateCount = 0;
  let bestSectionCount: number | null = null;

  logWebContentBatchDiagnostic('extraction_gate_started', {
    webContentUrl,
    matchedPageUrls,
    preferredExtractorId: preferredExtractorId ?? null,
    gateTimeoutMs: BATCH_PREVIEW_EXTRACTION_GATE_TIMEOUT_MS,
    pollMs: BATCH_PREVIEW_EXTRACTION_GATE_POLL_MS,
    stablePollsRequired: DEFAULT_WEB_CONTENT_ADMISSION_CONFIG.stablePolls,
    stableMsRequired: DEFAULT_WEB_CONTENT_ADMISSION_CONFIG.stableMs,
  });

  while (Date.now() - startedAt < BATCH_PREVIEW_EXTRACTION_GATE_TIMEOUT_MS) {
    attempts += 1;

    const currentWebContentState = getWebContentState();
    const currentWebContentUrl = safeNormalizeWebContentUrl(currentWebContentState.url ?? '');
    if (
      !currentWebContentUrl ||
      !matchedPageUrls.some((pageUrl) => matchesWebContentTargetUrl(pageUrl, currentWebContentUrl))
    ) {
      logWebContentBatchDiagnostic('extraction_gate_aborted', {
        reason: 'web_content_url_changed',
        webContentUrl,
        currentWebContentUrl,
        matchedPageUrls,
        preferredExtractorId: preferredExtractorId ?? null,
        attempts,
        waitMs: Date.now() - startedAt,
      });
      return null;
    }

    const extraction = await getWebContentListingCandidateSnapshot({
      timeoutMs: BATCH_PREVIEW_EXTRACTION_TIMEOUT_MS,
      preferredExtractorId,
    });
    const extractionUrl = safeNormalizeWebContentUrl(extraction?.webContentUrl ?? '');
    const allowExtractionWhileLoading = extractionUrl
      ? shouldAllowScienceWebContentWhileLoading(extractionUrl)
      : false;
    if (
      extraction &&
      extractionUrl &&
      (!extraction.isLoading || allowExtractionWhileLoading) &&
      matchedPageUrls.some((pageUrl) => matchesWebContentTargetUrl(pageUrl, extractionUrl))
    ) {
      const now = Date.now();
      const candidateCount = extraction.extraction.candidates.length;
      bestCandidateCount = Math.max(bestCandidateCount, candidateCount);

      const stableKey = buildWebContentAdmissionKey(extraction);
      if (stableKey === lastStableKey) {
        stablePolls += 1;
      } else {
        lastStableKey = stableKey;
        stableSince = now;
        stablePolls = 1;
      }

      const stableMs = stableSince > 0 ? now - stableSince : 0;
      const gateStatus = evaluateWebContentAdmissionStatus(
        extraction,
        {
          stablePolls,
          stableMs,
        },
      );
      if (gateStatus.sectionCount !== null) {
        bestSectionCount =
          bestSectionCount === null
            ? gateStatus.sectionCount
            : Math.max(bestSectionCount, gateStatus.sectionCount);
      }

      if (gateStatus.ready) {
        logWebContentBatchDiagnostic('extraction_gate_ready', {
          webContentUrl,
          extractionUrl,
          candidateCount: gateStatus.candidateCount,
          sectionCount: gateStatus.sectionCount,
          selectedSectionIndex: gateStatus.selectedSectionIndex,
          preferredExtractorId: preferredExtractorId ?? null,
          attempts,
          waitMs: Date.now() - startedAt,
          extractionIsLoading: extraction.isLoading,
          trailingSection: gateStatus.trailingSection,
          stablePolls,
          stableMs,
          requiredStablePolls: gateStatus.requiredStablePolls,
          requiredStableMs: gateStatus.requiredStableMs,
        });
        return extraction;
      }
    }

    await sleep(BATCH_PREVIEW_EXTRACTION_GATE_POLL_MS);
  }

  logWebContentBatchDiagnostic('extraction_gate_timeout', {
    webContentUrl,
    matchedPageUrls,
    preferredExtractorId: preferredExtractorId ?? null,
    attempts,
    waitMs: Date.now() - startedAt,
    bestCandidateCount,
    bestSectionCount,
  });

  return null;
}

export async function resolveWebContentSnapshotHtml(payload: WebContentPdfDownloadPayload = {}) {
  const requestedUrl = safeNormalizeWebContentUrl(payload.pageUrl ?? '');
  if (!requestedUrl) return null;

  // The cached web content state can lag behind a navigation; trust the live DOM snapshot first.
  const snapshot = await getWebContentDocumentSnapshot();
  const snapshotUrl = safeNormalizeWebContentUrl(snapshot?.url ?? '');
  if (!snapshot || !snapshotUrl || !matchesWebContentTargetUrl(snapshotUrl, requestedUrl)) {
    return null;
  }

  return snapshot.html;
}

export async function resolveBatchWebContentSnapshots(payload: FetchLatestArticlesPayload = {}) {
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (sources.length === 0) {
    return new Map<string, WebContentSnapshot>();
  }

  const webContentState = getWebContentState();
  const webContentUrl = safeNormalizeWebContentUrl(webContentState.url ?? '');
  if (!webContentUrl) {
    return new Map<string, WebContentSnapshot>();
  }

  const matchedPageUrls = collectMatchedWebContentPageUrls(sources, webContentUrl);

  if (matchedPageUrls.size === 0) {
    logWebContentBatchDiagnostic('snapshot_skipped', {
      reason: 'web_content_url_not_matched',
      webContentUrl,
      sourceUrls: sources
        .map((source) => resolveWebContentSourcePageUrl(source))
        .filter(Boolean),
    });
    return new Map<string, WebContentSnapshot>();
  }

  const allowWhileLoading = shouldAllowScienceWebContentWhileLoading(webContentUrl);
  if (webContentState.isLoading && !allowWhileLoading) {
    return new Map<string, WebContentSnapshot>();
  }

  const snapshot = await getWebContentDocumentSnapshot({
    timeoutMs: BATCH_PREVIEW_SNAPSHOT_TIMEOUT_MS,
  });
  const snapshotUrl = safeNormalizeWebContentUrl(snapshot?.url ?? '');
  const allowSnapshotWhileLoading = snapshotUrl ? shouldAllowScienceWebContentWhileLoading(snapshotUrl) : false;
  if (
    !snapshot ||
    !snapshotUrl ||
    (snapshot.isLoading && !allowSnapshotWhileLoading) ||
    ![...matchedPageUrls].some((pageUrl) => matchesWebContentTargetUrl(pageUrl, snapshotUrl))
  ) {
    logWebContentBatchDiagnostic('snapshot_skipped', {
      reason: !snapshot
        ? 'snapshot_unavailable'
        : !snapshotUrl
          ? 'snapshot_url_empty'
          : snapshot.isLoading && !allowSnapshotWhileLoading
            ? 'snapshot_loading_blocked'
            : 'snapshot_url_not_matched',
      webContentUrl,
      snapshotUrl,
      webContentIsLoading: webContentState.isLoading,
      snapshotIsLoading: snapshot?.isLoading ?? null,
      matchedPageUrls: [...matchedPageUrls],
    });
    return new Map<string, WebContentSnapshot>();
  }

  const resolvedSnapshot: WebContentSnapshot = {
    html: snapshot.html,
    webContentUrl: snapshotUrl,
    captureMs: snapshot.captureMs,
    isLoading: snapshot.isLoading,
  };
  const snapshots = new Map<string, WebContentSnapshot>();

  for (const pageUrl of matchedPageUrls) {
    snapshots.set(pageUrl, resolvedSnapshot);
  }

  return snapshots;
}

export async function resolveBatchWebContentExtractions(payload: FetchLatestArticlesPayload = {}) {
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (sources.length === 0) {
    return new Map<string, WebContentExtractionSnapshot>();
  }

  const webContentState = getWebContentState();
  const webContentUrl = safeNormalizeWebContentUrl(webContentState.url ?? '');
  if (!webContentUrl) {
    return new Map<string, WebContentExtractionSnapshot>();
  }

  const matchedSources = collectMatchedWebContentSources(sources, webContentUrl);
  const matchedPageUrls = new Set(
    matchedSources
      .map((source) => resolveWebContentSourcePageUrl(source))
      .filter((pageUrl): pageUrl is string => Boolean(pageUrl)),
  );
  const preferredExtractorId = resolvePreferredExtractorIdForWebContentSources(matchedSources);

  if (matchedPageUrls.size === 0) {
    logWebContentBatchDiagnostic('extraction_skipped', {
      reason: 'web_content_url_not_matched',
      webContentUrl,
      sourceUrls: sources
        .map((source) => resolveWebContentSourcePageUrl(source))
        .filter(Boolean),
    });
    return new Map<string, WebContentExtractionSnapshot>();
  }

  const allowWhileLoading = shouldAllowScienceWebContentWhileLoading(webContentUrl);
  if (webContentState.isLoading && !allowWhileLoading) {
    return new Map<string, WebContentExtractionSnapshot>();
  }

  const extraction =
    webContentState.isLoading && allowWhileLoading
      ? await waitForWebContentPageExtraction({
          webContentUrl,
          matchedPageUrls: [...matchedPageUrls],
          preferredExtractorId,
        })
      : await getWebContentListingCandidateSnapshot({
          timeoutMs: BATCH_PREVIEW_EXTRACTION_TIMEOUT_MS,
          preferredExtractorId,
        });
  const extractionUrl = safeNormalizeWebContentUrl(extraction?.webContentUrl ?? '');
  const allowExtractionWhileLoading = extractionUrl ? shouldAllowScienceWebContentWhileLoading(extractionUrl) : false;
  if (
    !extraction ||
    !extractionUrl ||
    (extraction.isLoading && !allowExtractionWhileLoading) ||
    ![...matchedPageUrls].some((pageUrl) => matchesWebContentTargetUrl(pageUrl, extractionUrl))
  ) {
    logWebContentBatchDiagnostic('extraction_skipped', {
      reason: !extraction
        ? 'extraction_unavailable'
        : !extractionUrl
          ? 'extraction_url_empty'
          : extraction.isLoading && !allowExtractionWhileLoading
            ? 'extraction_loading_blocked'
            : 'extraction_url_not_matched',
      webContentUrl,
      extractionUrl,
      preferredExtractorId: preferredExtractorId ?? null,
      webContentIsLoading: webContentState.isLoading,
      extractionIsLoading: extraction?.isLoading ?? null,
      matchedPageUrls: [...matchedPageUrls],
    });
    return new Map<string, WebContentExtractionSnapshot>();
  }

  const resolvedExtraction: WebContentExtractionSnapshot = {
    extraction: extraction.extraction,
    extractorId: extraction.extractorId,
    webContentUrl: extractionUrl,
    captureMs: extraction.captureMs,
    isLoading: extraction.isLoading,
    nextPageUrl: extraction.nextPageUrl,
  };
  const extractions = new Map<string, WebContentExtractionSnapshot>();
  for (const pageUrl of matchedPageUrls) {
    extractions.set(pageUrl, resolvedExtraction);
  }

  return extractions;
}
