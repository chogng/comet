/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';

export const natureJournals: readonly JournalDescriptor[] = [
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
];
