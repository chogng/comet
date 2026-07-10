/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateString } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { cleanText, uniq } from 'cs/base/common/strings';
import type {
	FetchArticleAuthor,
	FetchArticleFigure,
	FetchArticleReference,
	FetchArticleSection,
} from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchDoiEvidence } from 'cs/workbench/services/fetch/electron-main/fetchDoiResolver';
import { resolveFetchDoi } from 'cs/workbench/services/fetch/electron-main/fetchDoiResolver';
import { FetchErrorCode, fetchError } from 'cs/workbench/services/fetch/common/fetchErrors';
import { extractStructuredDataItems } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
import { extractArticleContentText } from 'cs/workbench/services/fetch/electron-main/sites/fetchArticleContentText';
import { classifyNatureArticle } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureArticleClassification';
import type { FetchNatureArticleIdentity } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureArticleIdentity';
import { createNaturePublication, naturePublication } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNaturePublicationResolver';
import type {
	FetchArticleDetailParserContext,
	FetchArticleDraft,
	FetchPageDom,
} from 'cs/workbench/services/fetch/electron-main/sites/types';

export const natureJournalContentSelector = '.c-article-body .c-article-section__content[id^="Sec"]';

export function getNatureJournalContentNodes(
	context: FetchArticleDetailParserContext,
): Parameters<FetchPageDom>[0][] {
	return context.$(natureJournalContentSelector).toArray().filter(node => {
		const descriptor = context.$(node).parents('[data-title], [data-test]').toArray()
			.map(ancestor => `${cleanText(context.$(ancestor).attr('data-title'))} ${cleanText(context.$(ancestor).attr('data-test'))}`)
			.join(' ')
			.toLowerCase();
		return !descriptor.includes('supplementary');
	});
}

function readMeta(context: FetchArticleDetailParserContext, names: readonly string[]): string | undefined {
	for (const name of names) {
		const value = cleanText(context.$(`meta[name="${name}"]`).first().attr('content'));
		if (value) {
			return value;
		}
	}
	return undefined;
}

function readCanonicalUri(context: FetchArticleDetailParserContext): URI | undefined {
	const value = cleanText(context.$('link[rel="canonical"]').first().attr('href'));
	if (!value) {
		return undefined;
	}
	try {
		return URI.parse(new URL(value, context.finalUri.toString(true)).toString());
	} catch {
		return undefined;
	}
}

function collectDoiEvidence(
	context: FetchArticleDetailParserContext,
	identity: FetchNatureArticleIdentity | undefined,
): FetchDoiEvidence[] {
	const evidence: FetchDoiEvidence[] = [];
	for (const [name, source] of [
		['citation_doi', 'citationDoi'],
		['dc.identifier', 'dcIdentifier'],
		['DC.Identifier', 'dcIdentifier'],
	] as const) {
		context.$(`meta[name="${name}"]`).each((_, node) => {
			const value = cleanText(context.$(node).attr('content'));
			if (value) {
				evidence.push({ source, value, strength: 'strong' });
			}
		});
	}
	for (const item of extractStructuredDataItems(context.$)) {
		const rawType = item['@type'];
		const types = Array.isArray(rawType) ? rawType : [rawType];
		if (!types.some(type => /^(?:scholarly|news)?article$/i.test(cleanText(type)))) {
			continue;
		}
		const values = Array.isArray(item.identifier) ? item.identifier : [item.identifier];
		for (const value of values) {
			if (typeof value === 'string') {
				evidence.push({ source: 'jsonLdIdentifier', value, strength: 'strong' });
				continue;
			}
			if (value && typeof value === 'object') {
				const record = value as Record<string, unknown>;
				const identifier = cleanText(record.value ?? record['@value'] ?? record.name);
				if (identifier) {
					evidence.push({ source: 'jsonLdIdentifier', value: identifier, strength: 'strong' });
				}
			}
		}
	}
	context.$([
		'[data-test="article-citation"] a[href^="https://doi.org/10."]',
		'.c-article-info-details a[href^="https://doi.org/10."]',
		'#article-info-content a[href^="https://doi.org/10."]',
	].join(', ')).each((_, node) => {
		const value = cleanText(context.$(node).attr('href'));
		if (value) {
			evidence.push({ source: 'doiLink', value, strength: 'strong' });
		}
	});
	if (identity?.doiHint) {
		evidence.push({
			source: 'siteArticleUrl',
			value: identity.doiHint,
			strength: 'siteArticleUrl',
		});
	}
	return evidence;
}

