/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { renderIcon } from 'cs/base/browser/ui/iconLabel/iconLabels';
import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import {
	configurationRegistry,
	ConfigurationScope,
} from 'cs/platform/configuration/common/configurationRegistry';
import { IHoverService } from 'cs/platform/hover/browser/hover';
import { localize } from 'cs/nls';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { IBrowserViewWorkbenchService } from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserRemoteProxyEnabledSettingId } from 'cs/workbench/contrib/browserView/electron-browser/browserViewWorkbenchService';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	type IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

export class BrowserRemoteIndicatorContribution extends BrowserEditorContribution {
	private readonly container: HTMLElement;
	private message = '';

	constructor(
		editor: BrowserEditor,
		@IHoverService hoverService: IHoverService,
		@IBrowserViewWorkbenchService private readonly browserViewWorkbenchService: IBrowserViewWorkbenchService,
	) {
		super(editor);

		this.container = $('.browser-remote-indicator');
		this.container.setAttribute('role', 'img');
		this.container.appendChild(renderIcon(Codicon.remote));

		this._register(hoverService.setupDelayedHover(
			this.container,
			() => ({ content: this.message }),
		));

		this.refresh(undefined);
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{
			location: BrowserWidgetLocation.PreUrl,
			element: this.container,
			order: 0,
		}];
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.refresh(model);
		store.add(model.onDidNavigate(() => this.refresh(model)));
		store.add(model.onDidChangeRemoteStatus(() => this.refresh(model)));
	}

	override onModelDetached(): void {
		this.refresh(undefined);
	}

	private refresh(model: IBrowserViewModel | undefined): void {
		let statusMessage = '';
		let isConnected = false;
		let isWarning = false;

		if (model) {
			if (model.url.startsWith('file://')) {
				statusMessage = localize('browser.connectedLocally.file', "File URLs are served locally, not over the remote connection.");
				isWarning = true;
			} else if (model.isRemoteSession) {
				statusMessage = localize('browser.connectedRemotely', "Connected via remote");
				isConnected = true;
			} else {
				statusMessage = localize('browser.connectedLocally.generic', "Connected locally");
			}
		}

		this.container.classList.toggle('connected', isConnected);
		this.container.classList.toggle('warning', isWarning);
		this.container.style.display = isConnected || this.browserViewWorkbenchService.willUseRemoteProxy() ? '' : 'none';
		this.container.setAttribute('aria-label', statusMessage);
		this.message = statusMessage;
	}
}

BrowserEditor.registerContribution(BrowserRemoteIndicatorContribution);

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
