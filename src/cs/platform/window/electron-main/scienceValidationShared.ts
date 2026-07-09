import { isCompatFetchEnvEnabled } from 'cs/platform/fetch/node/fetchTiming';

export const SCIENCE_VALIDATION_TIMEOUT_MS = 3 * 60 * 1000;
export const SCIENCE_VALIDATION_POLL_MS = 600;
export const SCIENCE_VALIDATION_BOOT_TIMEOUT_MS = 4000;
export const SCIENCE_VALIDATION_REVEAL_DELAY_MS = 1200;
export const SCIENCE_VALIDATION_READY_SETTLE_MS = 2500;
export const SCIENCE_VALIDATION_PROGRESS_LOG_INTERVAL_MS = 10 * 1000;
export const SCIENCE_VALIDATION_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);
export const SCIENCE_VALIDATION_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
export const SCIENCE_VALIDATION_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
export const SCIENCE_VALIDATION_ACCEPT_LANGUAGE = 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7';

// Platform-side DOM probes only: injected scripts and window-scoped constants.
const SCIENCE_RECAPTCHA_ATTRIBUTE_SNIPPETS = [
  'recaptcha',
  'g-recaptcha',
  'grecaptcha',
  'google.com/recaptcha',
  'recaptcha.net/recaptcha',
] as const;

export const SCIENCE_DOWNLOAD_CONTROL_SELECTORS = [
  'a.navbar-download[href]',
  'a[data-single-download="true"][href]',
  'a[data-download-files-key="pdf"][href]',
  'a[aria-label*="Download PDF"][href]',
  'a[title*="Download PDF"][href]',
  'a[href*="/doi/pdf/"][href]',
] as const;

const SCIENCE_PDF_EMBED_SELECTORS = [
  'iframe[src*="/doi/pdf/"]',
  'embed[type="application/pdf"]',
  'object[type="application/pdf"]',
] as const;

const SCIENCE_VALIDATION_SECTION_SELECTORS = [
  'div.toc > div.toc__body > div.toc__body > section.toc__section',
  'div.toc__body > div.toc__body > section.toc__section',
  'div.toc__body > section.toc__section',
] as const;

const SCIENCE_VALIDATION_CHALLENGE_CANDIDATE_SELECTOR =
  'iframe[src], iframe[title], script[src], [data-sitekey], .g-recaptcha, #recaptcha';

