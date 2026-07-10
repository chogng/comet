/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import type { DateRange } from 'cs/base/common/date';
import type { URI } from 'cs/base/common/uri';
import type {
	FetchArticleAuthor,
	FetchArticleCandidate,
	FetchArticleFigure,
	FetchArticleReference,
	FetchArticleSection,
} from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleKind } from 'cs/base/parts/sandbox/common/fetchArticleKind';
import type { FetchArticlePublication } from 'cs/base/parts/sandbox/common/fetchPublication';
import type { FetchStructureEvidence } from 'cs/workbench/services/fetch/common/fetchDiagnostics';

export type FetchPageDom = ReturnType<typeof load>;

export interface FetchArticleIdentity {
	readonly articleId: string;
	readonly pageFamilyHint: string;
	readonly doiHint?: string;
	readonly publicationHint?: FetchArticlePublication;
}

export interface FetchArticleListParserContext {
	readonly sourceUri: URI;
	readonly articleListSourceId: string;
	readonly $: FetchPageDom;
}

export interface FetchArticleListParserProof {
	readonly parserId: string;
	readonly evidence: readonly FetchStructureEvidence[];
}

export interface FetchArticleListParseResult {
	readonly candidates: readonly FetchArticleCandidate[];
	readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export interface FetchArticleListParser {
	readonly id: string;
	match(context: FetchArticleListParserContext): FetchArticleListParserProof | undefined;
	parse(
		context: FetchArticleListParserContext,
		proof: FetchArticleListParserProof,
	): FetchArticleListParseResult;
}

export interface FetchArticleListPaginationContext extends FetchArticleListParserContext {
	readonly seenPageUris: ReadonlySet<string>;
}

export interface FetchArticleListPaginationStopContext {
	readonly sourceUri: URI;
	readonly pageNumber: number;
	readonly dateRange: DateRange;
	readonly candidates: readonly FetchArticleCandidate[];
}

export interface FetchArticleListPaginationStopEvaluation {
	readonly shouldStop: boolean;
	readonly reason?: string;
	readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export type FetchArticleListPaginationPolicy =
	| { readonly kind: 'none' }
	| {
		readonly kind: 'nextLink';
		findNextPageUri(context: FetchArticleListPaginationContext): URI | undefined;
		evaluateStop?(
			context: FetchArticleListPaginationStopContext,
		): FetchArticleListPaginationStopEvaluation | undefined;
	};

export interface FetchArticleListEnrichmentContext {
	readonly sourceUri: URI;
	readonly pageNumber: number;
	readonly traceId: string;
	readonly candidates: readonly FetchArticleCandidate[];
	readonly signal?: AbortSignal;
	readonly fetchText: (
		uri: URI,
		options: { readonly timeoutMs: number; readonly stage: string; readonly signal?: AbortSignal },
	) => Promise<string>;
}

export interface FetchArticleListEnrichmentPolicy {
	readonly kind: string;
	enrich(
		context: FetchArticleListEnrichmentContext,
	): Promise<readonly FetchArticleCandidate[]>;
}

export interface FetchArticleListSource {
	readonly id: string;
	readonly allowedParserIds: readonly string[];
	matchUri(uri: URI): boolean;
	matchLoadedUri(requestedUri: URI, finalUri: URI): boolean;
	readonly pagination: FetchArticleListPaginationPolicy;
	readonly enrichment?: FetchArticleListEnrichmentPolicy;
}

export interface FetchArticleDetailParserContext {
	readonly sourceUri: URI;
	readonly finalUri: URI;
	readonly $: FetchPageDom;
	readonly identity?: FetchArticleIdentity;
}

export interface FetchArticleDetailParserProof {
	readonly parserId: string;
	readonly evidence: readonly FetchStructureEvidence[];
}

export interface FetchArticleDraft {
	readonly sourceUri: URI;
	readonly canonicalUri?: URI;
	readonly publisherArticleId?: string;
	readonly doi?: string;
	readonly doiSource?: string;
	readonly title?: string;
	readonly publication?: FetchArticlePublication;
	readonly articleKind?: FetchArticleKind;
	readonly sourceArticleType?: string;
	readonly authors: readonly FetchArticleAuthor[];
	readonly abstract?: string;
	readonly sections: readonly FetchArticleSection[];
	readonly figures: readonly FetchArticleFigure[];
	readonly references: readonly FetchArticleReference[];
	readonly publishedAt?: string;
	readonly receivedAt?: string;
	readonly acceptedAt?: string;
	readonly classificationEvidence: readonly string[];
}

export interface FetchArticleDetailParser {
	readonly id: string;
	match(context: FetchArticleDetailParserContext): FetchArticleDetailParserProof | undefined;
	parse(
		context: FetchArticleDetailParserContext,
		proof: FetchArticleDetailParserProof,
	): FetchArticleDraft;
}

export interface FetchPageAcquisitionPolicy {
	readonly settleMs: number;
}

export interface FetchSiteProvider {
	readonly id: string;
	readonly acquisitionPolicy: FetchPageAcquisitionPolicy;
	readonly articleListSources: readonly FetchArticleListSource[];
	readonly articleListParsers: readonly FetchArticleListParser[];
	readonly articleDetailParsers: readonly FetchArticleDetailParser[];
	matchUri(uri: URI): boolean;
	normalizeArticleAuthority?(authority: string): string;
	resolveArticleIdentity?(uri: URI): FetchArticleIdentity | undefined;
	resolveArticleDetailParserIds?(
		identity: FetchArticleIdentity,
	): readonly string[] | undefined;
}
