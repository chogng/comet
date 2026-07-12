/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { Emitter } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { ContextKeyExpr, IContextKeyService, RawContextKey, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserEditor,
	BrowserEditorContribution,
	CONTEXT_BROWSER_HAS_URL,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

const CONTEXT_BROWSER_URL_IS_FAVORITED = new RawContextKey<boolean>('browserUrlIsFavorited', false);

export class BrowserFavoritesFeature extends BrowserEditorContribution {
	private static readonly StorageKey = 'workbench.browser.favorites';

	private readonly onDidChangeStateEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.onDidChangeStateEmitter.event;
	private readonly isFavoriteContext: ContextKey<boolean>;
	private readonly storageListenerStore = this._register(new DisposableStore());
	private urls = new Set<string>();

	constructor(
		editor: BrowserEditor,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(editor);
		editor.setFavoritesFeature(this);
		this.load();
		this.isFavoriteContext = CONTEXT_BROWSER_URL_IS_FAVORITED.bindTo(contextKeyService);
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

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		store.add(model.onDidNavigate(() => {
			this.refresh();
			this.onDidChangeStateEmitter.fire();
		}));
		this.refresh();
	}

	override onModelDetached(): void {
		this.isFavoriteContext.reset();
	}

	isFavorite(url: string): boolean {
		return this.urls.has(url);
	}

	get favorites(): readonly string[] {
		return [...this.urls];
	}

	toggleCurrent(): void {
		const url = this.editor.model?.url;
		if (!url) {
			throw new Error('The Browser editor has no current URL to favorite.');
		}
		this.toggle(url);
	}

	private refresh(): void {
		const url = this.editor.model?.url ?? '';
		const favorite = !!url && this.urls.has(url);
		this.isFavoriteContext.set(favorite);
	}

	private load(): void {
		const raw = this.storageService.get(BrowserFavoritesFeature.StorageKey, StorageScope.WORKSPACE);
		if (raw === undefined) {
			this.urls = new Set();
			return;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) {
			throw new Error('Stored Browser favorites must be an array of URLs.');
		}
		const urls = new Set(parsed);
		if (urls.size !== parsed.length) {
			throw new Error('Stored Browser favorites must not contain duplicate URLs.');
		}
		this.urls = urls;
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

	toggle(url: string): void {
		if (this.urls.has(url)) {
			this.urls.delete(url);
		} else {
			this.urls.add(url);
		}
		this.save();
	}

	remove(url: string): void {
		if (!this.urls.delete(url)) {
			return;
		}
		this.save();
	}
}

BrowserEditor.registerContribution(BrowserFavoritesFeature);

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
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: ContextKeyExpr.and(when, ActiveEditorFocusedContext.isEqualTo(true)),
				primary: KeyMod.CtrlCmd | KeyCode.KeyD,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): void {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The favorite action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserFavoritesFeature);
		if (!contribution) {
			throw new Error('The active Browser editor has no favorites contribution.');
		}
		contribution.toggleCurrent();
	}
}

registerAction2(ToggleFavoriteAction);
