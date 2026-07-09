/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	configurationRegistry,
	ConfigurationScope,
} from 'cs/platform/configuration/common/configurationRegistry';
import { localize } from 'cs/nls';
import {
	BROWSER_SEARCH_ENGINES,
	BROWSER_SEARCH_NONE,
	BrowserSearchEngineId,
	BrowserSearchEngineSettingId,
} from 'cs/workbench/contrib/browserView/common/browserSearch';

configurationRegistry.registerConfigurationProperties({
	[BrowserSearchEngineSettingId]: {
		type: 'string',
		enum: [
			BROWSER_SEARCH_NONE,
			...BROWSER_SEARCH_ENGINES.map(engine => engine.id),
		],
		enumItemLabels: [
			localize('browser.search.engine.none', "None"),
			...BROWSER_SEARCH_ENGINES.map(engine => engine.label),
		],
		default: BrowserSearchEngineId.Bing,
		markdownDescription: localize(
			'browser.searchEngine',
			"Controls the search engine used to search the web from the address bar of the integrated browser. Select 'None' to disable search.",
		),
		scope: ConfigurationScope.APPLICATION,
	},
});
