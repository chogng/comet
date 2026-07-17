/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from 'cs/base/common/uri';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import { getHoverService } from 'cs/platform/hover/browser/hoverService';
import { locales } from 'language/locales';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';

let cleanupDomEnvironment: (() => void) | undefined;
let renderSupportedSourcesSection: typeof import('cs/workbench/contrib/preferences/browser/settingsSections').renderSupportedSourcesSection;

test.before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ renderSupportedSourcesSection } = await import('cs/workbench/contrib/preferences/browser/settingsSections'));
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

test('Supported Sources exposes the Journal home without leaking its discovery URL', () => {
	const journal: JournalDescriptor = {
		id: 'journal.test',
		title: 'Test Journal',
		homeUrl: URI.parse('https://example.com/journal'),
		discoveryUrl: URI.parse('https://example.com/internal-discovery'),
		providerId: 'provider.test',
	};
	const labels = locales.en;
	const disposables = new DisposableStore();
	const section = renderSupportedSourcesSection({
		labels,
		supportedSources: [journal],
		showSupportedSources: true,
		isSettingsSaving: false,
	}, () => {}, getHoverService(), disposables);
	const url = section.querySelector<HTMLElement>('.comet-settings-supported-source-url');

	assert.deepEqual({
		text: url?.textContent,
		title: url?.title,
		containsDiscoveryUrl: section.outerHTML.includes(journal.discoveryUrl.toString(true)),
	}, {
		text: journal.homeUrl.toString(true),
		title: `${labels.settingsSupportedSourceUrl}: ${journal.homeUrl.toString(true)}`,
		containsDiscoveryUrl: false,
	});
	disposables.dispose();
});

test('Chinese Settings navigation localizes the Appearance page', () => {
	assert.equal(locales.zh.settingsNavigationAppearance, '外观');
});
