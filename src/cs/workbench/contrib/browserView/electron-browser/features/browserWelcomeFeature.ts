/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { renderIcon } from 'cs/base/browser/ui/iconLabel/iconLabels';
import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	type IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

export class BrowserWelcomeFeature extends BrowserEditorContribution {
	private readonly container: HTMLElement;
	private readonly widget: IBrowserEditorWidget;

	constructor(editor: BrowserEditor) {
		super(editor);

		this.container = $('.browser-welcome-container');
		const content = $('.browser-welcome-content');

		const iconContainer = $('.browser-welcome-icon');
		iconContainer.appendChild(renderIcon(Codicon.globe));
		content.appendChild(iconContainer);

		const title = $('.browser-welcome-title');
		title.textContent = localize('browser.welcomeTitle', "Browser");
		content.appendChild(title);

		const subtitle = $('.browser-welcome-subtitle');
		subtitle.textContent = localize('browser.welcomeSubtitle', "Enter a URL above to get started.");
		content.appendChild(subtitle);

		this.container.appendChild(content);
		this.widget = {
			location: BrowserWidgetLocation.ContentArea,
			element: this.container,
			order: 50,
		};
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this.widget];
	}

	override prerenderInput(input: BrowserEditorInput): void {
		this.setVisible(!input.url);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.setVisible(!model.url);
		store.add(model.onDidNavigate(event => this.setVisible(!event.url)));
	}

	override onModelDetached(): void {
		this.setVisible(true);
	}

	private setVisible(visible: boolean): void {
		this.container.style.display = visible ? '' : 'none';
	}
}

BrowserEditor.registerContribution(BrowserWelcomeFeature);
