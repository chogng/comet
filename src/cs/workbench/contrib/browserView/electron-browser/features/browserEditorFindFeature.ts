/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, trackFocus } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { Codicon } from 'cs/base/common/codicons';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { ThemeIcon } from 'cs/base/common/themables';
import { localize, localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { ContextKeyExpr, IContextKeyService, RawContextKey, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import { IInstantiationService, type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	CONTEXT_BROWSER_HAS_ERROR,
	CONTEXT_BROWSER_HAS_URL,
	type IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

const CONTEXT_BROWSER_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('browserFindWidgetVisible', false);
const CONTEXT_BROWSER_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('browserFindWidgetFocused', false);

class BrowserFindWidget extends Disposable {
	readonly element: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly matchCaseInput: HTMLInputElement;
	private readonly resultLabel: HTMLElement;
	private readonly previousButton: ButtonView;
	private readonly nextButton: ButtonView;
	private readonly closeButton: ButtonView;
	private readonly modelDisposables = this._register(new DisposableStore());
	private readonly visibleContext: ContextKey<boolean>;
	private readonly focusedContext: ContextKey<boolean>;
	private model: IBrowserViewModel | undefined;
	private lastResult: { resultIndex: number; resultCount: number } | undefined;
	private visible = false;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.visibleContext = CONTEXT_BROWSER_FIND_WIDGET_VISIBLE.bindTo(contextKeyService);
		this.focusedContext = CONTEXT_BROWSER_FIND_WIDGET_FOCUSED.bindTo(contextKeyService);

		this.element = $('.browser-find-widget-wrapper');
		const form = $('div.browser-find-widget');
		this.input = $('input.browser-find-input') as HTMLInputElement;
		this.input.type = 'search';
		this.input.placeholder = localize('browser.findInputPlaceholder', "Find");
		this.input.setAttribute('aria-label', localize('browser.findInputLabel', "Find"));
		this.resultLabel = $('span.browser-find-results');

		const matchCaseLabel = $('label.browser-find-case-sensitive');
		this.matchCaseInput = $('input') as HTMLInputElement;
		this.matchCaseInput.type = 'checkbox';
		this.matchCaseInput.setAttribute('aria-label', localize('browser.matchCaseLabel', "Match Case"));
		matchCaseLabel.append(this.matchCaseInput, $('span', undefined, 'Aa'));

		this.previousButton = this._register(new ButtonView({
			className: 'browser-find-button',
			variant: 'ghost',
			size: 'icon',
			mode: 'icon',
			content: $('span', { class: ThemeIcon.asClassName(Codicon.chevronUp) }),
			ariaLabel: localize('browser.previousMatchButton', "Previous Match"),
			hover: localize('browser.previousMatchButton', "Previous Match"),
			onClick: () => this.find(true),
		}));
		this.nextButton = this._register(new ButtonView({
			className: 'browser-find-button',
			variant: 'ghost',
			size: 'icon',
			mode: 'icon',
			content: $('span', { class: ThemeIcon.asClassName(Codicon.chevronDown) }),
			ariaLabel: localize('browser.nextMatchButton', "Next Match"),
			hover: localize('browser.nextMatchButton', "Next Match"),
			onClick: () => this.find(false),
		}));
		this.closeButton = this._register(new ButtonView({
			className: 'browser-find-button',
			variant: 'ghost',
			size: 'icon',
			mode: 'icon',
			content: $('span', { class: ThemeIcon.asClassName(Codicon.close) }),
			ariaLabel: localize('browser.closeFindButton', "Close"),
			hover: localize('browser.closeFindButton', "Close"),
			onClick: () => this.hide(),
		}));

		form.append(
			this.input,
			this.resultLabel,
			matchCaseLabel,
			this.previousButton.getElement(),
			this.nextButton.getElement(),
			this.closeButton.getElement(),
		);
		this.element.append(form);

		this._register(addDisposableListener(this.input, 'input', () => this.findFirst()));
		this._register(addDisposableListener(this.matchCaseInput, 'change', () => this.findFirst()));
		this._register(addDisposableListener(form, 'keydown', event => this.handleKeydown(event as KeyboardEvent)));
		const focusTracker = this._register(trackFocus(form));
		this._register(focusTracker.onDidFocus(() => this.focusedContext.set(true)));
		this._register(focusTracker.onDidBlur(() => this.focusedContext.reset()));
		this.render();
	}

	setModel(model: IBrowserViewModel | undefined): void {
		this.modelDisposables.clear();
		this.model = model;
		this.lastResult = undefined;
		if (model) {
			this.modelDisposables.add(model.onDidFindInPage(result => {
				this.lastResult = {
					resultIndex: result.activeMatchOrdinal,
					resultCount: result.matches,
				};
				this.render();
			}));
			this.modelDisposables.add(model.onWillDispose(() => this.setModel(undefined)));
		}
		this.render();
	}

	reveal(initialInput?: string): void {
		if (initialInput) {
			this.input.value = initialInput;
		}
		this.visible = true;
		this.visibleContext.set(true);
		this.element.classList.add('visible');
		this.input.focus();
		this.input.select();
		this.findFirst();
		this.render();
	}

	hide(): void {
		if (!this.visible) {
			return;
		}
		this.visible = false;
		this.visibleContext.reset();
		this.focusedContext.reset();
		this.element.classList.remove('visible');
		this.lastResult = undefined;
		void this.model?.stopFindInPage(true);
		void this.model?.focus();
		this.render();
	}

	find(previous: boolean): void {
		const value = this.input.value;
		if (!value || !this.model) {
			return;
		}
		void this.model.findInPage(value, {
			forward: !previous,
			recompute: false,
			matchCase: this.matchCaseInput.checked,
		});
	}

	findFirst(): void {
		const value = this.input.value;
		if (!this.model) {
			return;
		}
		if (!value) {
			this.lastResult = undefined;
			void this.model.stopFindInPage(false);
			this.render();
			return;
		}
		void this.model.findInPage(value, {
			forward: true,
			recompute: true,
			matchCase: this.matchCaseInput.checked,
		});
	}

	layout(width: number): void {
		this.element.style.maxWidth = `${Math.max(0, width)}px`;
	}

	private handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			this.hide();
			event.preventDefault();
			return;
		}
		if (event.key === 'Enter') {
			this.find(event.shiftKey);
			event.preventDefault();
		}
	}

	private render(): void {
		const hasInput = this.input.value.length > 0;
		const hasMatches = (this.lastResult?.resultCount ?? 0) > 0;
		this.previousButton.setProps({
			className: 'browser-find-button',
			variant: 'ghost',
			size: 'icon',
			mode: 'icon',
			content: $('span', { class: ThemeIcon.asClassName(Codicon.chevronUp) }),
			ariaLabel: localize('browser.previousMatchButton', "Previous Match"),
			hover: localize('browser.previousMatchButton', "Previous Match"),
			disabled: !hasInput || !hasMatches,
			onClick: () => this.find(true),
		});
		this.nextButton.setProps({
			className: 'browser-find-button',
			variant: 'ghost',
			size: 'icon',
			mode: 'icon',
			content: $('span', { class: ThemeIcon.asClassName(Codicon.chevronDown) }),
			ariaLabel: localize('browser.nextMatchButton', "Next Match"),
			hover: localize('browser.nextMatchButton', "Next Match"),
			disabled: !hasInput || !hasMatches,
			onClick: () => this.find(false),
		});
		if (!hasInput) {
			this.resultLabel.textContent = '';
		} else if (!hasMatches) {
			this.resultLabel.textContent = localize('browser.findNoResults', "No Results");
		} else {
			this.resultLabel.textContent = localize(
				'browser.findMatchCount',
				"{0} of {1}",
				this.lastResult?.resultIndex ?? 0,
				this.lastResult?.resultCount ?? 0,
			);
		}
	}
}

