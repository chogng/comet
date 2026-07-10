/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesSomeScheme, Schemas } from 'cs/base/common/network';
import { Disposable } from 'cs/base/common/lifecycle';
import { BrowserHistoryStore, type IBrowserHistoryItemHandle } from 'cs/platform/browserView/common/browserHistory';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';

type BrowserHistoryModel = Pick<
	IBrowserViewModel,
	'favicon' | 'onWillNavigate' | 'onDidNavigate' | 'onDidChangeTitle' | 'onDidChangeFavicon'
>;

export class BrowserHistoryTracker extends Disposable {
	private currentEntry: IBrowserHistoryItemHandle | undefined;
	private currentNavigationEntryIndex = -1;
	private explicitNavigationPending = false;

	constructor(model: BrowserHistoryModel, history: BrowserHistoryStore) {
		super();
		this._register(model.onWillNavigate(() => this.explicitNavigationPending = true));
		this._register(model.onDidNavigate(event => {
			const userInitiated = this.explicitNavigationPending;
			this.explicitNavigationPending = false;
			if (!matchesSomeScheme(event.url, Schemas.http, Schemas.https, Schemas.file)) {
				this.currentEntry = undefined;
				this.currentNavigationEntryIndex = event.navigationEntryIndex;
				return;
			}
			if (this.currentEntry && event.navigationEntryIndex === this.currentNavigationEntryIndex) {
				this.currentEntry.update({ url: event.url, title: event.title });
				return;
			}
			this.currentNavigationEntryIndex = event.navigationEntryIndex;
			this.currentEntry = history.add(event.url, event.title, model.favicon, userInitiated);
		}));
		this._register(model.onDidChangeTitle(event => this.currentEntry?.update({ title: event.title })));
		this._register(model.onDidChangeFavicon(event => this.currentEntry?.update({ favicon: event.favicon ?? null })));
	}
}
