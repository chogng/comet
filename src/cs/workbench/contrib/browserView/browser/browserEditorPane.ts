/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type { BrowserHistoryAndFavoritesPanelFeatures } from 'cs/workbench/browser/parts/editor/browserHistoryAndFavoritesPanel';

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
