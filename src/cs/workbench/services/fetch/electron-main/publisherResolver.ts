/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ArticlePublisherId,
	PublisherAccessRisk,
} from 'cs/base/parts/sandbox/common/sandboxTypes';

export interface PublisherProfile {
	readonly id: ArticlePublisherId;
	readonly accessRisk: PublisherAccessRisk;
	readonly backgroundSettleMs: number;
}

const PUBLISHER_PROFILES: Record<ArticlePublisherId, PublisherProfile> = {
	nature: {
		id: 'nature',
		accessRisk: 'standard',
		backgroundSettleMs: 350,
	},
	science: {
		id: 'science',
		accessRisk: 'elevated',
		backgroundSettleMs: 900,
	},
	acs: {
		id: 'acs',
		accessRisk: 'elevated',
		backgroundSettleMs: 700,
	},
	wiley: {
		id: 'wiley',
		accessRisk: 'elevated',
		backgroundSettleMs: 700,
	},
	other: {
		id: 'other',
		accessRisk: 'standard',
		backgroundSettleMs: 350,
	},
};

function matchesHost(hostname: string, domain: string) {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function resolvePublisherProfile(value: string): PublisherProfile {
	let hostname = '';
	try {
		hostname = new URL(value).hostname.toLowerCase();
	} catch {
		return PUBLISHER_PROFILES.other;
	}

	if (matchesHost(hostname, 'nature.com')) {
		return PUBLISHER_PROFILES.nature;
	}
	if (matchesHost(hostname, 'science.org') || matchesHost(hostname, 'sciencemag.org')) {
		return PUBLISHER_PROFILES.science;
	}
	if (matchesHost(hostname, 'acs.org')) {
		return PUBLISHER_PROFILES.acs;
	}
	if (matchesHost(hostname, 'wiley.com')) {
		return PUBLISHER_PROFILES.wiley;
	}

	return PUBLISHER_PROFILES.other;
}
