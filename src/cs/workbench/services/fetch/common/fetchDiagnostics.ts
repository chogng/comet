/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FetchStructureEvidence {
	readonly kind: string;
	readonly selector?: string;
	readonly value?: string;
}

export interface FetchArticleListDiagnostics {
	readonly siteId: string;
	readonly sourceId: string;
	readonly parserId: string;
	readonly parserEvidence: readonly FetchStructureEvidence[];
	readonly details?: Readonly<Record<string, unknown>>;
}

export interface FetchArticleDetailDiagnostics {
	readonly siteId: string;
	readonly parserId: string;
	readonly parserEvidence: readonly FetchStructureEvidence[];
	readonly doiSource?: string;
	readonly classificationEvidence: readonly string[];
	readonly details?: Readonly<Record<string, unknown>>;
}
