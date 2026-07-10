/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type FetchAccessGateReason =
	| 'cloudflareChallenge'
	| 'loginRequired'
	| 'institutionalSso'
	| 'subscriptionGate'
	| 'manualInteractionRequired';

export interface FetchArticleProof {
	readonly canonicalUriMatched: boolean;
	readonly titleFound: boolean;
	readonly authorsFound: boolean;
	readonly abstractFound: boolean;
	readonly bodyFound: boolean;
	readonly publicationFound: boolean;
	readonly articleKindFound: boolean;
	readonly accessGate: FetchAccessGateReason | null;
}