function readNaturePublication(
	context: FetchArticleDetailParserContext,
	identity: FetchNatureArticleIdentity | undefined,
) {
	const title = readMeta(context, [
		'citation_journal_title',
		'prism.publicationName',
		'dc.source',
	]);
	if (title) {
		const publication = createNaturePublication(title);
		if (
			identity?.publicationHint &&
			identity.publicationHint.title.toLowerCase() !== publication.title.toLowerCase()
		) {
			throw fetchError(FetchErrorCode.MetadataConflict, {
				field: 'publication',
				articleId: identity.articleId,
				urlHint: identity.publicationHint,
				pageMetadata: publication,
			});
		}
		return publication;
	}
	return identity?.publicationHint ?? (
		identity?.pageFamilyHint === 'editorialArticle' ? naturePublication : undefined
	);
}

function readAuthors(context: FetchArticleDetailParserContext): FetchArticleAuthor[] {
	const metaAuthors = context.$('meta[name="citation_author"]')
		.map((_, node) => cleanText(context.$(node).attr('content')))
		.get()
		.filter(Boolean);
	const names = metaAuthors.length > 0
		? metaAuthors
		: context.$('.c-article-header [data-test="author-name"]')
			.map((_, node) => cleanText(context.$(node).text()))
			.get()
			.filter(Boolean);
	return uniq(names).map(name => ({ name }));
}

function readSections(
	context: FetchArticleDetailParserContext,
	pageFamily: 'journalArticle' | 'editorialArticle',
): FetchArticleSection[] {
	if (pageFamily === 'journalArticle') {
		const sections: FetchArticleSection[] = [];
		for (const node of getNatureJournalContentNodes(context)) {
			const contentRoot = context.$(node);
			const sectionRoot = contentRoot.closest('.c-article-section');
			const id = cleanText(contentRoot.attr('id')) || undefined;
			const title = cleanText(sectionRoot.find('h2, h3').first().text()) || undefined;
			const contentClone = contentRoot.clone();
			contentClone.find('figure, [id^="figure-"]').remove();
			const clonedNode = contentClone.get(0);
			const content = clonedNode ? extractArticleContentText(context.$, clonedNode) : '';
			if (content) {
				sections.push({ id, title, content });
			}
		}
		return sections;
	}
	const bodyRoot = context.$('.c-article-body.main-content').first().clone();
	bodyRoot.find([
		'.c-article-references',
		'.c-article-section[id^="Bib"]',
		'[id^="Bib"]',
		'figure',
		'[id^="figure-"]',
	].join(', ')).remove();
	const bodyNode = bodyRoot.get(0);
	const content = bodyNode ? extractArticleContentText(context.$, bodyNode) : '';
	if (content) {
		return [{ content }];
	}
	return [];
}

function readAbstract(context: FetchArticleDetailParserContext): string | undefined {
	const dom = cleanText(
		context.$('#Abs1-content, [data-test="article-abstract"], [itemprop="abstract"]').first().text(),
	) || readMeta(context, ['citation_abstract', 'dc.description.abstract']);
	if (dom) return dom;
	for (const item of extractStructuredDataItems(context.$)) {
		const rawType = item['@type'];
		const types = Array.isArray(rawType) ? rawType : [rawType];
		if (
			types.some(type => /^(?:scholarly|news)?article$/i.test(cleanText(type))) &&
			typeof item.abstract === 'string'
		) {
			const value = cleanText(item.abstract);
			if (value) return value;
		}
	}
	return undefined;
}

