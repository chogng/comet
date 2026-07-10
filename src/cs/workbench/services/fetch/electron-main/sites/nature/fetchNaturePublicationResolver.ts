/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchArticlePublication } from 'cs/base/parts/sandbox/common/fetchPublication';

const springerNaturePublisher = {
	id: 'springerNature',
	title: 'Springer Nature',
} as const;

export const naturePublication: FetchArticlePublication = {
	id: 'nature',
	title: 'Nature',
	publisherId: springerNaturePublisher.id,
	publisherTitle: springerNaturePublisher.title,
};

const publicationByPrefix: Readonly<Record<string, FetchArticlePublication>> = {
	s41586: naturePublication,
	s41563: {
		id: 'natureMaterials',
		title: 'Nature Materials',
		publisherId: springerNaturePublisher.id,
		publisherTitle: springerNaturePublisher.title,
	},
	s41467: {
		id: 'natureCommunications',
		title: 'Nature Communications',
		publisherId: springerNaturePublisher.id,
		publisherTitle: springerNaturePublisher.title,
	},
	s41596: {
		id: 'natureProtocols',
		title: 'Nature Protocols',
		publisherId: springerNaturePublisher.id,
		publisherTitle: springerNaturePublisher.title,
	},
};

function toPublicationId(title: string): string {
	const words = title.match(/[a-z0-9]+/gi) ?? [];
	return words
		.map((word, index) => index === 0
			? word.toLowerCase()
			: `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`)
		.join('');
}

export function createNaturePublication(title: string): FetchArticlePublication {
	return {
		id: toPublicationId(title),
		title,
		publisherId: springerNaturePublisher.id,
		publisherTitle: springerNaturePublisher.title,
	};
}

export function resolveNaturePublicationHint(
	articleId: string,
): FetchArticlePublication | undefined {
	return publicationByPrefix[articleId.slice(0, 6).toLowerCase()];
}
