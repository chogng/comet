/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';

export interface FetchParseContext {
	readonly uri: URI;
	readonly document: Document;
}

export interface FetchParserDescriptor<TParser> {
	readonly id: string;
	readonly matches: (context: FetchParseContext) => boolean;
	readonly parser: TParser;
}

export class FetchParserNotFoundError extends Error {
	constructor(uri: URI) {
		super(`No Fetch parser matches "${uri.toString(true)}".`);
		this.name = 'FetchParserNotFoundError';
	}
}

export class FetchParserAmbiguityError extends Error {
	constructor(uri: URI, parserIds: readonly string[]) {
		super(`Multiple Fetch parsers match "${uri.toString(true)}": ${parserIds.join(', ')}.`);
		this.name = 'FetchParserAmbiguityError';
	}
}

export function resolveFetchParser<TParser>(descriptors: readonly FetchParserDescriptor<TParser>[], context: FetchParseContext): TParser {
	const matches = descriptors.filter(descriptor => descriptor.matches(context));
	if (matches.length === 0) {
		throw new FetchParserNotFoundError(context.uri);
	}
	if (matches.length > 1) {
		throw new FetchParserAmbiguityError(context.uri, matches.map(descriptor => descriptor.id));
	}
	return matches[0].parser;
}
