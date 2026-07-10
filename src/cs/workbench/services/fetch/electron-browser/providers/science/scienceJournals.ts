/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';

export const scienceJournals: readonly JournalDescriptor[] = [
	{
		id: 'journal.science.science',
		title: 'Science',
		homeUrl: URI.parse('https://www.science.org/journal/science'),
		discoveryUrl: URI.parse('https://www.science.org/journal/science'),
		providerId: 'publisher.science',
	},
	{
		id: 'journal.science.science-advances',
		title: 'Science Advances',
		homeUrl: URI.parse('https://www.science.org/journal/sciadv'),
		discoveryUrl: URI.parse('https://www.science.org/journal/sciadv'),
		providerId: 'publisher.science',
	},
];
