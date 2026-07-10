/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import { FetchErrorCode, fetchError } from 'cs/workbench/services/fetch/common/fetchErrors';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

export function resolveFetchSite(
	providers: readonly FetchSiteProvider[],
	uri: URI,
): FetchSiteProvider {
	const matched = providers.filter(provider => provider.matchUri(uri));
	if (matched.length === 0) {
		throw fetchError(FetchErrorCode.UnsupportedSite, { uri: uri.toString(true) });
	}
	if (matched.length > 1) {
		throw fetchError(FetchErrorCode.AmbiguousSite, {
			uri: uri.toString(true),
			siteIds: matched.map(provider => provider.id),
		});
	}
	return matched[0];
}
