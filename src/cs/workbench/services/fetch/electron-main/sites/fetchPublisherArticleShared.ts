/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateString } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { cleanText, uniq } from 'cs/base/common/strings';
import type { FetchArticleKind } from 'cs/base/parts/sandbox/common/fetchArticleKind';
import type { FetchArticlePublication } from 'cs/base/parts/sandbox/common/fetchPublication';
import type { FetchArticleSection } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchDoiEvidence } from 'cs/workbench/services/fetch/electron-main/fetchDoiResolver';
import { resolveFetchDoi } from 'cs/workbench/services/fetch/electron-main/fetchDoiResolver';
import { extractStructuredDataItems } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
import type { StructuredDataRecord } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
import { extractArticleContentText } from 'cs/workbench/services/fetch/electron-main/sites/fetchArticleContentText';
import type {
	FetchArticleDetailParserContext,
	FetchArticleDraft,
	FetchPageDom,
} from 'cs/workbench/services/fetch/electron-main/sites/types';

export interface FetchPublisherArticleParserConfig {
	readonly publisherId: string;
	readonly publisherTitle: string;
	readonly titleSelector: string;
	readonly bodySelector: string;
	readonly sectionSelector: string;
}

function getStructuredArticleRecords(
	context: FetchArticleDetailParserContext,
): StructuredDataRecord[] {
	return extractStructuredDataItems(context.$).filter(item => {
		const rawType = item['@type'];
		const types = Array.isArray(rawType) ? rawType : [rawType];
		return types.some(type => /^(?:scholarly|news)?article$/i.test(cleanText(type)));
	});
}

function collectStructuredText(value: unknown, target: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectStructuredText(item, target);
		return;
	}
	if (typeof value === 'string') {
		const text = cleanText(value);
		if (text) target.push(text);
		return;
	}
	if (value && typeof value === 'object') {
		const record = value as StructuredDataRecord;
		for (const candidate of [record.name, record.value, record['@value']]) {
			if (typeof candidate === 'string') {
				const text = cleanText(candidate);
				if (text) target.push(text);
			}
		}
	}
}

