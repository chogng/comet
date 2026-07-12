/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type { EditorModeToolbarContributionContext } from 'cs/workbench/contrib/browserView/browser/browserModeToolbarTypes';

const domEnvironment = installDomTestEnvironment();
let dropdownServices: Awaited<ReturnType<typeof createDropdownTestServices>>;

beforeEach(async () => {
	document.body.replaceChildren();
	dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
	dropdownServices.dispose();
});

after(() => {
	domEnvironment.cleanup();
});

function createContext(): EditorModeToolbarContributionContext {
	return {
		mode: 'browser',
		browserUrl: 'https://example.com/article',
		browserCanGoBack: true,
		browserCanGoForward: false,
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
			browserHistoryAndFavoritesPanelTitle: 'Sources',
			browserHistoryAndFavoritesPanelRecentTitle: 'Recent',
			browserHistoryAndFavoritesPanelRecentTodayTitle: 'Today',
			browserHistoryAndFavoritesPanelRecentYesterdayTitle: 'Yesterday',
			browserHistoryAndFavoritesPanelRecentLast7DaysTitle: 'Last 7 Days',
			browserHistoryAndFavoritesPanelRecentLast30DaysTitle: 'Last 30 Days',
			browserHistoryAndFavoritesPanelRecentOlderTitle: 'Older',
			browserHistoryAndFavoritesPanelFavoritesTitle: 'Favorites',
			browserHistoryAndFavoritesPanelEmptyState: 'No links yet',
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
		onNavigateToUrl: () => {},
		browserHistoryAndFavoritesPanel: null,
	};
}

test('browser More menu stays open across context updates', async () => {
	const { createEditorBrowserModeToolbarContribution } = await import(
		'cs/workbench/contrib/browserView/browser/browserModeToolbarContribution'
	);
	const contribution = createEditorBrowserModeToolbarContribution(createContext(), dropdownServices);
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

test('browser history buttons follow the model navigation state', async () => {
	const { createEditorBrowserModeToolbarContribution } = await import(
		'cs/workbench/contrib/browserView/browser/browserModeToolbarContribution'
	);
	const contribution = createEditorBrowserModeToolbarContribution(createContext(), dropdownServices);
	document.body.append(contribution.getElement());

	try {
		const back = contribution.getElement().querySelector('[aria-label="Back"]');
		const forward = contribution.getElement().querySelector('[aria-label="Forward"]');
		assert(back instanceof HTMLButtonElement);
		assert(forward instanceof HTMLButtonElement);
		assert.equal(back.disabled, false);
		assert.equal(forward.disabled, true);

		contribution.setContext({
			...createContext(),
			browserCanGoBack: false,
			browserCanGoForward: true,
		});
		const updatedBack = contribution.getElement().querySelector('[aria-label="Back"]');
		const updatedForward = contribution.getElement().querySelector('[aria-label="Forward"]');
		assert(updatedBack instanceof HTMLButtonElement);
		assert(updatedForward instanceof HTMLButtonElement);
		assert.equal(updatedBack.disabled, true);
		assert.equal(updatedForward.disabled, false);
	} finally {
		contribution.dispose();
	}
});

test('browser archive action carries the addressed BrowserView identity', async () => {
	const invocations: Array<{ readonly command: string; readonly payload: unknown }> = [];
	const invokeDesktop = (async (command: string, payload: unknown) => {
		invocations.push({ command, payload });
		return {
			filePath: '/tmp/archive',
			htmlPath: '/tmp/archive/page.html',
			textPath: '/tmp/archive/page.txt',
			pdfPath: null,
			title: 'Article',
			sourceUrl: 'https://example.com/article',
			pdfSourceUrl: null,
			extractedText: 'Article',
		};
	}) as ElectronInvoke;
	const { createEditorBrowserToolbarActions } = await import(
		'cs/workbench/contrib/browserView/browser/browserToolbarActions'
	);
	const actions = createEditorBrowserToolbarActions({
		browserViewId: 'browser-view-1',
		browserUrl: 'https://example.com/article?issue=7#/document/2!',
		invokeDesktop,
		notificationService: { info: () => {}, error: () => {} } as never,
		knowledgeBaseEnabled: false,
		ui: {
			toastHtmlArchiveSavedWithPdf: 'Saved {filePath} {sourceUrl}',
			toastHtmlArchiveSavedWithoutPdf: 'Saved {filePath} {sourceUrl}',
			toastHtmlArchiveSaveFailed: 'Failed {error}',
		} as never,
		onOpenAddressBarSourceMenu: () => {},
		onToolbarExportDocx: () => {},
	});

	await actions.onArchiveCurrentPage();
	assert.deepEqual(invocations, [{
		command: 'web_content_archive_html',
		payload: {
			browserViewId: 'browser-view-1',
			pageUrl: 'https://example.com/article?issue=7#/document/2!',
		},
	}]);
});
