/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	configurationRegistry,
	ConfigurationScope,
} from 'cs/platform/configuration/common/configurationRegistry';
import { localize } from 'cs/nls';
import { BrowserRemoteProxyEnabledSettingId } from 'cs/workbench/contrib/browserView/electron-browser/browserViewWorkbenchService';

configurationRegistry.registerConfigurationProperties({
	[BrowserRemoteProxyEnabledSettingId]: {
		type: 'boolean',
		default: true,
		tags: ['experimental'],
		scope: ConfigurationScope.WINDOW,
		experiment: { mode: 'startup' },
		markdownDescription: localize('browser.enableRemoteProxy', "When enabled, browser requests in remote workspaces are proxied through the remote connection. This allows web pages to access resources available on the remote host."),
	},
});
