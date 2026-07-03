import type {
  RagConnectionTestResult,
  RagProviderId,
  TestRagConnectionPayload,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { appError, isAppError } from 'ls/base/common/errors';
import { cleanText } from 'ls/base/common/strings';
import { defaultRagProviderId } from 'ls/workbench/services/rag/config';
import { isRagProviderId } from 'ls/workbench/services/rag/registry';

const ragTestTimeoutMs = 20000;

export type ResolvedMoarkRequest = {
  provider: RagProviderId;
  apiKey: string;
  baseUrl: string;
  embeddingModel: string;
  rerankerModel: string;
  embeddingPath: string;
  rerankPath: string;
};

type MoarkRerankResult = {
  index: number;
  score: number | null;
};

function normalizeProvider(value: unknown): RagProviderId {
  if (!isRagProviderId(value)) {
    throw appError('RAG_PROVIDER_UNSUPPORTED', {
      provider: typeof value === 'string' ? value : '',
    });
  }

  return value;
}

function normalizeBaseUrl(value: unknown): string {
  const baseUrl = cleanText(value);
  if (!baseUrl) {
    throw appError('RAG_BASE_URL_INVALID', { value: '' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw appError('RAG_BASE_URL_INVALID', { value: baseUrl });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw appError('RAG_BASE_URL_INVALID', { value: baseUrl });
  }

  return parsedUrl.toString().replace(/\/+$/, '');
}

function normalizeApiKey(value: unknown): string {
  const apiKey = cleanText(value);
  if (!apiKey) {
    throw appError('RAG_API_KEY_MISSING');
  }

  return apiKey;
}

function normalizeEmbeddingModel(value: unknown): string {
  const embeddingModel = cleanText(value);
  if (!embeddingModel) {
    throw appError('RAG_EMBEDDING_MODEL_MISSING');
  }

  return embeddingModel;
}

function normalizeRerankerModel(value: unknown): string {
  const rerankerModel = cleanText(value);
  if (!rerankerModel) {
    throw appError('RAG_RERANKER_MODEL_MISSING');
  }

  return rerankerModel;
}

function normalizeEndpointPath(value: unknown, fallbackValue: string): string {
  const endpointPath = cleanText(value) || fallbackValue;
  if (/^https?:\/\//i.test(endpointPath)) {
    return endpointPath.replace(/\/+$/, '');
  }

  return endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
}

function buildEndpointUrl(baseUrl: string, endpointPath: string): string {
  if (/^https?:\/\//i.test(endpointPath)) {
    return endpointPath;
  }

  return `${baseUrl}${endpointPath}`;
}

function createHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function requestJson(
  request: ResolvedMoarkRequest,
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: createHeaders(request.apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = cleanText(await response.text());
      throw appError('RAG_CONNECTION_FAILED', {
        provider: request.provider,
        status: response.status,
        statusText: response.statusText || errorText || 'Request failed',
      });
    }

    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw appError('RAG_CONNECTION_FAILED', {
        provider: request.provider,
        status: 'TIMEOUT',
        statusText: `Connection timed out after ${timeoutMs}ms`,
      });
    }

    if (isAppError(error)) {
      throw error;
    }

    throw appError('RAG_CONNECTION_FAILED', {
      provider: request.provider,
      status: 'NETWORK_ERROR',
      statusText: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseEmbeddingResponse(payload: unknown): number[][] {
  if (!payload || typeof payload !== 'object') {
    throw appError('RAG_CONNECTION_FAILED', {
      status: 'INVALID_RESPONSE',
      statusText: 'Embedding response payload is not an object.',
    });
  }

  const data = (payload as { data?: Array<{ embedding?: unknown }> }).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw appError('RAG_CONNECTION_FAILED', {
      status: 'INVALID_RESPONSE',
      statusText: 'Embedding response data is empty.',
    });
  }

  return data.map((item) => {
    if (!Array.isArray(item?.embedding)) {
      throw appError('RAG_CONNECTION_FAILED', {
        status: 'INVALID_RESPONSE',
        statusText: 'Embedding vector is missing.',
      });
    }

    return item.embedding.map((value) => Number(value));
  });
}

function parseRerankResponse(payload: unknown): MoarkRerankResult[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const data = (
    payload as {
      results?: Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>;
      data?: Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>;
    }
  ).results ?? (
    payload as {
      data?: Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>;
    }
  ).data;

  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      const index = Number(item?.index);
      if (!Number.isFinite(index)) {
        return null;
      }

      const rawScore =
        typeof item?.relevance_score === 'number'
          ? item.relevance_score
          : typeof item?.score === 'number'
            ? item.score
            : null;

      return {
        index,
        score: rawScore,
      };
    })
    .filter((item): item is MoarkRerankResult => Boolean(item));
}

export function resolveMoarkRequest(payload: TestRagConnectionPayload = {}): ResolvedMoarkRequest {
  return {
    provider: normalizeProvider(payload.provider ?? defaultRagProviderId),
    apiKey: normalizeApiKey(payload.apiKey),
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    embeddingModel: normalizeEmbeddingModel(payload.embeddingModel),
    rerankerModel: normalizeRerankerModel(payload.rerankerModel),
    embeddingPath: normalizeEndpointPath(payload.embeddingPath, '/embeddings'),
    rerankPath: normalizeEndpointPath(payload.rerankPath, '/rerank/multimodal'),
  };
}

export async function requestMoarkEmbeddings(
  request: ResolvedMoarkRequest,
  input: string[],
  timeoutMs = ragTestTimeoutMs,
): Promise<number[][]> {
  const responseJson = await requestJson(
    request,
    buildEndpointUrl(request.baseUrl, request.embeddingPath),
    {
      model: request.embeddingModel,
      input,
    },
    timeoutMs,
  );

  return parseEmbeddingResponse(responseJson);
}

export async function requestMoarkRerank(
  request: ResolvedMoarkRequest,
  query: string,
  documents: string[],
  topN: number,
  timeoutMs = ragTestTimeoutMs,
): Promise<MoarkRerankResult[]> {
  const url = buildEndpointUrl(request.baseUrl, request.rerankPath);
  const attempts = [
    {
      model: request.rerankerModel,
      query,
      documents,
      top_n: topN,
      return_documents: true,
    },
    {
      model: request.rerankerModel,
      query,
      documents: documents.map((text) => ({ text })),
      top_n: topN,
      return_documents: true,
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const responseJson = await requestJson(request, url, attempt, timeoutMs);
      const results = parseRerankResponse(responseJson);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw appError('RAG_CONNECTION_FAILED', {
    provider: request.provider,
    status: 'INVALID_RESPONSE',
    statusText: 'Rerank response did not return any results.',
  });
}

export async function testMoarkConnection(
  payload: TestRagConnectionPayload = {},
): Promise<RagConnectionTestResult> {
  const request = resolveMoarkRequest(payload);
  const embeddings = await requestMoarkEmbeddings(request, ['test', 'validation']);
  const rerankResults = await requestMoarkRerank(
    request,
    'Which document is about literature?',
    ['This document is about literature review.', 'This document is about weather.'],
    2,
  );

  return {
    provider: request.provider,
    baseUrl: request.baseUrl,
    embeddingModel: request.embeddingModel,
    rerankerModel: request.rerankerModel,
    embeddingDimensions: embeddings[0]?.length ?? 0,
    rerankCount: rerankResults.length,
  };
}
