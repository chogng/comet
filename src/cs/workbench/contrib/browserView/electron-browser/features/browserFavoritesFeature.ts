/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { Codicon } from 'cs/base/common/codicons';
import { Emitter } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { ThemeIcon } from 'cs/base/common/themables';
import { localize, localize2 } from 'cs/nls';
import { Action2, MenuId, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { ContextKeyExpr, IContextKeyService, RawContextKey, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'cs/platform/keybinding/common/keybinding';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	CONTEXT_BROWSER_HAS_URL,
	type IBrowserEditorWidget,
	type IBrowserUrlPickerAction,
	type IBrowserUrlPickerActionProvider,
	type IBrowserUrlSuggestion,
	type IBrowserUrlSuggestionProvider,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

const CONTEXT_BROWSER_URL_IS_FAVORITED = new RawContextKey<boolean>('browserUrlIsFavorited', false);

class FavoriteIndicator {
	readonly element = $('.browser-favorite-indicator-container');
	private readonly button: ButtonView;
	private readonly onClick: () => void;
	private readonly keybindingService: IKeybindingService;

	constructor(keybindingService: IKeybindingService, onClick: () => void) {
		this.keybindingService = keybindingService;
		this.onClick = onClick;
		this.button = new ButtonView(this.getButtonProps());
		this.element.append(this.button.getElement());
		this.element.style.display = 'none';
	}

	dispose(): void {
		this.button.dispose();
	}

	refreshTooltip(): void {
		this.button.setProps(this.getButtonProps());
	}

	setVisible(visible: boolean): void {
		this.element.style.display = visible ? '' : 'none';
	}

	private getButtonProps() {
		const label = localize('browser.removeFavorite', "Remove from Favorites");
		const keybinding = this.keybindingService.lookupKeybinding(BrowserViewCommandId.ToggleFavorite);
		const keybindingLabel = keybinding?.getLabel?.();
		const tooltip = keybindingLabel
			? localize('browser.removeFavoriteWithKeybinding', "Remove from Favorites ({0})", keybindingLabel)
			: label;
		return {
			className: 'browser-favorite-indicator',
			variant: 'ghost' as const,
			size: 'icon' as const,
			mode: 'icon' as const,
			content: $('span', { class: ThemeIcon.asClassName(Codicon.starFull) }),
			ariaLabel: label,
			hover: tooltip,
			onClick: this.onClick,
		};
	}
}

export class BrowserFavoritesFeature extends BrowserEditorContribution {
	private static readonly StorageKey = 'workbench.browser.favorites';

	private readonly onDidChangeStateEmitter = this._register(new Emitter<void>());
	private readonly isFavoriteContext: ContextKey<boolean>;
	private readonly indicator: FavoriteIndicator;
	private readonly storageListenerStore = this._register(new DisposableStore());
	private urls = new Set<string>();

	constructor(
		editor: BrowserEditor,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super(editor);
		this.load();
		this.isFavoriteContext = CONTEXT_BROWSER_URL_IS_FAVORITED.bindTo(contextKeyService);
		this.indicator = new FavoriteIndicator(keybindingService, () => this.toggleCurrent());
		this._register(this.indicator);
		this._register(this.keybindingService.onDidUpdateKeybindings(() => this.indicator.refreshTooltip()));
		this._register(this.storageService.onDidChangeValue(
			StorageScope.WORKSPACE,
			BrowserFavoritesFeature.StorageKey,
			this.storageListenerStore,
		)(() => {
			this.load();
			this.refresh();
			this.onDidChangeStateEmitter.fire();
		}));
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{ location: BrowserWidgetLocation.PostUrl, element: this.indicator.element, order: 60 }];
	}

	override get urlSuggestionProviders(): readonly IBrowserUrlSuggestionProvider[] {
		return [this.suggestionProvider];
	}

	override get urlPickerActionProviders(): readonly IBrowserUrlPickerActionProvider[] {
		return [this.actionProvider];
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		store.add(model.onDidNavigate(() => {
			this.refresh();
			this.onDidChangeStateEmitter.fire();
		}));
		this.refresh();
	}

	override onModelDetached(): void {
		this.isFavoriteContext.reset();
		this.indicator.setVisible(false);
	}

	isFavorite(url: string): boolean {
		return this.urls.has(url);
	}

	toggleCurrent(): void {
		const url = this.editor.model?.url;
		if (url) {
			this.toggle(url);
		}
	}

	private readonly suggestionProvider: IBrowserUrlSuggestionProvider = {
		label: localize('browser.favorites', "Favorites"),
		order: 50,
		onDidChange: this.onDidChangeStateEmitter.event,
		getSuggestions: input => {
			const suggestions: IBrowserUrlSuggestion[] = [];
			const currentUrl = input.url;
			for (const url of this.urls) {
				if (url === currentUrl) {
					continue;
				}
				const removeAction: IBrowserUrlPickerAction = {
					id: 'browser.favorites.remove',
					label: localize('browser.removeFavorite', "Remove from Favorites"),
					iconClass: ThemeIcon.asClassName(Codicon.trash),
					tooltip: localize('browser.removeFavorite', "Remove from Favorites"),
					run: () => this.remove(url),
				};
				suggestions.push({
					id: `favorite:${url}`,
					label: url,
					icon: Codicon.star,
					actions: [removeAction],
					apply: target => target.navigate(url),
				});
			}
			return suggestions;
		},
	};

	private readonly actionProvider: IBrowserUrlPickerActionProvider = {
		onDidChange: this.onDidChangeStateEmitter.event,
		getActions: input => {
			const url = input.url;
			if (!url) {
				return [];
			}
			const favorite = this.urls.has(url);
			const label = favorite
				? localize('browser.removeFavorite', "Remove from Favorites")
				: localize('browser.addFavorite', "Add to Favorites");
			return [{
				id: 'browser.favorites.toggle',
				label,
				iconClass: ThemeIcon.asClassName(favorite ? Codicon.starFull : Codicon.star),
				tooltip: label,
				run: target => {
					const targetUrl = target.url;
					if (targetUrl) {
						this.toggle(targetUrl);
					}
				},
			}];
		},
	};

	private refresh(): void {
		const url = this.editor.model?.url ?? '';
		const favorite = !!url && this.urls.has(url);
		this.isFavoriteContext.set(favorite);
		this.indicator.setVisible(favorite);
	}

	private load(): void {
		const raw = this.storageService.get(BrowserFavoritesFeature.StorageKey, StorageScope.WORKSPACE);
		if (!raw) {
			this.urls = new Set();
			return;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			this.urls = new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
		} catch {
			this.urls = new Set();
		}
	}

	private save(): void {
		this.storageService.store(
			BrowserFavoritesFeature.StorageKey,
			JSON.stringify([...this.urls]),
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
		this.refresh();
		this.onDidChangeStateEmitter.fire();
	}

	private toggle(url: string): void {
		if (this.urls.has(url)) {
			this.urls.delete(url);
		} else {
			this.urls.add(url);
		}
		this.save();
	}

	private remove(url: string): void {
		if (!this.urls.delete(url)) {
			return;
		}
		this.save();
	}
}

BrowserEditor.registerContribution(BrowserFavoritesFeature);

function getBrowserEditor(candidate: unknown): BrowserEditor | undefined {
	return candidate instanceof BrowserEditor ? candidate : undefined;
}

class ToggleFavoriteAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ToggleFavorite;

	constructor() {
		const when = ContextKeyExpr.and(
			BROWSER_EDITOR_ACTIVE,
			CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
		);
		super({
			id: ToggleFavoriteAction.ID,
			title: localize2('browser.addFavoriteAction', "Add to Favorites"),
			category: BrowserActionCategory,
			icon: Codicon.star,
			f1: true,
			precondition: when,
			toggled: {
				condition: CONTEXT_BROWSER_URL_IS_FAVORITED.isEqualTo(true),
				icon: Codicon.starFull,
			},
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Data,
				order: 2,
				isHiddenByDefault: true,
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when,
				primary: KeyMod.CtrlCmd | KeyCode.KeyD,
			},
		});
	}

	run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		getBrowserEditor(browserEditor)?.getContribution(BrowserFavoritesFeature)?.toggleCurrent();
	}
}

registerAction2(ToggleFavoriteAction);