function readStructuredText(
	records: readonly StructuredDataRecord[],
	fields: readonly string[],
): string | undefined {
	for (const record of records) {
		for (const field of fields) {
			const values: string[] = [];
			collectStructuredText(record[field], values);
			if (values[0]) return values[0];
		}
	}
	return undefined;
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

function toPublicationId(title: string): string {
	const words = title.match(/[a-z0-9]+/gi) ?? [];
	return words
		.map((word, index) => index === 0
			? word.toLowerCase()
			: `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`)
		.join('');
}

function readPublication(
	context: FetchArticleDetailParserContext,
	config: FetchPublisherArticleParserConfig,
	structuredArticles: readonly StructuredDataRecord[],
): FetchArticlePublication | undefined {
	const title = readMeta(context, [
		'citation_journal_title',
		'prism.publicationName',
		'dc.source',
	]) ?? readStructuredText(structuredArticles, ['isPartOf']);
	return title ? {
		id: toPublicationId(title),
		title,
		publisherId: config.publisherId,
		publisherTitle: config.publisherTitle,
	} : undefined;
}

function classifyArticle(sourceArticleType: string | undefined): FetchArticleKind {
	const value = sourceArticleType?.trim() ?? '';
	if (/^(?:article|research|research article|original article|research report|report)$/i.test(value)) return 'researchArticle';
	if (/\breview\b/i.test(value)) return 'reviewArticle';
	if (/^(?:news|research highlight)$/i.test(value)) return 'news';
	if (/\bfeature\b/i.test(value)) return 'feature';
	if (/^editorial$/i.test(value)) return 'editorial';
	if (/^(?:opinion|world view)$/i.test(value)) return 'opinion';
	if (/^(?:comment|commentary)$/i.test(value)) return 'commentary';
	if (/^perspective$/i.test(value)) return 'perspective';
	if (/\bprotocol\b/i.test(value)) return 'protocol';
	if (/^(?:correction|erratum)$/i.test(value)) return 'correction';
	return 'other';
}

function readCanonicalUri(context: FetchArticleDetailParserContext): URI | undefined {
	const value = cleanText(context.$('link[rel="canonical"]').first().attr('href'));
	if (!value) return undefined;
	try {
		return URI.parse(new URL(value, context.finalUri.toString(true)).toString());
	} catch {
		return undefined;
	}
}

function collectDoiEvidence(
	context: FetchArticleDetailParserContext,
	structuredArticles: readonly StructuredDataRecord[],
): FetchDoiEvidence[] {
	const evidence: FetchDoiEvidence[] = [];
	for (const [name, source] of [
		['citation_doi', 'citationDoi'],
		['dc.identifier', 'dcIdentifier'],
		['prism.doi', 'prismDoi'],
	] as const) {
		context.$(`meta[name="${name}"]`).each((_, node) => {
			const value = cleanText(context.$(node).attr('content'));
			if (value) evidence.push({ source, value, strength: 'strong' });
		});
	}
	for (const item of structuredArticles) {
		const values: string[] = [];
		collectStructuredText(item.identifier, values);
		for (const value of values) {
			evidence.push({ source: 'jsonLdIdentifier', value, strength: 'strong' });
		}
	}
	const pathValue = decodeURIComponent(context.sourceUri.path).match(
		/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i,
	)?.[0];
	if (pathValue) {
		evidence.push({ source: 'siteArticleUrl', value: pathValue, strength: 'siteArticleUrl' });
	}
	return evidence;
}

function readAbstract(
	context: FetchArticleDetailParserContext,
	structuredArticles: readonly StructuredDataRecord[],
): string | undefined {
	const meta = readMeta(context, [
		'citation_abstract',
		'dc.description.abstract',
		'prism.abstract',
	]);
	if (meta) return meta;
	const dom = cleanText(context.$([
		'[itemprop="abstract"]',
		'section[aria-labelledby*="abs" i]',
		'div.abstract',
		'p.abstract',
		'[data-test="article-abstract"]',
	].join(', ')).first().text());
	if (dom) return dom;
	return readStructuredText(structuredArticles, ['abstract']);
}

function collectStructuredAuthorNames(value: unknown, target: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectStructuredAuthorNames(item, target);
		return;
	}
	if (typeof value === 'string') {
		const name = cleanText(value);
		if (name) target.push(name);
		return;
	}
	if (value && typeof value === 'object') {
		const record = value as StructuredDataRecord;
		const directName = cleanText(record.name);
		const composedName = cleanText([
			cleanText(record.givenName),
			cleanText(record.additionalName),
			cleanText(record.familyName),
		].filter(Boolean).join(' '));
		const name = directName || composedName;
		if (name) target.push(name);
	}
}

function readAuthors(
	context: FetchArticleDetailParserContext,
	structuredArticles: readonly StructuredDataRecord[],
) {
	const metaAuthors = context.$([
		'meta[name="citation_author"]',
		'meta[name="citation_authors"]',
		'meta[name="dc.creator"]',
		'meta[name="dc.contributor"]',
		'meta[name="author"]',
	].join(', ')).map((_, node) => cleanText(context.$(node).attr('content')))
		.get()
		.filter(Boolean);
	if (metaAuthors.length > 0) {
		return uniq(metaAuthors).map(name => ({ name }));
	}
	const structuredAuthors: string[] = [];
	for (const item of structuredArticles) {
		collectStructuredAuthorNames(item.author, structuredAuthors);
		collectStructuredAuthorNames(item.creator, structuredAuthors);
	}
	return uniq(structuredAuthors).map(name => ({ name }));
}

function readPublishedAt(
	context: FetchArticleDetailParserContext,
	structuredArticles: readonly StructuredDataRecord[],
): string | undefined {
	for (const name of [
		'citation_publication_date',
		'citation_online_date',
		'citation_date',
		'dc.date',
		'dc.date.issued',
		'prism.publicationDate',
	]) {
		const parsed = parseDateString(context.$(`meta[name="${name}"]`).first().attr('content'));
		if (parsed) return parsed;
	}
	for (const value of [
		context.$('time[datetime]').first().attr('datetime'),
		context.$('[itemprop="datePublished"]').first().attr('datetime'),
		context.$('[itemprop="datePublished"]').first().attr('content'),
	]) {
		const parsed = parseDateString(value);
		if (parsed) return parsed;
	}
	for (const item of structuredArticles) {
		for (const field of ['datePublished', 'dateCreated', 'dateIssued']) {
			const parsed = parseDateString(item[field]);
			if (parsed) return parsed;
		}
	}
	return undefined;
}

