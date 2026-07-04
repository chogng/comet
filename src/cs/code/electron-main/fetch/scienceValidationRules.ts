import { isAppError } from 'cs/base/common/errors';
import {
  isScienceHostUrl as isSharedScienceHostUrl,
  isScienceSeriesCurrentTocUrl,
} from 'cs/base/common/url';
import { cleanText } from 'cs/base/common/strings';

// Science site validation rules used by fetch/pdf flows.
// Keep BrowserWindow lifecycle and script execution in platform/windows.
const SCIENCE_CHALLENGE_HTML_SNIPPETS = [
  'cf-mitigated',
  'challenge-platform',
  'google.com/recaptcha',
  'recaptcha.net/recaptcha',
  'recaptcha/api2/',
  'g-recaptcha',
  'grecaptcha',
  'data-sitekey',
] as const;

export type ScienceValidationResult = {
  finalUrl: string;
  html: string;
  sectionCount: number;
  title: string;
  readyMs: number;
  navigationMode: 'web-content-existing' | 'reuse-existing' | 'dom-ready' | 'load-finished' | 'boot-timeout';
  source: 'web-content' | 'window';
};

export type ScienceValidationWindowState = {
  currentUrl: string;
  title: string;
  documentReadyState: string;
  visibilityState: string;
  bodyTextSample: string;
  sectionCount: number;
  hasChallengeIndicators: boolean;
  hasDownloadControls: boolean;
  hasPdfEmbed: boolean;
  hasRecaptchaIndicators: boolean;
  lastMutationAtMs: number;
  hasStableReadyForListing: boolean;
  hasStableReadyForPage: boolean;
};

type ScienceHttpErrorDetails = {
  status?: unknown;
  responseHeaders?: {
    server?: unknown;
    cfMitigated?: unknown;
    cfRay?: unknown;
  };
};

function safeParseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeScienceComparableUrl(value: string) {
  const parsed = safeParseUrl(value);
  if (!parsed) return '';

  parsed.hash = '';
  if (parsed.pathname !== '/') {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  }

  return parsed.toString();
}

function normalizeScienceNavigationComparableUrl(value: string) {
  const parsed = safeParseUrl(value);
  if (!parsed) return '';

  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname !== '/') {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  }

  return parsed.toString();
}

export function isScienceHostUrl(value: string) {
  return isSharedScienceHostUrl(value);
}

export function isScienceSeriesListingPageUrl(value: string) {
  return isScienceSeriesCurrentTocUrl(value);
}

export function getScienceChallengeSignal(error: unknown) {
  if (!isAppError(error) || error.code !== 'HTTP_REQUEST_FAILED') {
    return null;
  }

  const details = (error.details ?? {}) as ScienceHttpErrorDetails;
  const status = cleanText(details.status);
  if (status !== '403') {
    return null;
  }

  const server = cleanText(details.responseHeaders?.server).toLowerCase();
  const cfMitigated = cleanText(details.responseHeaders?.cfMitigated).toLowerCase();
  const cfRay = cleanText(details.responseHeaders?.cfRay);
  const cloudflareSignal = server.includes('cloudflare') || Boolean(cfRay);
  const challengeSignal = cfMitigated.includes('challenge');

  return {
    status,
    server: server || null,
    cfMitigated: cfMitigated || null,
    cfRay: cfRay || null,
    cloudflareSignal,
    challengeSignal,
  };
}

export function shouldUseScienceValidationRenderFallback({
  pageUrl,
  error,
}: {
  pageUrl: string;
  error: unknown;
}) {
  if (!isScienceSeriesListingPageUrl(pageUrl)) {
    return false;
  }

  const challengeSignal = getScienceChallengeSignal(error);
  if (!challengeSignal) return false;

  if (challengeSignal.challengeSignal || challengeSignal.cloudflareSignal) {
    return true;
  }

  return challengeSignal.status === '403';
}

export function shouldAllowScienceWebContentWhileLoading(pageUrl: string) {
  return isScienceSeriesListingPageUrl(pageUrl);
}

export function matchesScienceComparableUrl(left: string, right: string) {
  const normalizedLeft = normalizeScienceComparableUrl(left);
  const normalizedRight = normalizeScienceComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function matchesScienceNavigationComparableUrl(left: string, right: string) {
  const normalizedLeft = normalizeScienceNavigationComparableUrl(left);
  const normalizedRight = normalizeScienceNavigationComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function extractTitleFromHtml(html: string) {
  const matched = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(matched?.[1] ?? '');
}

export function isScienceChallengeHtml(html: string) {
  const normalized = cleanText(html).toLowerCase();
  if (!normalized) return false;

  if (normalized.includes('cloudflare') && normalized.includes('ray id')) {
    return true;
  }

  if (normalized.includes('cf-mitigated') || normalized.includes('challenge-platform')) {
    return true;
  }

  return SCIENCE_CHALLENGE_HTML_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

export function isScienceValidationReadyState(
  state: ScienceValidationWindowState,
  requireListingContent: boolean,
) {
  if (requireListingContent) {
    return state.sectionCount > 0;
  }

  return state.hasDownloadControls || state.hasPdfEmbed;
}

export function isScienceValidationStableReadyState(
  state: ScienceValidationWindowState,
  requireListingContent: boolean,
) {
  if (requireListingContent) {
    return state.hasStableReadyForListing;
  }

  return state.hasStableReadyForPage;
}

export function summarizeScienceValidationHtml(html: string) {
  const normalized = cleanText(html).toLowerCase();
  return {
    hasCloudflare: normalized.includes('cloudflare'),
    hasChallengePlatform: normalized.includes('challenge-platform'),
    hasCfMitigated: normalized.includes('cf-mitigated'),
    hasDownloadPdfHref: normalized.includes('/doi/pdf/'),
    hasNavbarDownload: normalized.includes('navbar-download'),
    hasPdfEmbed:
      normalized.includes('application/pdf') ||
      normalized.includes('<embed') ||
      normalized.includes('<iframe'),
    textSample: normalized.slice(0, 220),
  };
}

export function buildScienceValidationStateSignature(state: ScienceValidationWindowState) {
  return JSON.stringify({
    currentUrl: state.currentUrl,
    title: state.title,
    documentReadyState: state.documentReadyState,
    visibilityState: state.visibilityState,
    bodyTextSample: state.bodyTextSample,
    sectionCount: state.sectionCount,
    hasChallengeIndicators: state.hasChallengeIndicators,
    hasDownloadControls: state.hasDownloadControls,
    hasPdfEmbed: state.hasPdfEmbed,
    hasRecaptchaIndicators: state.hasRecaptchaIndicators,
    hasStableReadyForListing: state.hasStableReadyForListing,
    hasStableReadyForPage: state.hasStableReadyForPage,
  });
}
