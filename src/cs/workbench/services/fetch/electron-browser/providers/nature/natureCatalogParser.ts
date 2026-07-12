/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type {
	ParsedArticleListSource,
	ParsedArticleListSourceGroup,
} from 'cs/workbench/services/fetch/common/fetchProvider';

function text(element: Element | null): string | undefined {
	const value = element?.textContent?.replace(/\s+/gu, ' ').trim();
	return value || undefined;
}

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

function articleTypeLabel(anchor: Element): string | undefined {
	return text(anchor)?.replace(/\s+\([\d,]+\)$/u, '').trim() || undefined;
}

export function parseNatureExploreGroups(
	document: Document,
	base: URI,
): readonly { readonly label: string; readonly url: URI }[] {
	const links = [...document.querySelectorAll(
		'nav[data-test="Explore-content"] a[data-test="explore-nav-item"][href]',
	)].map(anchor => ({
		label: text(anchor),
		url: uriFromHref(anchor.getAttribute('href'), base),
	})).filter((entry): entry is { label: string; url: URI } => !!entry.label && !!entry.url);
	if (links.length === 0) {
		throw new Error(`Nature source discovery for "${base.toString(true)}" does not contain Explore content links.`);
	}

	const seen = new Set<string>();
	return links.filter(link => {
		const key = link.url.toString(true);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

export function isNatureArticleTypeCatalog(document: Document): boolean {
	const catalogs = document.querySelectorAll('nav#Article-Type-target');
	return catalogs.length === 1
		&& !!catalogs[0].querySelector('a[href*="type="]');
}

export function parseNatureArticleTypeCatalog(
	document: Document,
	base: URI,
	groupLabel: string,
): ParsedArticleListSourceGroup {
	const normalizedGroupLabel = groupLabel.trim();
	if (!normalizedGroupLabel) {
		throw new Error(`Nature Article Type discovery for "${base.toString(true)}" requires an Explore content label.`);
	}
	const catalogs = document.querySelectorAll('nav#Article-Type-target');
	if (catalogs.length !== 1) {
		throw new Error(`Nature Explore content "${base.toString(true)}" does not contain exactly one Article Type catalog.`);
	}
	const sources = [...catalogs[0].querySelectorAll('a[href]')].map(anchor => ({
		label: articleTypeLabel(anchor),
		url: uriFromHref(anchor.getAttribute('href'), base),
	})).filter((entry): entry is { label: string; url: URI } =>
		!!entry.label
		&& !!entry.url
		&& new URL(entry.url.toString(true)).searchParams.has('type')
	);
	if (sources.length === 0) {
		throw new Error(`Nature Explore content "${base.toString(true)}" does not contain Article Type sources.`);
	}

	const seen = new Set<string>();
	const uniqueSources = sources.filter(source => {
		const key = source.url.toString(true);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return {
		kind: 'group',
		label: normalizedGroupLabel,
		sources: uniqueSources.map(source => ({ kind: 'source', ...source })),
	};
}

export function parseNatureDirectListSource(
	document: Document,
	base: URI,
): ParsedArticleListSource {
	const label = text(document.querySelector('[role="main"] h1'));
	if (!label) {
		throw new Error(`Nature article list "${base.toString(true)}" does not contain a title.`);
	}
	return { kind: 'source', label, url: base };
}
