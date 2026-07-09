import { appError } from 'cs/base/common/errors';
import { elapsedMs, shortenForLog, timingLog } from 'cs/platform/fetch/node/fetchTiming';
import {
  getScienceChallengeSignal,
  isScienceChallengeHtml,
  shouldUseScienceValidationRenderFallback,
} from 'cs/platform/window/electron-main/scienceValidationRules';
import { ensureScienceValidationWindow } from 'cs/platform/window/electron-main/scienceValidationWindow';

export type ChannelFetchOptions = {
  timeoutMs?: number;
  traceId?: string;
  stage?: string;
};

export type NetworkAttemptResult =
  | {
      ok: true;
      html: string;
    }
  | {
      ok: false;
      error: unknown;
    };

export type NetworkHtmlResult = {
  html: string;
  source: 'network';
  usedRenderFallback?: boolean;
};

type NetworkAttemptDependencies = {
  fetchHtml: (url: string, options?: ChannelFetchOptions) => Promise<string>;
  describeError: (error: unknown) => string;
};

type ResolveNetworkAttemptDependencies = {
  fetchRenderedHtml: (url: string, options?: ChannelFetchOptions) => Promise<string>;
  shouldRenderPageAfterError: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  toErrorStatusCode: (error: unknown) => string;
};

export async function attemptNetworkHtml(
  {
    pageUrl,
    traceId,
    stage,
    benchmarkStage = null,
    pageFetchTimeoutMs,
  }: {
    pageUrl: string;
    traceId: string;
    stage: string;
    benchmarkStage?: string | null;
    pageFetchTimeoutMs: number;
  },
  dependencies: NetworkAttemptDependencies,
): Promise<NetworkAttemptResult> {
  const startedAt = Date.now();

  try {
    const html = await dependencies.fetchHtml(pageUrl, {
      timeoutMs: pageFetchTimeoutMs,
      traceId,
      stage,
    });

    if (benchmarkStage) {
      timingLog(traceId, benchmarkStage, {
        outcome: 'ok',
        ms: elapsedMs(startedAt),
        size: html.length,
        url: shortenForLog(pageUrl),
      });
    }

    return {
      ok: true,
      html,
    };
  } catch (error) {
    if (benchmarkStage) {
      timingLog(traceId, benchmarkStage, {
        outcome: 'failed',
        ms: elapsedMs(startedAt),
        message: dependencies.describeError(error),
        url: shortenForLog(pageUrl),
      });
    }

    return {
      ok: false,
      error,
    };
  }
}

export async function resolveNetworkAttemptResult(
  {
    pageUrl,
    traceId,
    reason,
    attemptResult,
    renderStage,
    pageRenderTimeoutMs,
  }: {
    pageUrl: string;
    traceId: string;
    reason: string;
    attemptResult: NetworkAttemptResult;
    renderStage: string;
    pageRenderTimeoutMs: number;
  },
  dependencies: ResolveNetworkAttemptDependencies,
): Promise<NetworkHtmlResult> {
  if ('error' in attemptResult) {
    const scienceChallengeSignal = getScienceChallengeSignal(attemptResult.error);
    const scienceValidationFallback = shouldUseScienceValidationRenderFallback({
      pageUrl,
      error: attemptResult.error,
    });
    if (scienceValidationFallback) {
      try {
        const validatedPage = await ensureScienceValidationWindow(pageUrl);
        timingLog(traceId, 'source:science_validation_window_applied', {
          reason,
          url: shortenForLog(pageUrl),
          finalUrl: shortenForLog(validatedPage.finalUrl),
          size: validatedPage.html.length,
          sectionCount: validatedPage.sectionCount,
          title: validatedPage.title,
          readyMs: validatedPage.readyMs,
          navigationMode: validatedPage.navigationMode,
          validationSource: validatedPage.source,
          failedStatus: dependencies.toErrorStatusCode(attemptResult.error) || null,
          scienceChallengeSignal,
        });
        timingLog(traceId, 'source:page_selected', {
          selected: 'network',
          reason: `${reason}_science_validation_window`,
          size: validatedPage.html.length,
          url: shortenForLog(pageUrl),
        });
        return {
          html: validatedPage.html,
          source: 'network',
          usedRenderFallback: false,
        };
      } catch (validationError) {
        timingLog(traceId, 'source:science_validation_window_failed', {
          reason,
          message: dependencies.describeError(validationError),
          url: shortenForLog(pageUrl),
          failedStatus: dependencies.toErrorStatusCode(attemptResult.error) || null,
          scienceValidationFallback,
          scienceChallengeSignal,
        });

        throw validationError;
      }
    }

    if (dependencies.shouldRenderPageAfterError(attemptResult.error)) {
      try {
        const renderedHtml = await dependencies.fetchRenderedHtml(pageUrl, {
          timeoutMs: pageRenderTimeoutMs,
          traceId,
          stage: renderStage,
        });
        if (isScienceChallengeHtml(renderedHtml)) {
          throw appError('HTTP_REQUEST_FAILED', {
            status: 'SCIENCE_VALIDATION_REQUIRED',
            statusText: 'Complete the Science verification window to continue fetching.',
            url: pageUrl,
            scienceChallengeSignal: scienceChallengeSignal ?? undefined,
          });
        }
        timingLog(traceId, 'source:page_render_fallback_applied', {
          reason,
          size: renderedHtml.length,
          url: shortenForLog(pageUrl),
          failedStatus: dependencies.toErrorStatusCode(attemptResult.error) || null,
          scienceValidationFallback,
          scienceChallengeSignal,
        });
        timingLog(traceId, 'source:page_selected', {
          selected: 'network',
          reason: `${reason}_render_fallback`,
          size: renderedHtml.length,
          url: shortenForLog(pageUrl),
        });
        return {
          html: renderedHtml,
          source: 'network',
          usedRenderFallback: true,
        };
      } catch (renderError) {
        timingLog(traceId, 'source:page_render_fallback_failed', {
          reason,
          message: dependencies.describeError(renderError),
          url: shortenForLog(pageUrl),
          failedStatus: dependencies.toErrorStatusCode(attemptResult.error) || null,
          scienceValidationFallback,
          scienceChallengeSignal,
        });
      }
    }

    throw attemptResult.error;
  }

  timingLog(traceId, 'source:page_selected', {
    selected: 'network',
    reason,
    size: attemptResult.html.length,
    url: shortenForLog(pageUrl),
  });

  return {
    html: attemptResult.html,
    source: 'network',
  };
}
