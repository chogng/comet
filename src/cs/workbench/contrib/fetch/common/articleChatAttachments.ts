/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
} from 'cs/platform/agentHost/common/identities';
import {
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';

const maximumArticleIdLength = 2_048;
const maximumArticleMetadataBytes = 4 * 1024 * 1024;
const maximumArticleAuthors = 256;
const maximumArticleSubjects = 512;

type ProtocolRecord = Readonly<Record<string, AgentHostProtocolValue>>;

export interface ArticleAttachmentProducerState {
	readonly articleId: ArticleId;
}

export interface ArticleAttachmentAuthorRepresentation {
	readonly name: string;
	readonly url?: string;
	readonly isCorresponding?: boolean;
}

export interface ArticleAttachmentPublicationRepresentation {
	readonly title: string;
	readonly journalId?: string;
	readonly url?: string;
	readonly volume?: string;
	readonly issue?: string;
	readonly articleNumber?: string;
	readonly pageRange?: string;
	readonly year?: number;
}

export type ArticleAttachmentRepresentation = Readonly<{
	readonly articleId: ArticleId;
	readonly journalId: string;
	readonly url: string;
	readonly title: string;
	readonly subjects: readonly string[];
	readonly authors: readonly ArticleAttachmentAuthorRepresentation[];
	readonly publication: ArticleAttachmentPublicationRepresentation;
	readonly doi?: string;
	readonly description?: string;
	readonly editorsSummary?: string;
	readonly abstract?: string;
	readonly articleType?: string;
	readonly publishedAt?: string;
	readonly pdfUrl?: string;
	readonly citationUrl?: string;
	readonly isOpenAccess?: boolean;
}> & ProtocolRecord;

export const ArticleAttachmentProducerType = createAgentAttachmentProducerTypeId('article.document');
export const ArticleAttachmentRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.article.v1');
export const ArticleAttachmentRepresentationMediaType = 'application/vnd.comet.article+json';
export const ArticleAttachmentContentMediaType = 'text/plain';
export const ArticleAttachmentProducerStateVersion = 1;

function requireProtocolRecord(
	value: AgentHostProtocolValue,
	label: string,
): ProtocolRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a protocol record.`);
	}
	return value as ProtocolRecord;
}

function requireKeys(
	value: ProtocolRecord,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): void {
	for (const key of required) {
		if (!Object.hasOwn(value, key)) {
			throw new TypeError(`${label} is missing required property '${key}'.`);
		}
	}
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new TypeError(`${label} contains unsupported property '${key}'.`);
		}
	}
}

function requireBoundedString(
	value: AgentHostProtocolValue | undefined,
	label: string,
	maximumLength: number,
	allowEmpty = false,
): string {
	if (typeof value !== 'string'
		|| (!allowEmpty && value.length === 0)
		|| value.length > maximumLength) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
}

function requireBoundedArray(
	value: AgentHostProtocolValue | undefined,
	label: string,
	maximumLength: number,
): readonly AgentHostProtocolValue[] {
	if (!Array.isArray(value) || value.length > maximumLength) {
		throw new TypeError(`${label} must be an array with at most ${maximumLength} entries.`);
	}
	return value;
}

function optionalBoundedString(
	value: ProtocolRecord,
	name: string,
	label: string,
	maximumLength: number,
): string | undefined {
	return Object.hasOwn(value, name)
		? requireBoundedString(value[name], label, maximumLength, true)
		: undefined;
}

function assignOptional(
	target: Record<string, AgentHostProtocolValue>,
	name: string,
	value: AgentHostProtocolValue | undefined,
): void {
	if (value !== undefined) {
		target[name] = value;
	}
}

/** Parses the one current Article producer-state schema without accepting historical shapes. */
export function parseArticleAttachmentProducerState(
	value: AgentHostProtocolValue,
): ArticleAttachmentProducerState {
	const state = requireProtocolRecord(value, 'Article attachment state');
	requireKeys(state, ['articleId'], [], 'Article attachment state');
	return Object.freeze({
		articleId: requireBoundedString(
			state.articleId,
			'Article attachment state articleId',
			maximumArticleIdLength,
		) as ArticleId,
	});
}

/** Parses and deeply freezes the one canonical normalized Article representation. */
export function parseArticleAttachmentRepresentation(
	value: AgentHostProtocolValue,
): ArticleAttachmentRepresentation {
	const representation = requireProtocolRecord(value, 'Article attachment representation');
	requireKeys(representation, [
		'articleId',
		'journalId',
		'url',
		'title',
		'subjects',
		'authors',
		'publication',
	], [
		'doi',
		'description',
		'editorsSummary',
		'abstract',
		'articleType',
		'publishedAt',
		'pdfUrl',
		'citationUrl',
		'isOpenAccess',
	], 'Article attachment representation');

	const subjects = Object.freeze(requireBoundedArray(
		representation.subjects,
		'Article subjects',
		maximumArticleSubjects,
	).map((subject, index) => requireBoundedString(
		subject,
		`Article subject ${index}`,
		65_536,
	)));
	const authors = Object.freeze(requireBoundedArray(
		representation.authors,
		'Article authors',
		maximumArticleAuthors,
	).map((value, index): ArticleAttachmentAuthorRepresentation & ProtocolRecord => {
		const author = requireProtocolRecord(value, `Article author ${index}`);
		requireKeys(author, ['name'], ['url', 'isCorresponding'], `Article author ${index}`);
		const normalized: Record<string, AgentHostProtocolValue> = {
			name: requireBoundedString(author.name, `Article author ${index} name`, 65_536),
		};
		assignOptional(normalized, 'url', optionalBoundedString(
			author,
			'url',
			`Article author ${index} URL`,
			8_192,
		));
		if (Object.hasOwn(author, 'isCorresponding')) {
			if (typeof author.isCorresponding !== 'boolean') {
				throw new TypeError(`Article author ${index} isCorresponding must be boolean.`);
			}
			normalized.isCorresponding = author.isCorresponding;
		}
		return Object.freeze(normalized) as ArticleAttachmentAuthorRepresentation & ProtocolRecord;
	}));

	const publicationValue = requireProtocolRecord(
		representation.publication,
		'Article publication',
	);
	requireKeys(publicationValue, ['title'], [
		'journalId',
		'url',
		'volume',
		'issue',
		'articleNumber',
		'pageRange',
		'year',
	], 'Article publication');
	const publication: Record<string, AgentHostProtocolValue> = {
		title: requireBoundedString(publicationValue.title, 'Article publication title', 65_536),
	};
	for (const [name, maximumLength] of [
		['journalId', 512],
		['url', 8_192],
		['volume', 512],
		['issue', 512],
		['articleNumber', 512],
		['pageRange', 512],
	] as const) {
		assignOptional(publication, name, optionalBoundedString(
			publicationValue,
			name,
			`Article publication ${name}`,
			maximumLength,
		));
	}
	if (Object.hasOwn(publicationValue, 'year')) {
		if (typeof publicationValue.year !== 'number'
			|| !Number.isSafeInteger(publicationValue.year)
			|| publicationValue.year < 0
			|| publicationValue.year > 9999) {
			throw new TypeError('Article publication year must be a bounded integer.');
		}
		publication.year = publicationValue.year;
	}
	const normalizedPublication = Object.freeze(publication) as
		ArticleAttachmentPublicationRepresentation & ProtocolRecord;

	const normalized: Record<string, AgentHostProtocolValue> = {
		articleId: requireBoundedString(
			representation.articleId,
			'Article articleId',
			maximumArticleIdLength,
		),
		journalId: requireBoundedString(representation.journalId, 'Article journalId', 512),
		url: requireBoundedString(representation.url, 'Article URL', 8_192),
		title: requireBoundedString(representation.title, 'Article title', 65_536),
		subjects,
		authors: authors as readonly (ArticleAttachmentAuthorRepresentation & ProtocolRecord)[],
		publication: normalizedPublication,
	};
	for (const [name, maximumLength] of [
		['doi', 8_192],
		['description', maximumArticleMetadataBytes],
		['editorsSummary', maximumArticleMetadataBytes],
		['abstract', maximumArticleMetadataBytes],
		['articleType', 65_536],
		['publishedAt', 512],
		['pdfUrl', 8_192],
		['citationUrl', 8_192],
	] as const) {
		assignOptional(normalized, name, optionalBoundedString(
			representation,
			name,
			`Article ${name}`,
			maximumLength,
		));
	}
	if (Object.hasOwn(representation, 'isOpenAccess')) {
		if (typeof representation.isOpenAccess !== 'boolean') {
			throw new TypeError('Article isOpenAccess must be boolean.');
		}
		normalized.isOpenAccess = representation.isOpenAccess;
	}
	if (new TextEncoder().encode(encodeAgentHostProtocolValue(normalized)).byteLength
		> maximumArticleMetadataBytes) {
		throw new RangeError(`Article metadata cannot exceed ${maximumArticleMetadataBytes} bytes.`);
	}
	return Object.freeze(normalized) as ArticleAttachmentRepresentation;
}
