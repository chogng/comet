/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type {
	BrowserFavoritesPanelFeature,
	BrowserHistoryAndFavoritesPanelFeatures,
	BrowserHistoryPanelEntry,
	BrowserHistoryPanelFeature,
} from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';

let cleanupDomEnvironment: (() => void) | undefined;
let BrowserHistoryAndFavoritesPanel: typeof import('cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel').BrowserHistoryAndFavoritesPanel;

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ BrowserHistoryAndFavoritesPanel } = await import('cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel'));
});

after(() => cleanupDomEnvironment?.());

test('history and favorites panel consumes BrowserEditor feature state', () => {
	const historyEmitter = new Emitter<void>();
	const favoritesEmitter = new Emitter<void>();
	const historyEntries: BrowserHistoryPanelEntry[] = [{ id: 1, url: 'https://history.example', title: 'History', time: Date.now() }];
	const favoriteUrls: string[] = [];
	const history: BrowserHistoryPanelFeature = {
		onDidChange: historyEmitter.event,
		entries: historyEntries,
		getFavicon: () => '',
		removeEntry: entryId => {
			const index = historyEntries.findIndex(entry => entry.id === entryId);
			if (index < 0) {
				return false;
			}
			historyEntries.splice(index, 1);
			historyEmitter.fire();
			return true;
		},
		clear: () => {
			historyEntries.splice(0);
			historyEmitter.fire();
		},
	};
	const favorites: BrowserFavoritesPanelFeature = {
		onDidChange: favoritesEmitter.event,
		get favorites() { return favoriteUrls; },
		isFavorite: url => favoriteUrls.includes(url),
		toggle: url => {
			const index = favoriteUrls.indexOf(url);
			if (index < 0) {
				favoriteUrls.push(url);
			} else {
				favoriteUrls.splice(index, 1);
			}
			favoritesEmitter.fire();
		},
		remove: url => {
			const index = favoriteUrls.indexOf(url);
			if (index >= 0) {
				favoriteUrls.splice(index, 1);
				favoritesEmitter.fire();
			}
		},
	};
	const features: BrowserHistoryAndFavoritesPanelFeatures = { history, favorites };
	const panel = new BrowserHistoryAndFavoritesPanel({
		browserUrl: 'https://favorite.example',
		labels: {
			title: 'History and favorites', recentTitle: 'Recent', recentTodayTitle: 'Today',
			recentYesterdayTitle: 'Yesterday', recentLast7DaysTitle: 'Last 7 days',
			recentLast30DaysTitle: 'Last 30 days', recentOlderTitle: 'Older',
			favoritesTitle: 'Favorites', emptyState: 'Empty',
		},
		onNavigateToUrl: () => { },
	}, {}, {
		_serviceBrand: undefined,
		activeEditorPane: undefined,
		activeEditor: undefined,
		openEditor: async () => { throw new Error('Unexpected editor open.'); },
		activateEditor: async () => {},
		closeEditor: async () => true,
		getEditors: () => [],
		getActiveGroupId: () => 'test',
	});
	const host = document.body.appendChild(document.createElement('div'));
	panel.mountTo(host);
	panel.setFeatures(features);

	try {
		assert.equal(panel.toggleCurrentBrowserUrlFavorite(), true);
		assert.equal(favorites.isFavorite('https://favorite.example'), true);
		panel.setOpen(true);
		assert(document.querySelector('[title="https://favorite.example"]'));
		panel.clearRecentEntries();
		assert.equal(historyEntries.length, 0);
	} finally {
		panel.dispose();
		historyEmitter.dispose();
		favoritesEmitter.dispose();
		document.body.replaceChildren();
	}
});
