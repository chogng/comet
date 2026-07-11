/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { EditorModeToolbarContributionContext } from 'cs/workbench/browser/parts/editor/editorModeToolbarContribution';

const domEnvironment = installDomTestEnvironment();

beforeEach(() => {
	document.body.replaceChildren();
});

after(() => {
	domEnvironment.cleanup();
});

function createContext(): EditorModeToolbarContributionContext {
	return {
		mode: 'browser',
		browserUrl: 'https://example.com/article',
		electronRuntime: true,
		labels: {
			toolbarSources: 'Sources',
			toolbarBack: 'Back',
			toolbarForward: 'Forward',
			toolbarRefresh: 'Refresh',
			toolbarFavorite: 'Favorite',
			toolbarArchivePage: 'Archive Page',
			toolbarExportDocx: 'Export DOCX',
			toolbarMore: 'More',
			toolbarHardReload: 'Hard Reload',
			toolbarCopyCurrentUrl: 'Copy Current URL',
			toolbarClearBrowsingHistory: 'Clear Browsing History',
			toolbarClearCookies: 'Clear Cookies',
			toolbarClearCache: 'Clear Cache',
			toolbarAddressBar: 'Address Bar',
			toolbarAddressPlaceholder: 'Search or enter URL',
			browserLibraryPanelTitle: 'Sources',
			browserLibraryPanelRecentTitle: 'Recent',
			browserLibraryPanelRecentTodayTitle: 'Today',
			browserLibraryPanelRecentYesterdayTitle: 'Yesterday',
			browserLibraryPanelRecentLast7DaysTitle: 'Last 7 Days',
			browserLibraryPanelRecentLast30DaysTitle: 'Last 30 Days',
			browserLibraryPanelRecentOlderTitle: 'Older',
			browserLibraryPanelFavoritesTitle: 'Favorites',
			browserLibraryPanelEmptyState: 'No links yet',
			pdfTitle: 'PDF',
		},
		onOpenSources: () => {},
		onNavigateBack: () => {},
		onNavigateForward: () => {},
		onNavigateRefresh: () => {},
		onArchiveCurrentPage: () => {},
		onExportDocx: () => {},
		onHardReload: () => {},
		onCopyCurrentUrl: () => {},
		onClearBrowsingHistory: () => {},
		onClearCookies: () => {},
		onClearCache: () => {},
		onAddressInputChange: () => {},
		onAddressInputSubmit: () => {},
		onNavigateToUrl: () => {},
		onPdfHighlightSelection: () => {},
		onPdfNoteSelection: () => {},
		browserLibraryPanel: null,
	};
}

test('browser More menu stays open across context updates', async () => {
	const { createEditorBrowserModeToolbarContribution } = await import(
		'cs/workbench/browser/parts/editor/editorBrowserModeToolbarContribution'
	);
	const contribution = createEditorBrowserModeToolbarContribution(createContext());
	document.body.append(contribution.getElement());

	try {
		const moreButton = contribution.getElement().querySelector('[aria-label="More"]');
		assert(moreButton instanceof HTMLButtonElement);

		moreButton.click();
		assert.equal(moreButton.getAttribute('aria-expanded'), 'true');

		contribution.setContext(createContext());

		assert.equal(
			contribution.getElement().querySelector('[aria-label="More"]'),
			moreButton,
		);
		assert.equal(moreButton.getAttribute('aria-expanded'), 'true');
		assert.match(
			document.body.querySelector('.context-view.comet-actionbar-context-view')?.textContent ?? '',
			/Hard Reload/,
		);
	} finally {
		contribution.dispose();
	}
});
