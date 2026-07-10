/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { renderIcon } from 'cs/base/browser/ui/iconLabel/iconLabels';
import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import {
	clearRecentBrowserLibraryEntries,
	getRecentBrowserLibraryEntries,
	onDidChangeBrowserLibrary,
	type BrowserLibraryRecentEntry,
} from 'cs/workbench/browser/parts/editor/editorBrowserLibraryPanel';
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
	private readonly renderStore = this._register(new DisposableStore());

	constructor(editor: BrowserEditor) {
		super(editor);

		this.container = $('.browser-welcome-container');
		this.render(undefined);
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
		this.render(model);
		store.add(model.onDidNavigate(event => this.setVisible(!event.url)));
		store.add(onDidChangeBrowserLibrary(() => this.render(model)));
	}

	override onModelDetached(): void {
		this.setVisible(true);
		this.render(undefined);
	}

	private setVisible(visible: boolean): void {
		this.container.style.display = visible ? '' : 'none';
	}

	private render(model: IBrowserViewModel | undefined): void {
		this.renderStore.clear();
		this.container.replaceChildren();

		const recents = model ? getRecentBrowserLibraryEntries() : [];
		if (model && recents.length > 0) {
			this.renderRecents(model, recents);
			return;
		}

		this.renderEmptyState();
	}

	private renderRecents(model: IBrowserViewModel, recents: readonly BrowserLibraryRecentEntry[]): void {
		const section = append(this.container, $('section.comet-browser-recents'));
		section.setAttribute('aria-label', localize('browser.recents', "Recents"));

		const header = append(section, $('.comet-browser-recents-header'));
		const title = append(header, $('h2.comet-browser-recents-title'));
		title.textContent = localize('browser.recents', "Recents");

		const clearButton = this.renderStore.add(new ButtonView({
			className: 'comet-browser-recents-clear',
			variant: 'ghost',
			size: 'sm',
			content: localize('browser.recents.clear', "Clear"),
			onClick: () => clearRecentBrowserLibraryEntries(),
		}));
		header.append(clearButton.getElement());

		const list = append(section, $('.comet-browser-recents-list'));
		for (const entry of recents) {
			const link = append(list, $<HTMLAnchorElement>('a.comet-browser-recents-item'));
			link.href = entry.url;
			this.renderStore.add(addDisposableListener(link, EventType.CLICK, event => {
				event.preventDefault();
				void model.loadURL(entry.url);
			}));

			const icon = append(link, $('.comet-browser-recents-icon'));
			if (entry.faviconUrl) {
				const image = append(icon, $<HTMLImageElement>('img'));
				image.src = entry.faviconUrl;
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				image.referrerPolicy = 'no-referrer';
				this.renderStore.add(addDisposableListener(image, EventType.ERROR, () => {
					icon.replaceChildren(renderIcon(Codicon.globe));
				}));
			} else {
				icon.append(renderIcon(Codicon.globe));
			}

			const label = append(link, $('.comet-browser-recents-label'));
			const entryTitle = append(label, $('.comet-browser-recents-entry-title'));
			entryTitle.textContent = entry.title;
			const entryUrl = append(label, $('.comet-browser-recents-entry-url'));
			entryUrl.textContent = entry.url;
		}
	}

	private renderEmptyState(): void {
		const content = append(this.container, $('.browser-welcome-content'));
		const iconContainer = append(content, $('.browser-welcome-icon'));
		iconContainer.append(renderIcon(Codicon.globe));

		const title = append(content, $('.browser-welcome-title'));
		title.textContent = localize('browser.welcomeTitle', "Browser");

		const subtitle = append(content, $('.browser-welcome-subtitle'));
		subtitle.textContent = localize('browser.welcomeSubtitle', "Enter a URL above to get started.");
	}
}

BrowserEditor.registerContribution(BrowserWelcomeFeature);
