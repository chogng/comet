import type {
  Article,
  AppSettings,
  RagAnswerArticlesPayload,
  RagAnswerResult,
  RagEvidenceItem,
  RagSettings,
  TestRagConnectionPayload,
  LlmSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { appError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import { resolveLlmRoute } from 'cs/workbench/services/llm/routing';
import { resolveRagRoute } from 'cs/workbench/services/rag/routing';
import {
  extractResponseContent,
  requestOpenAiCompatibleResponse,
  resolveLlmRequestFromPayload,
} from 'cs/code/electron-main/llm/llm';
import {
  requestMoarkEmbeddings,
  requestMoarkRerank,
  resolveMoarkRequest,
  testMoarkConnection,
} from 'cs/code/electron-main/rag/moark';

const ragAnswerTimeoutMs = 60000;
const maxArticlesForRetrieval = 60;
const maxEvidenceExcerptLength = 680;
const maxArticleTextLength = 2400;

type RetrievalCandidate = {
  retrievalIndex: number;
  article: Article;
  articleText: string;
  excerpt: string;
  score: number;
};

function normalizeQuestion(value: unknown): string {
  const question = cleanText(value);
  if (!question) {
    throw appError('RAG_QUERY_EMPTY');
  }

  return question;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm <= 0 || rightNorm <= 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildArticleText(article: Article): string {
  const sections = [
    cleanText(article.title) ? `Title: ${cleanText(article.title)}` : '',
    cleanText(article.journalTitle) ? `Journal: ${cleanText(article.journalTitle)}` : '',
    cleanText(article.publishedAt) ? `Published: ${cleanText(article.publishedAt)}` : '',
    Array.isArray(article.authors) && article.authors.length > 0
      ? `Authors: ${article.authors.map((author) => cleanText(author)).filter(Boolean).join(', ')}`
      : '',
    cleanText(article.doi) ? `DOI: ${cleanText(article.doi)}` : '',
    cleanText(article.abstractText) ? `Abstract: ${cleanText(article.abstractText)}` : '',
    cleanText(article.descriptionText) ? `Description: ${cleanText(article.descriptionText)}` : '',
  ].filter(Boolean);

  return truncateText(sections.join('\n'), maxArticleTextLength);
}

function buildEvidenceExcerpt(article: Article): string {
  const sourceText =
    cleanText(article.abstractText) ||
    cleanText(article.descriptionText) ||
    cleanText(article.title) ||
    cleanText(article.sourceUrl);

  return truncateText(sourceText, maxEvidenceExcerptLength);
}

function resolveRagSettings(
  payload: RagAnswerArticlesPayload,
  appSettings: Pick<AppSettings, 'rag'>,
): RagSettings {
  return payload.rag ?? appSettings.rag;
}

function resolveLlmSettings(
  payload: RagAnswerArticlesPayload,
  appSettings: Pick<AppSettings, 'llm'>,
): LlmSettings {
  return payload.llm ?? appSettings.llm;
}

function resolveRelevantArticles(articles: Article[]): Article[] {
  return articles
    .filter((article) => Boolean(cleanText(article.title) || cleanText(article.abstractText) || cleanText(article.descriptionText)))
    .slice(0, maxArticlesForRetrieval);
}

function buildRetrievalQuery(question: string, writingContext: string): string {
  return cleanText(
    [question, writingContext ? `Writing context:\n${writingContext}` : ''].filter(Boolean).join('\n\n'),
  );
}

function buildEvidencePrompt(evidence: RagEvidenceItem[]): string {
  return evidence
    .map((item) =>
      [
        `[${item.rank}] ${item.title}`,
        item.journalTitle ? `Journal: ${item.journalTitle}` : '',
        item.publishedAt ? `Published: ${item.publishedAt}` : '',
        `Source: ${item.sourceUrl}`,
        `Excerpt: ${item.excerpt}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

function buildRagMessages(question: string, writingContext: string, evidence: RagEvidenceItem[]) {
  if (evidence.length === 0) {
    return [
      {
        role: 'system' as const,
        content:
          'You are a literature writing assistant. Provide concise and accurate answers, and clearly state uncertainty when context is insufficient.',
      },
      {
        role: 'user' as const,
        content: [
          `Question:\n${question}`,
          writingContext ? `Writing context:\n${writingContext}` : '',
          'Answer directly and keep it practical for writing.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
  }

  const evidencePrompt = buildEvidencePrompt(evidence);
  return [
    {
      role: 'system' as const,
      content:
        'You are a literature writing assistant. Answer only from the supplied evidence, cite evidence with bracketed numbers like [1], and say when evidence is insufficient.',
    },
    {
      role: 'user' as const,
      content: [
        `Question:\n${question}`,
        writingContext ? `Writing context:\n${writingContext}` : '',
        `Evidence:\n${evidencePrompt}`,
        'Write a concise evidence-grounded answer. Keep citations attached to the relevant claims.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export async function testRagConnection(payload: TestRagConnectionPayload = {}) {
  return testMoarkConnection(payload);
}

export async function answerQuestionFromArticles(
  payload: RagAnswerArticlesPayload,
  appSettings: Pick<AppSettings, 'llm' | 'rag'>,
): Promise<RagAnswerResult> {
  const question = normalizeQuestion(payload.question);
  const writingContext = cleanText(payload.writingContext);
  const articles = resolveRelevantArticles(Array.isArray(payload.articles) ? payload.articles : []);
  const ragSettings = resolveRagSettings(payload, appSettings);
  const llmSettings = resolveLlmSettings(payload, appSettings);
  const ragRoute = resolveRagRoute(ragSettings);
  const shouldUseRetrieval = ragSettings.enabled && articles.length > 0;
  let evidence: RagEvidenceItem[] = [];
  let rerankApplied = false;

  if (shouldUseRetrieval) {
    const moarkRequest = resolveMoarkRequest({
      provider: ragRoute.provider,
      apiKey: ragRoute.apiKey,
      baseUrl: ragRoute.baseUrl,
      embeddingModel: ragRoute.embeddingModel,
      rerankerModel: ragRoute.rerankerModel,
      embeddingPath: ragRoute.embeddingPath,
      rerankPath: ragRoute.rerankPath,
    });

    const retrievalQuery = buildRetrievalQuery(question, writingContext);
    const articleTexts = articles.map((article) => buildArticleText(article));
    const embeddingVectors = await requestMoarkEmbeddings(
      moarkRequest,
      [retrievalQuery, ...articleTexts],
      ragAnswerTimeoutMs,
    );
    const queryEmbedding = embeddingVectors[0] ?? [];
    const documentEmbeddings = embeddingVectors.slice(1);
    const embeddingRankedCandidates = articles
      .map((article, index) => {
        const articleText = articleTexts[index] ?? '';
        return {
          retrievalIndex: index,
          article,
          articleText,
          excerpt: buildEvidenceExcerpt(article),
          score: cosineSimilarity(queryEmbedding, documentEmbeddings[index] ?? []),
        } satisfies RetrievalCandidate;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(ragRoute.retrievalCandidateCount, articles.length));
    const indexedEmbeddingCandidates = embeddingRankedCandidates.map((candidate, index) => ({
      ...candidate,
      retrievalIndex: index,
    }));

    let rerankedCandidates = indexedEmbeddingCandidates;

    if (indexedEmbeddingCandidates.length > 0) {
      try {
        const rerankResults = await requestMoarkRerank(
          moarkRequest,
          retrievalQuery,
          indexedEmbeddingCandidates.map((candidate) => candidate.articleText),
          Math.min(ragRoute.retrievalTopK, indexedEmbeddingCandidates.length),
          ragAnswerTimeoutMs,
        );
        if (rerankResults.length > 0) {
          const rerankedByIndex = new Map(
            rerankResults.map((result, index) => [result.index, { position: index, score: result.score }] as const),
          );
          rerankedCandidates = indexedEmbeddingCandidates
            .filter((candidate) => rerankedByIndex.has(candidate.retrievalIndex))
            .sort((left, right) => {
              const leftEntry = rerankedByIndex.get(left.retrievalIndex);
              const rightEntry = rerankedByIndex.get(right.retrievalIndex);
              return (leftEntry?.position ?? Number.MAX_SAFE_INTEGER) - (rightEntry?.position ?? Number.MAX_SAFE_INTEGER);
            })
            .map((candidate) => {
              const rerankEntry = rerankedByIndex.get(candidate.retrievalIndex);
              return {
                ...candidate,
                score: rerankEntry?.score ?? candidate.score,
              };
            });
          rerankApplied = true;
        }
      } catch {
        rerankedCandidates = indexedEmbeddingCandidates;
      }
    }

    evidence = rerankedCandidates
      .slice(0, Math.min(ragRoute.retrievalTopK, rerankedCandidates.length))
      .map((candidate, index) => ({
        rank: index + 1,
        title: cleanText(candidate.article.title) || candidate.article.sourceUrl,
        journalTitle: cleanText(candidate.article.journalTitle) || null,
        publishedAt: cleanText(candidate.article.publishedAt) || null,
        sourceUrl: candidate.article.sourceUrl,
        score: Number.isFinite(candidate.score) ? candidate.score : null,
        excerpt: candidate.excerpt,
      })) satisfies RagEvidenceItem[];
  }

  const llmRoute = resolveLlmRoute(llmSettings, 'reasoning');
  const llmRequest = resolveLlmRequestFromPayload({
    provider: llmRoute.provider,
    apiKey: llmRoute.apiKey,
    baseUrl: llmRoute.baseUrl,
    model: llmRoute.model,
    reasoningEffort: llmRoute.reasoningEffort,
    serviceTier: llmRoute.serviceTier,
  });
  const llmResponse = await requestOpenAiCompatibleResponse(
    llmRequest,
    {
      model: llmRoute.model,
      reasoning: llmRoute.reasoningEffort ? { effort: llmRoute.reasoningEffort } : undefined,
      service_tier: llmRoute.serviceTier,
      input: buildRagMessages(question, writingContext, evidence),
      max_output_tokens: 1200,
      temperature: 0.2,
    },
    ragAnswerTimeoutMs,
  );
  const answer = extractResponseContent(llmResponse) || 'No answer returned.';

  return {
    answer,
    evidence,
    provider: ragRoute.provider,
    llmProvider: llmRoute.provider,
    llmModel: llmRoute.model,
    embeddingModel: ragRoute.embeddingModel,
    rerankerModel: ragRoute.rerankerModel,
    rerankApplied,
  };
}
