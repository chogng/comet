/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';

export const natureJournals: readonly JournalDescriptor[] = [
	{
		id: 'journal.nature.news',
		title: 'Nature News',
		homeUrl: URI.parse('https://www.nature.com/'),
		discoveryUrl: URI.parse('https://www.nature.com/latest-news'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.opinion',
		title: 'Nature Opinion',
		homeUrl: URI.parse('https://www.nature.com/'),
		discoveryUrl: URI.parse('https://www.nature.com/opinion'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature',
		title: 'Nature',
		homeUrl: URI.parse('https://www.nature.com/nature/'),
		discoveryUrl: URI.parse('https://www.nature.com/nature/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-communications',
		title: 'Nature Communications',
		homeUrl: URI.parse('https://www.nature.com/ncomms/'),
		discoveryUrl: URI.parse('https://www.nature.com/ncomms/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-electronics',
		title: 'Nature Electronics',
		homeUrl: URI.parse('https://www.nature.com/natelectron/'),
		discoveryUrl: URI.parse('https://www.nature.com/natelectron/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-machine-intelligence',
		title: 'Nature Machine Intelligence',
		homeUrl: URI.parse('https://www.nature.com/natmachintell/'),
		discoveryUrl: URI.parse('https://www.nature.com/natmachintell/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-materials',
		title: 'Nature Materials',
		homeUrl: URI.parse('https://www.nature.com/nmat/'),
		discoveryUrl: URI.parse('https://www.nature.com/nmat/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-nanotechnology',
		title: 'Nature Nanotechnology',
		homeUrl: URI.parse('https://www.nature.com/nnano/'),
		discoveryUrl: URI.parse('https://www.nature.com/nnano/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-photonics',
		title: 'Nature Photonics',
		homeUrl: URI.parse('https://www.nature.com/nphoton/'),
		discoveryUrl: URI.parse('https://www.nature.com/nphoton/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-physics',
		title: 'Nature Physics',
		homeUrl: URI.parse('https://www.nature.com/nphys/'),
		discoveryUrl: URI.parse('https://www.nature.com/nphys/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.npj-2d-materials-and-applications',
		title: 'npj 2D Materials and Applications',
		homeUrl: URI.parse('https://www.nature.com/npj2dmateriacs/'),
		discoveryUrl: URI.parse('https://www.nature.com/npj2dmateriacs/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-synthesis',
		title: 'Nature Synthesis',
		homeUrl: URI.parse('https://www.nature.com/natsynth/'),
		discoveryUrl: URI.parse('https://www.nature.com/natsynth/research-articles'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-reviews-electrical-engineering',
		title: 'Nature Reviews Electrical Engineering',
		homeUrl: URI.parse('https://www.nature.com/natrevelectreng/'),
		discoveryUrl: URI.parse('https://www.nature.com/natrevelectreng/reviews-and-analysis'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-reviews-materials',
		title: 'Nature Reviews Materials',
		homeUrl: URI.parse('https://www.nature.com/natrevmats/'),
		discoveryUrl: URI.parse('https://www.nature.com/natrevmats/reviews-and-analysis'),
		providerId: 'publisher.nature',
	},
	{
		id: 'journal.nature.nature-reviews-physics',
		title: 'Nature Reviews Physics',
		homeUrl: URI.parse('https://www.nature.com/natrevphys/'),
		discoveryUrl: URI.parse('https://www.nature.com/natrevphys/reviews-and-analysis'),
		providerId: 'publisher.nature',
	},
];