function buildScienceValidationStateScript() {
  return String.raw`(() => {
    const settleMs = ${JSON.stringify(SCIENCE_VALIDATION_READY_SETTLE_MS)};
    const monitorKey = '__scienceValidationMonitor';
    const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const normalizedText = cleanText(document.documentElement?.textContent ?? '').toLowerCase();
    const title = cleanText(document.title);
    const normalizedTitle = title.toLowerCase();
    const downloadSelectors = ${JSON.stringify(SCIENCE_DOWNLOAD_CONTROL_SELECTORS)};
    const pdfEmbedSelectors = ${JSON.stringify(SCIENCE_PDF_EMBED_SELECTORS)};
    const challengeAttributeSnippets = ${JSON.stringify(SCIENCE_RECAPTCHA_ATTRIBUTE_SNIPPETS)};
    const sectionSelector = ${JSON.stringify(SCIENCE_VALIDATION_SECTION_SELECTORS.join(', '))};
    const challengeCandidateSelector = ${JSON.stringify(SCIENCE_VALIDATION_CHALLENGE_CANDIDATE_SELECTOR)};
    const challengeContainerSelector = '#challenge-stage, .cf-challenge, .challenge-stage, .challenge-container';
    const primaryContentRoot =
      document.querySelector('main article') ||
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.body ||
      document.documentElement;
    const primaryContentText = cleanText(primaryContentRoot?.textContent ?? '').toLowerCase();
    const sectionCount = document.querySelectorAll(sectionSelector).length;
    const hasDownloadControls = downloadSelectors.some((selector) => Boolean(document.querySelector(selector)));
    const hasPdfEmbed = pdfEmbedSelectors.some((selector) => Boolean(document.querySelector(selector)));
    const challengeCandidates = Array.from(document.querySelectorAll(challengeCandidateSelector));
    const hasRecaptchaIndicators = challengeCandidates.some((element) => {
      const fragments = [
        element.getAttribute?.('src'),
        element.getAttribute?.('title'),
        element.getAttribute?.('id'),
        element.getAttribute?.('class'),
        element.getAttribute?.('name'),
        element.getAttribute?.('data-sitekey'),
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .filter(Boolean);
      return fragments.some((value) => challengeAttributeSnippets.some((snippet) => value.includes(snippet)));
    });
    const hasChallengeContainer = Boolean(document.querySelector(challengeContainerSelector));
    const hasCloudflareChallengeText =
      normalizedText.includes('cloudflare') &&
      normalizedText.includes('ray id');
    const hasVerificationText =
      normalizedTitle.includes('just a moment') ||
      normalizedTitle.includes('attention required') ||
      primaryContentText.includes('verify you are human') ||
      primaryContentText.includes('complete the security check') ||
      primaryContentText.includes('checking your browser before accessing') ||
      primaryContentText.includes('press and hold') ||
      primaryContentText.includes('enable javascript and cookies to continue');
    const hasTargetContent = sectionCount > 0 || hasDownloadControls || hasPdfEmbed;
    const hasChallengeIndicators =
      hasCloudflareChallengeText ||
      hasChallengeContainer ||
      (!hasTargetContent && hasRecaptchaIndicators && hasVerificationText);
    const ensureMonitor = () => {
      const existingMonitor = window[monitorKey];
      if (existingMonitor && typeof existingMonitor === 'object') {
        return existingMonitor;
      }

      const monitor = {
        lastMutationAtMs: Date.now(),
        observer: null,
      };
      const touchMonitor = () => {
        monitor.lastMutationAtMs = Date.now();
      };

      if (typeof MutationObserver === 'function' && document.documentElement) {
        monitor.observer = new MutationObserver(() => {
          touchMonitor();
        });
        monitor.observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      }

      window.addEventListener('load', touchMonitor);
      document.addEventListener('readystatechange', touchMonitor);
      window.addEventListener(
        'beforeunload',
        () => {
          try {
            monitor.observer?.disconnect?.();
          } catch {}
          try {
            delete window[monitorKey];
          } catch {}
        },
        { once: true },
      );

      window[monitorKey] = monitor;
      return monitor;
    };
    const validationMonitor = ensureMonitor();
    const now = Date.now();
    const bodyTextSample = normalizedText.slice(0, 220);
    const hasStableReadyForListing =
      sectionCount > 0 &&
      !hasChallengeIndicators &&
      now - Number(validationMonitor.lastMutationAtMs ?? 0) >= settleMs;
    const hasStableReadyForPage =
      (hasDownloadControls || hasPdfEmbed) &&
      !hasChallengeIndicators &&
      now - Number(validationMonitor.lastMutationAtMs ?? 0) >= settleMs;
    return {
      currentUrl: location.href,
      title,
      documentReadyState: cleanText(document.readyState),
      visibilityState: cleanText(document.visibilityState),
      bodyTextSample,
      sectionCount,
      hasChallengeIndicators,
      hasDownloadControls,
      hasPdfEmbed,
      hasRecaptchaIndicators,
      lastMutationAtMs: Number(validationMonitor.lastMutationAtMs ?? 0),
      hasStableReadyForListing,
      hasStableReadyForPage,
    };
  })()`;
}

export const SCIENCE_VALIDATION_STATE_SCRIPT = buildScienceValidationStateScript();

export const SCIENCE_VALIDATION_HTML_SCRIPT = String.raw`(() => {
  try {
    return document.documentElement ? document.documentElement.outerHTML : '';
  } catch {
    return '';
  }
})()`;
