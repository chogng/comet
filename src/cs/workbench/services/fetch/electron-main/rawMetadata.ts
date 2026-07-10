/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { load } from 'cheerio';

export type StructuredDataRecord = Record<string, unknown>;

function collectStructuredDataItems(input: unknown, target: StructuredDataRecord[]): void {
	if (!input || typeof input !== 'object') return;
	if (Array.isArray(input)) {
		for (const entry of input) collectStructuredDataItems(entry, target);
		return;
	}
	const record = input as StructuredDataRecord;
	target.push(record);
	if (Array.isArray(record['@graph'])) {
		for (const entry of record['@graph']) collectStructuredDataItems(entry, target);
	}
}

export function extractStructuredDataItems($: ReturnType<typeof load>): StructuredDataRecord[] {
	const items: StructuredDataRecord[] = [];
	$('script[type="application/ld+json"]').each((_, node) => {
		const raw = $(node).html();
		if (!raw) return;
		try {
			collectStructuredDataItems(JSON.parse(raw), items);
		} catch {
			return;
		}
	});
	return items;
}
