/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i;

export function normalizeFetchDoi(value: unknown): string | undefined {
	const normalized = String(value ?? '')
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
		.replace(/^(?:urn:)?doi:\s*/i, '')
		.replace(/[\s.,;:]+$/g, '')
		.toLowerCase();
	return DOI_PATTERN.test(normalized) ? normalized : undefined;
}