export class BrowserEditorFindContribution extends BrowserEditorContribution {
	private readonly findWidget: BrowserFindWidget;

	constructor(
		editor: BrowserEditor,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(editor);
		this.findWidget = this._register(instantiationService.createInstance(BrowserFindWidget));
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{ location: BrowserWidgetLocation.Toolbar, element: this.findWidget.element, order: 0 }];
	}

	protected override onModelAttached(model: IBrowserViewModel, _store: DisposableStore): void {
		this.findWidget.setModel(model);
	}

	override onModelDetached(): void {
		this.findWidget.setModel(undefined);
		this.findWidget.hide();
	}

	override onPaneResized(width: number): void {
		this.findWidget.layout(width);
	}

	async showFind(): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			throw new Error('The Browser find contribution has no attached model.');
		}
		const selectedText = (await model.getSelectedText()).trim();
		const initialInput = selectedText && !/[\r\n]/.test(selectedText) ? selectedText : undefined;
		this.findWidget.reveal(initialInput);
	}

	hideFind(): void {
		this.findWidget.hide();
	}

	findNext(): void {
		this.findWidget.find(false);
	}

	findPrevious(): void {
		this.findWidget.find(true);
	}
}

BrowserEditor.registerContribution(BrowserEditorFindContribution);

const browserCanShowFindAction = ContextKeyExpr.and(
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
	CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false),
);

class ShowBrowserFindAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ShowFind;

	constructor() {
		super({
			id: ShowBrowserFindAction.ID,
			title: localize2('browser.showFindAction', "Find in Page"),
			category: BrowserActionCategory,
			icon: Codicon.search,
			f1: true,
			precondition: browserCanShowFindAction,
			keybinding: {
				when: ActiveEditorFocusedContext.isEqualTo(true),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The find action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorFindContribution);
		if (!contribution) {
			throw new Error('The active Browser editor has no find contribution.');
		}
		await contribution.showFind();
	}
}

class HideBrowserFindAction extends Action2 {
	static readonly ID = BrowserViewCommandId.HideFind;

	constructor() {
		super({
			id: HideBrowserFindAction.ID,
			title: localize2('browser.hideFindAction', "Close Find Widget"),
			category: BrowserActionCategory,
			f1: false,
			precondition: ContextKeyExpr.and(
				BROWSER_EDITOR_ACTIVE,
				CONTEXT_BROWSER_FIND_WIDGET_VISIBLE.isEqualTo(true),
			),
			keybinding: {
				when: ActiveEditorFocusedContext.isEqualTo(true),
				weight: KeybindingWeight.EditorContrib + 5,
				primary: KeyCode.Escape,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): void {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The hide find action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorFindContribution);
		if (!contribution) {
			throw new Error('The active Browser editor has no find contribution.');
		}
		contribution.hideFind();
	}
}

class BrowserFindNextAction extends Action2 {
	static readonly ID = BrowserViewCommandId.FindNext;

	constructor() {
		super({
			id: BrowserFindNextAction.ID,
			title: localize2('browser.findNextAction', "Find Next"),
			category: BrowserActionCategory,
			f1: false,
			precondition: BROWSER_EDITOR_ACTIVE,
			keybinding: [{
				when: ContextKeyExpr.and(
					ActiveEditorFocusedContext.isEqualTo(true),
					CONTEXT_BROWSER_FIND_WIDGET_FOCUSED.isEqualTo(true),
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Enter,
			}, {
				when: ContextKeyExpr.and(
					ActiveEditorFocusedContext.isEqualTo(true),
					CONTEXT_BROWSER_FIND_WIDGET_VISIBLE.isEqualTo(true),
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyG },
			}],
		});
	}

	run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): void {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The find next action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorFindContribution);
		if (!contribution) {
			throw new Error('The active Browser editor has no find contribution.');
		}
		contribution.findNext();
	}
}

class BrowserFindPreviousAction extends Action2 {
	static readonly ID = BrowserViewCommandId.FindPrevious;

	constructor() {
		super({
			id: BrowserFindPreviousAction.ID,
			title: localize2('browser.findPreviousAction', "Find Previous"),
			category: BrowserActionCategory,
			f1: false,
			precondition: BROWSER_EDITOR_ACTIVE,
			keybinding: [{
				when: ContextKeyExpr.and(
					ActiveEditorFocusedContext.isEqualTo(true),
					CONTEXT_BROWSER_FIND_WIDGET_FOCUSED.isEqualTo(true),
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.Enter,
			}, {
				when: ContextKeyExpr.and(
					ActiveEditorFocusedContext.isEqualTo(true),
					CONTEXT_BROWSER_FIND_WIDGET_VISIBLE.isEqualTo(true),
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG },
			}],
		});
	}

	run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): void {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The find previous action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorFindContribution);
		if (!contribution) {
			throw new Error('The active Browser editor has no find contribution.');
		}
		contribution.findPrevious();
	}
}

registerAction2(ShowBrowserFindAction);
registerAction2(HideBrowserFindAction);
registerAction2(BrowserFindNextAction);
registerAction2(BrowserFindPreviousAction);
