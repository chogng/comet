/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanText } from 'cs/base/common/strings';
import { normalizeListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sites/types';
import type { ListingCandidateExtraction, ListingCandidateExtractorContext, ListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sites/types';

type ListingDomNode = Parameters<ListingCandidateExtractorContext['$']>[0];
type ListingDateValueParser = (value: unknown) => string | null;

type ListingCardDateConfig = {
	selector: string;
	parseValue: ListingDateValueParser;
	valueAttributes: readonly string[];
	rootValueAttributes: readonly string[];
	includeRootText: boolean;
	scopeSelector?: string;
};

type ListingCardOrderContext = Pick<ListingCandidateExtractorContext, '$' | 'pageUrl'> & {
	root: ListingDomNode;
	index: number;
	href: string;
	title: string;
	normalizedUrl: string;
};

type ListingCardExtraTextConfig = {
	key: string;
	selector: string;
	countDiagnosticKey?: string;
};

type ListingCardParsedCandidate = {
	href: string;
	normalizedUrl: string;
	title: string;
	order: number;
	dateHint: string | null;
	articleType: string | null;
	descriptionText: string | null;
	extraText: Record<string, string>;
	seed: ListingCandidateSeed;
};

type ListingCardDiagnosticsContext = {
	selected: ResolvedListingCardRoots;
	candidates: ListingCardParsedCandidate[];
	baseDiagnostics: Record<string, unknown>;
	extraTextCounts: Record<string, number>;
};

type ListingCardDomExtractorConfig = {
	cardSelectors: readonly string[];
	linkSelector: string;
	titleSelector: string;
	descriptionSelector?: string;
	articleTypeSelector?: string;
	extraTextSelectors?: readonly ListingCardExtraTextConfig[];
	date?: ListingCardDateConfig;
	scoreBoost: number;
	resolveOrder: (context: ListingCardOrderContext) => number | null;
	buildDiagnostics?: (context: ListingCardDiagnosticsContext) => Record<string, unknown>;
};

type ResolvedListingCardRoots = {
	selector: string;
	roots: ListingDomNode[];
	matchedCount: number;
};

function extractListingCardLink({
	$,
	root,
	linkSelector,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	linkSelector: string;
}) {
	return $(root).find(linkSelector).first();
}

function extractListingCardHref({
	$,
	root,
	linkSelector,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	linkSelector: string;
}) {
	return cleanText(extractListingCardLink({ $, root, linkSelector }).attr('href'));
}

function extractListingCardTitle({
	$,
	root,
	linkSelector,
	titleSelector,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	linkSelector: string;
	titleSelector: string;
}) {
	const title = cleanText($(root).find(titleSelector).first().text());
	if (title) return title;

	return cleanText(extractListingCardLink({ $, root, linkSelector }).text());
}

function resolveListingCardRoots({
	$,
	cardSelectors,
	linkSelector,
	titleSelector,
}: Pick<ListingCandidateExtractorContext, '$'> & Pick<ListingCardDomExtractorConfig, 'cardSelectors' | 'linkSelector' | 'titleSelector'>): ResolvedListingCardRoots | null {
	for (const selector of cardSelectors) {
		const roots = $(selector).toArray();
		if (roots.length === 0) continue;

		const matchedCount = roots.reduce((count, root) => {
			const href = extractListingCardHref({ $, root, linkSelector });
			const title = extractListingCardTitle({ $, root, linkSelector, titleSelector });
			return href && title ? count + 1 : count;
		}, 0);

		if (matchedCount === 0) continue;
		return {
			selector,
			roots,
			matchedCount,
		};
	}

	return null;
}

function collectDateValues({
	$,
	root,
	date,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	date: ListingCardDateConfig;
}) {
	const values: unknown[] = [];
	const rootNode = $(root);
	const scopedRoot = date.scopeSelector ? rootNode.find(date.scopeSelector).first() : rootNode;
	const dateRoot = scopedRoot.length > 0 ? scopedRoot : rootNode;
	for (const node of dateRoot.find(date.selector).toArray()) {
		const current = $(node);
		for (const attributeName of date.valueAttributes) {
			values.push(current.attr(attributeName));
		}
		values.push(current.text());
	}

	for (const attributeName of date.rootValueAttributes) {
		values.push(dateRoot.attr(attributeName));
	}
	if (date.includeRootText) {
		values.push(dateRoot.text());
	}

	return values;
}

function extractListingCardDateHint({
	$,
	root,
	date,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	date: ListingCardDateConfig;
}) {
	for (const value of collectDateValues({ $, root, date })) {
		const parsed = date.parseValue(value);
		if (parsed) return parsed;
	}

	return null;
}

function extractListingCardText({
	$,
	root,
	selector,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	selector: string | undefined;
}) {
	if (!selector) return '';

	return cleanText($(root).find(selector).first().text());
}

function extractListingCardExtraText({
	$,
	root,
	extraTextSelectors,
}: Pick<ListingCandidateExtractorContext, '$'> & {
	root: ListingDomNode;
	extraTextSelectors: readonly ListingCardExtraTextConfig[] | undefined;
}) {
	const values: Record<string, string> = {};
	for (const config of extraTextSelectors ?? []) {
		values[config.key] = extractListingCardText({ $, root, selector: config.selector });
	}

	return values;
}

function buildExtraTextCounts({
	extraTextSelectors,
	candidates,
}: {
	extraTextSelectors: readonly ListingCardExtraTextConfig[] | undefined;
	candidates: ListingCardParsedCandidate[];
}) {
	const counts: Record<string, number> = {};
	for (const config of extraTextSelectors ?? []) {
		counts[config.countDiagnosticKey ?? `${config.key}Count`] = candidates.filter(candidate => Boolean(candidate.extraText[config.key])).length;
	}

	return counts;
}

/** Extracts article candidates from card-like listing DOM. */
export function extractListingCardCandidates(
	context: ListingCandidateExtractorContext,
	config: ListingCardDomExtractorConfig,
): ListingCandidateExtraction | null {
	const { $, pageUrl } = context;
	const selected = resolveListingCardRoots({
		$,
		cardSelectors: config.cardSelectors,
		linkSelector: config.linkSelector,
		titleSelector: config.titleSelector,
	});
	if (!selected) return null;

	let typedCandidateCount = 0;
	const articleTypeCounts: Record<string, number> = {};
	const seen = new Set<string>();
	const parsedCandidates: ListingCardParsedCandidate[] = [];

	for (const [index, root] of selected.roots.entries()) {
		const href = extractListingCardHref({ $, root, linkSelector: config.linkSelector });
		const title = extractListingCardTitle({
			$,
			root,
			linkSelector: config.linkSelector,
			titleSelector: config.titleSelector,
		});
		if (!href || !title) continue;

		let normalizedUrl = '';
		try {
			normalizedUrl = new URL(href, pageUrl).toString();
		} catch {
			continue;
		}

		if (seen.has(normalizedUrl)) continue;
		seen.add(normalizedUrl);

		const order = config.resolveOrder({
			$,
			pageUrl,
			root,
			index,
			href,
			title,
			normalizedUrl,
		});
		if (order === null) continue;

		const articleType = extractListingCardText({
			$,
			root,
			selector: config.articleTypeSelector,
		}) || null;
		if (articleType) {
			typedCandidateCount += 1;
			articleTypeCounts[articleType] = (articleTypeCounts[articleType] ?? 0) + 1;
		}

		const dateHint = config.date
			? extractListingCardDateHint({ $, root, date: config.date })
			: null;
		const descriptionText = extractListingCardText({
			$,
			root,
			selector: config.descriptionSelector,
		}) || null;
		const extraText = extractListingCardExtraText({
			$,
			root,
			extraTextSelectors: config.extraTextSelectors,
		});

		const seed = normalizeListingCandidateSeed({
			href,
			order,
			dateHint,
			articleType,
			title,
			descriptionText,
			publishedAt: dateHint,
			scoreBoost: config.scoreBoost,
		});
		if (!seed) continue;

		parsedCandidates.push({
			href,
			normalizedUrl,
			title,
			order,
			dateHint,
			articleType,
			descriptionText,
			extraText,
			seed,
		});
	}

	const candidates = parsedCandidates.map(candidate => candidate.seed);
	if (candidates.length === 0) return null;

	const extraTextCounts = buildExtraTextCounts({
		extraTextSelectors: config.extraTextSelectors,
		candidates: parsedCandidates,
	});
	const baseDiagnostics = {
		cardSelector: selected.selector,
		cardSelectorCandidates: config.cardSelectors,
		cardCount: selected.roots.length,
		cardMatchedCount: selected.matchedCount,
		candidateCount: candidates.length,
		datedCandidateCount: candidates.filter(candidate => Boolean(candidate.dateHint)).length,
		typedCandidateCount,
		articleTypeCounts,
		...extraTextCounts,
	};

	return {
		candidates,
		diagnostics: config.buildDiagnostics?.({
			selected,
			candidates: parsedCandidates,
			baseDiagnostics,
			extraTextCounts,
		}) ?? baseDiagnostics,
	};
}