function readSections(
	context: FetchArticleDetailParserContext,
	config: FetchPublisherArticleParserConfig,
): FetchArticleSection[] {
	const bodyNodes = context.$(config.bodySelector).toArray();
	const outerBodyNodes = bodyNodes.filter(bodyNode => !bodyNodes.some(other => (
		other !== bodyNode && new Set<unknown>(context.$(bodyNode).parents().toArray()).has(other)
	)));
	const getDirectSectionNodes = (node: Parameters<FetchPageDom>[0]) => {
		const descendants = context.$(node).find(config.sectionSelector).toArray();
		return descendants.filter(descendant => !descendants.some(other => (
			other !== descendant && context.$(descendant).parents().toArray().includes(other)
		)));
	};
	const readOwnContent = (node: Parameters<FetchPageDom>[0]) => {
		const clone = context.$(node).clone();
		clone.find(config.sectionSelector).remove();
		const cloneNode = clone.get(0);
		return cloneNode ? extractArticleContentText(context.$, cloneNode) : '';
	};
	const buildSection = (node: Parameters<FetchPageDom>[0]): FetchArticleSection => {
		const root = context.$(node);
		const headingRoot = root.clone();
		headingRoot.find(config.sectionSelector).remove();
		const children = getDirectSectionNodes(node)
			.map(child => buildSection(child))
			.filter(child => Boolean(child.content || child.children?.length));
		return {
			id: cleanText(root.attr('id')) || undefined,
			title: cleanText(headingRoot.find('h2, h3').first().text()) || undefined,
			content: readOwnContent(node),
			...(children.length > 0 ? { children } : {}),
		};
	};
	return outerBodyNodes.flatMap(bodyNode => {
		if (context.$(bodyNode).is(config.sectionSelector)) {
			return [buildSection(bodyNode)];
		}
		const sections: FetchArticleSection[] = [];
		const preamble = readOwnContent(bodyNode);
		if (preamble) sections.push({ content: preamble });
		sections.push(...getDirectSectionNodes(bodyNode).map(node => buildSection(node)));
		return sections;
	}).filter(section => Boolean(section.content || section.children?.length));
}

export function parsePublisherArticle(
	context: FetchArticleDetailParserContext,
	config: FetchPublisherArticleParserConfig,
): FetchArticleDraft {
	const structuredArticles = getStructuredArticleRecords(context);
	const publication = readPublication(context, config, structuredArticles);
	const sourceArticleType = readMeta(context, [
		'citation_article_type',
		'prism.genre',
		'dc.type',
	]) ?? readStructuredText(structuredArticles, ['articleSection', 'genre', 'additionalType']);
	const articleKind = classifyArticle(sourceArticleType);
	const sections = readSections(context, config);
	const doiResolution = resolveFetchDoi(collectDoiEvidence(context, structuredArticles));
	const authors = readAuthors(context, structuredArticles);
	return {
		sourceUri: context.sourceUri,
		canonicalUri: readCanonicalUri(context),
		doi: doiResolution.doi,
		doiSource: doiResolution.source,
		title: readMeta(context, ['citation_title', 'dc.title']) ?? (
			cleanText(context.$(config.titleSelector).first().text()) || undefined
		) ?? readStructuredText(structuredArticles, ['headline', 'name']),
		publication,
		articleKind,
		sourceArticleType,
		authors,
		abstract: readAbstract(context, structuredArticles),
		sections,
		figures: [],
		references: [],
		publishedAt: readPublishedAt(context, structuredArticles),
		classificationEvidence: sourceArticleType
			? [`sourceArticleType:${sourceArticleType}`, `articleKind:${articleKind}`]
			: [`articleKind:${articleKind}`],
	};
}
