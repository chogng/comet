/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import {
	BrowserMaxHistoryEntriesSettingId,
	defaultBrowserMaxHistoryEntries,
	maxBrowserMaxHistoryEntries,
	minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { Emitter } from 'cs/base/common/event';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { ThemeIcon } from 'cs/base/common/themables';
import { URI } from 'cs/base/common/uri';
import { localize, localize2 } from 'cs/nls';
import { Action2, MenuId, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, BrowserViewStorageScope } from 'cs/platform/browserView/common/browserView';
import { BrowserHistoryStore, type IBrowserHistoryEntry } from 'cs/platform/browserView/common/browserHistory';
import {
	configurationRegistry,
	ConfigurationScope,
} from 'cs/platform/configuration/common/configurationRegistry';
import { ContextKeyExpr } from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import type { IQuickInputButton, IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'cs/platform/quickinput/common/quickInput';
import { IQuickInputService as IQuickInputServiceDecorator } from 'cs/platform/quickinput/common/quickInput';
import { IBrowserViewWorkbenchService, type IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	type IBrowserUrlSuggestion,
	type IBrowserUrlSuggestionProvider,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { CONTEXT_BROWSER_STORAGE_SCOPE } from 'cs/workbench/contrib/browserView/electron-browser/features/browserDataStorageFeatures';

const MAX_RECENTS = 3;
const MAX_HISTORY = 6;

export class BrowserHistoryFeature extends BrowserEditorContribution {
	private readonly onDidChangeEmitter = this._register(new Emitter<void>());
	private model: IBrowserViewModel | undefined;

	constructor(
		editor: BrowserEditor,
		@IQuickInputServiceDecorator private readonly quickInputService: IQuickInputService,
		@IBrowserViewWorkbenchService private readonly browserViewWorkbenchService: IBrowserViewWorkbenchService,
	) {
		super(editor);
		this._register(this.browserViewWorkbenchService.browserHistory.onDidChange(() => this.onDidChangeEmitter.fire()));
	}

	override get urlSuggestionProviders(): readonly IBrowserUrlSuggestionProvider[] {
		return [this.recentsProvider, this.historyProvider];
	}

	protected override onModelAttached(model: IBrowserViewModel, _store: DisposableStore): void {
		this.model = model;
		this.onDidChangeEmitter.fire();
	}

	override onModelDetached(): void {
		this.model = undefined;
		this.onDidChangeEmitter.fire();
	}

	showManagementPicker(): void {
		const model = this.model;
		if (!model) {
			return;
		}
		showHistoryPicker(this.quickInputService, model, this.browserViewWorkbenchService.browserHistory);
	}

	private readonly recentsProvider: IBrowserUrlSuggestionProvider = {
		label: localize('browser.recents', "Recents"),
		order: 5,
		onDidChange: this.onDidChangeEmitter.event,
		getSuggestions: (input, value) => this.buildRecents(input.url, value),
	};

	private readonly historyProvider: IBrowserUrlSuggestionProvider = {
		label: localize('browser.history', "History"),
		order: 10,
		onDidChange: this.onDidChangeEmitter.event,
		getSuggestions: (input, value) => this.buildHistory(input.url, value),
	};

	private buildRecents(currentUrl: string | undefined, value: string): IBrowserUrlSuggestion[] {
		if (value.trim().length > 0) {
			return [];
		}
		return this.buildList(currentUrl, '', true, MAX_RECENTS);
	}

	private buildHistory(currentUrl: string | undefined, value: string): IBrowserUrlSuggestion[] {
		const needle = value.trim().toLowerCase();
		if (needle.length === 0) {
			return [];
		}
		return this.buildList(currentUrl, needle, false, MAX_HISTORY);
	}

	private buildList(currentUrl: string | undefined, needle: string, onlyUserInitiated: boolean, max: number): IBrowserUrlSuggestion[] {
		if (this.model?.storageScope === BrowserViewStorageScope.Ephemeral) {
			return [];
		}
		const history = this.browserViewWorkbenchService.browserHistory;
		const seen = new Set<string>();
		if (currentUrl) {
			seen.add(dedupKey(currentUrl));
		}

		const suggestions: IBrowserUrlSuggestion[] = [];
		for (let index = history.entries.items.length - 1; index >= 0 && suggestions.length < max; index--) {
			const entry = history.entries.items[index];
			if (onlyUserInitiated && !entry.explicit) {
				continue;
			}
			const key = dedupKey(entry.url);
			if (seen.has(key)) {
				continue;
			}
			if (needle && !matches(entry, needle)) {
				continue;
			}
			seen.add(key);
			suggestions.push(toSuggestion(history, entry));
		}
		return suggestions;
	}
}

BrowserEditor.registerContribution(BrowserHistoryFeature);

function toSuggestion(history: BrowserHistoryStore, entry: IBrowserHistoryEntry): IBrowserUrlSuggestion {
	const faviconUri = entry.icon ? resolveFavicon(history, entry.icon) : undefined;
	return {
		id: 'history:' + entry.id,
		label: entry.title || entry.url,
		description: entry.title ? entry.url : undefined,
		icon: faviconUri ? undefined : Codicon.globe,
		iconPath: faviconUri,
		apply: input => input.navigate(entry.url),
		actions: [{
			id: 'browser.history.delete',
			label: localize('browser.removeFromHistory', "Remove from History"),
			iconClass: ThemeIcon.asClassName(Codicon.close),
			tooltip: localize('browser.removeFromHistory', "Remove from History"),
			run: () => {
				history.entries.delete(entry.id);
			},
		}],
	};
}

function dedupKey(url: string): string {
	const parsed = URL.parse(url);
	return parsed ? parsed.host + parsed.pathname : url;
}

function matches(entry: IBrowserHistoryEntry, needle: string): boolean {
	return entry.url.toLowerCase().includes(needle)
		|| entry.title.toLowerCase().includes(needle);
}

function resolveFavicon(history: BrowserHistoryStore, hash: string): URI | undefined {
	const dataUri = history.favicons.get(hash);
	return dataUri ? URI.parse(dataUri) : undefined;
}

interface HistoryQuickPickItem extends IQuickPickItem {
	readonly iconClass?: string;
	readonly iconPath?: URI;
	readonly entryId: number;
	readonly entryUrl: string;
}

interface HistoryQuickPickSeparator extends IQuickPickSeparator {
	readonly id: string;
	readonly entryIds: readonly number[];
}

function showHistoryPicker(quickInputService: IQuickInputService, model: IBrowserViewModel, history: BrowserHistoryStore): void {
	const disposables = new DisposableStore();
	const picker = disposables.add(quickInputService.createQuickPick<HistoryQuickPickItem>({ useSeparators: true }));
	picker.title = localize('browser.history.title', "Browser History");
	picker.placeholder = localize('browser.history.placeholder', "Filter browser history");
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;

	const clearAllButton: IQuickInputButton = {
		iconClass: ThemeIcon.asClassName(Codicon.trash),
		tooltip: localize('browser.history.clearAll', "Clear All History"),
	};
	const clearDayButton: IQuickInputButton = {
		iconClass: ThemeIcon.asClassName(Codicon.trash),
		tooltip: localize('browser.history.clearDay', "Clear Entries for This Day"),
	};
	const removeEntryButton: IQuickInputButton = {
		iconClass: ThemeIcon.asClassName(Codicon.close),
		tooltip: localize('browser.removeFromHistory', "Remove from History"),
	};
	picker.buttons = [clearAllButton];

	const rebuild = () => {
		picker.items = buildPickerItems(history, clearDayButton, removeEntryButton);
	};
	rebuild();
	disposables.add(history.onDidChange(rebuild));
	disposables.add(picker.onDidTriggerButton(button => {
		if (button === clearAllButton) {
			history.clear();
		}
	}));
	disposables.add(picker.onDidTriggerSeparatorButton(({ button, separator }) => {
		if (button === clearDayButton) {
			for (const entryId of (separator as HistoryQuickPickSeparator).entryIds) {
				history.entries.delete(entryId);
			}
		}
	}));
	disposables.add(picker.onDidTriggerItemButton(({ button, item }) => {
		if (button === removeEntryButton) {
			history.entries.delete(item.entryId);
		}
	}));

	disposables.add(picker.onDidAccept(() => {
		const selected = picker.activeItems[0];
		if (selected) {
			void model.loadURL(selected.entryUrl);
		}
		picker.hide();
	}));
	disposables.add(picker.onDidHide(() => disposables.dispose()));
	picker.show();
}

function buildPickerItems(
	history: BrowserHistoryStore,
	clearDayButton: IQuickInputButton,
	removeEntryButton: IQuickInputButton,
): (HistoryQuickPickItem | HistoryQuickPickSeparator)[] {
	const sorted = [...history.entries.items].sort((a, b) => b.time - a.time);
	const groups = new Map<string, { label: string; entries: IBrowserHistoryEntry[] }>();
	const orderedKeys: string[] = [];
	const now = new Date();

	for (const entry of sorted) {
		const key = dayKey(entry.time);
		let group = groups.get(key);
		if (!group) {
			group = { label: dayLabel(entry.time, now), entries: [] };
			groups.set(key, group);
			orderedKeys.push(key);
		}
		group.entries.push(entry);
	}

	const items: (HistoryQuickPickItem | HistoryQuickPickSeparator)[] = [];
	for (const key of orderedKeys) {
		const group = groups.get(key)!;
		items.push({
			type: 'separator',
			id: key,
			label: group.label,
			buttons: [clearDayButton],
			entryIds: group.entries.map(entry => entry.id),
		});
		for (const entry of group.entries) {
			const faviconUri = entry.icon ? resolveFavicon(history, entry.icon) : undefined;
			items.push({
				label: entry.title || entry.url,
				description: entry.title ? entry.url : undefined,
				iconClass: faviconUri ? undefined : ThemeIcon.asClassName(Codicon.globe),
				iconPath: faviconUri,
				buttons: [removeEntryButton],
				entryId: entry.id,
				entryUrl: entry.url,
			});
		}
	}
	return items;
}

function dayKey(time: number): string {
	const date = new Date(time);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(time: number, now: Date): string {
	const date = new Date(time);
	if (isSameDay(date, now)) {
		return localize('browser.history.today', "Today");
	}
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (isSameDay(date, yesterday)) {
		return localize('browser.history.yesterday', "Yesterday");
	}
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function isSameDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear()
		&& a.getMonth() === b.getMonth()
		&& a.getDate() === b.getDate();
}

class ShowBrowserHistoryAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ShowHistory;

	constructor() {
		const when = ContextKeyExpr.and(
			BROWSER_EDITOR_ACTIVE,
			CONTEXT_BROWSER_STORAGE_SCOPE.notEqualsTo(BrowserViewStorageScope.Ephemeral),
		);
		super({
			id: ShowBrowserHistoryAction.ID,
			title: localize2('browser.showHistory', "History"),
			category: BrowserActionCategory,
			icon: Codicon.history,
			f1: true,
			precondition: when,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Data,
				order: 1,
				when,
				isHiddenByDefault: true,
			},
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyH,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyY },
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: BrowserEditor): Promise<void> {
		if (browserEditor instanceof BrowserEditor) {
			browserEditor.getContribution(BrowserHistoryFeature)?.showManagementPicker();
		}
	}
}

registerAction2(ShowBrowserHistoryAction);

configurationRegistry.registerConfigurationProperties({
	[BrowserMaxHistoryEntriesSettingId]: {
		type: 'integer',
		default: defaultBrowserMaxHistoryEntries,
		minimum: minBrowserMaxHistoryEntries,
		maximum: maxBrowserMaxHistoryEntries,
		scope: ConfigurationScope.APPLICATION,
		description: localize(
			'browser.maxHistoryEntries',
			"Maximum number of browser history items to keep. Older entries are evicted first.",
		),
	},
});
