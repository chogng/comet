/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { BrowserHistoryAndFavoritesPanelFeatures } from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import {
	createEditorModeToolbarHost,
	type BrowserEditorModeToolbarPaneAdapter,
} from 'cs/workbench/contrib/browserView/browser/browserModeToolbarHost';
import type { EditorModeToolbarHostContext } from 'cs/workbench/browser/parts/editor/editorModeToolbarRegistry';

export interface BrowserEditorPaneState {
	readonly tabId: string;
	readonly url: string;
	readonly title: string;
	readonly favicon: string | undefined;
	readonly loading: boolean;
}

export interface IBrowserEditorPane {
	navigate(url: string): Promise<void>;
	goBack(): Promise<void>;
	goForward(): Promise<void>;
	reload(hard?: boolean): Promise<void>;
	getHistoryAndFavoritesFeatures(): BrowserHistoryAndFavoritesPanelFeatures | undefined;
	readonly onDidChangeBrowserState: Event<BrowserEditorPaneState>;
	readonly browserState: BrowserEditorPaneState | undefined;
}

export function isBrowserEditorPane(value: unknown): value is IBrowserEditorPane {
	const candidate = value as Partial<IBrowserEditorPane> | null;
	return Boolean(
		candidate &&
		typeof candidate.navigate === 'function' &&
		typeof candidate.goBack === 'function' &&
		typeof candidate.goForward === 'function' &&
		typeof candidate.reload === 'function' &&
		typeof candidate.getHistoryAndFavoritesFeatures === 'function' &&
		typeof candidate.onDidChangeBrowserState === 'function',
	);
}

function getBrowserEditorPane(pane: AnyEditorPane): IBrowserEditorPane {
	if (!isBrowserEditorPane(pane)) {
		throw new Error('The editor pane does not implement the Browser editor contract.');
	}
	return pane;
}

const browserEditorModeToolbarPaneAdapter: BrowserEditorModeToolbarPaneAdapter = {
	supportsPane: isBrowserEditorPane,
	getState: pane => getBrowserEditorPane(pane).browserState,
	onDidChangeState: (pane, listener) => getBrowserEditorPane(pane).onDidChangeBrowserState(listener),
	getHistoryAndFavoritesFeatures: pane => getBrowserEditorPane(pane).getHistoryAndFavoritesFeatures(),
	navigate: (pane, url) => getBrowserEditorPane(pane).navigate(url),
	goBack: pane => getBrowserEditorPane(pane).goBack(),
	goForward: pane => getBrowserEditorPane(pane).goForward(),
	reload: (pane, hard) => getBrowserEditorPane(pane).reload(hard),
};

export function createBrowserEditorModeToolbarHost(
	context: EditorModeToolbarHostContext,
	dropdownServices: DropdownContextServices,
) {
	return createEditorModeToolbarHost(
		context,
		dropdownServices,
		browserEditorModeToolbarPaneAdapter,
	);
}