function readFigures(context: FetchArticleDetailParserContext): FetchArticleFigure[] {
	return context.$('[id^="figure-"]')
		.map((_, node) => {
			const root = context.$(node);
			const imageSource = cleanText(root.find('img').first().attr('src'));
			const fullSizeHref = cleanText(
				root.find('a[href*="/figures/"], a[aria-label*="Full size image" i]').first().attr('href'),
			);
			const resolveUrl = (value: string) => value
				? new URL(value, context.finalUri.toString(true)).toString()
				: undefined;
			return {
				id: cleanText(root.attr('id')) || undefined,
				title: cleanText(root.find('[data-test="figure-caption-text"], figcaption').first().text()) || undefined,
				caption: cleanText(root.find('[data-test="bottom-caption"]').first().text()) || undefined,
				imageUrl: resolveUrl(imageSource),
				fullSizeUrl: resolveUrl(fullSizeHref),
			};
		})
		.get()
		.filter(figure => Boolean(
			figure.title || figure.caption || figure.imageUrl || figure.fullSizeUrl,
		));
}

function readReferences(context: FetchArticleDetailParserContext): FetchArticleReference[] {
	return context.$('#Bib1-content .c-article-references__text')
		.map((index, node) => ({
			id: cleanText(context.$(node).closest('[id]').attr('id')) || String(index + 1),
			text: cleanText(context.$(node).text()),
		}))
		.get()
		.filter(reference => Boolean(reference.text));
}

function readDate(context: FetchArticleDetailParserContext, names: readonly string[]): string | undefined {
	for (const name of names) {
		const parsed = parseDateString(context.$(`meta[name="${name}"]`).first().attr('content'));
		if (parsed) {
			return parsed;
		}
	}
	return undefined;
}

function readPublishedDate(context: FetchArticleDetailParserContext): string | undefined {
	return readDate(context, [
		'citation_publication_date',
		'citation_online_date',
		'prism.publicationDate',
	]) ?? parseDateString(
		context.$('.c-article-header time[datetime]').first().attr('datetime'),
	) ?? undefined;
}

export function parseNatureArticle(
	context: FetchArticleDetailParserContext,
	pageFamily: 'journalArticle' | 'editorialArticle',
): FetchArticleDraft {
	const identity = context.identity as FetchNatureArticleIdentity | undefined;
	const publication = readNaturePublication(context, identity);
	const sourceArticleType = readMeta(context, [
		'citation_article_type',
		'prism.genre',
		'dc.type',
	]) ?? (
		cleanText(
			context.$('[data-test="article-category"], [data-test="article-type"]').first().text(),
		) || undefined
	);
	const classification = publication
		? classifyNatureArticle(publication, sourceArticleType, pageFamily)
		: undefined;
	const doiResolution = resolveFetchDoi(collectDoiEvidence(context, identity));
	return {
		sourceUri: context.sourceUri,
		canonicalUri: readCanonicalUri(context),
		publisherArticleId: identity?.articleId,
		doi: doiResolution.doi,
		doiSource: doiResolution.source,
		title: readMeta(context, ['citation_title', 'dc.title']) ?? (
			cleanText(
				context.$('.c-article-header h1, [data-test="article-title"]').first().text(),
			) || undefined
		),
		publication: classification?.publication,
		articleKind: classification?.articleKind,
		sourceArticleType: classification?.sourceArticleType,
		authors: readAuthors(context),
		abstract: readAbstract(context),
		sections: readSections(context, pageFamily),
		figures: readFigures(context),
		references: readReferences(context),
		publishedAt: readPublishedDate(context),
		receivedAt: readDate(context, ['citation_received_date']),
		acceptedAt: readDate(context, ['citation_accepted_date']),
		classificationEvidence: classification?.evidence ?? [],
	};
}
