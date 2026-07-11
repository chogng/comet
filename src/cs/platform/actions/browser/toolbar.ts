/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from 'cs/base/browser/dom';
import {
  createActionBarView,
  type ActionBarItem,
  type ActionBarMenuItem,
  type ActionBarView,
} from 'cs/base/browser/ui/actionbar/actionbar';
import type { IHoverDelegate } from 'cs/base/browser/ui/hover/hover';
import { type IAction, Separator, SubmenuAction } from 'cs/base/common/actions';
import { Disposable } from 'cs/base/common/lifecycle';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { getActionBarActions } from 'cs/platform/actions/browser/menuEntryActionViewItem';
import { getMenuActions, MenuId, MenuRegistry } from 'cs/platform/actions/common/actions';
import type { IMenuActionOptions } from 'cs/platform/actions/common/actions';
import { IContextKeyService } from 'cs/platform/contextkey/common/contextkey';

export interface IToolBarRenderOptions {
	primaryGroup?: string | ((actionGroup: string) => boolean);
	shouldInlineSubmenu?: (action: SubmenuAction, group: string, groupSize: number) => boolean;
	useSeparatorsInPrimaryActions?: boolean;
}

export interface IMenuWorkbenchToolBarOptions {
	hoverDelegate?: IHoverDelegate;
	highlightToggledItems?: boolean;
	toolbarOptions?: IToolBarRenderOptions;
	menuOptions?: IMenuActionOptions;
}

export class MenuWorkbenchToolBar extends Disposable {
	private readonly actionsView: ActionBarView;
	private readonly menuOptions: IMenuActionOptions | undefined;
	private readonly toolbarOptions: IToolBarRenderOptions | undefined;
	private readonly hoverDelegate: IHoverDelegate | undefined;
	private actionContext: unknown;
	private actionsSignature: string | undefined;

	constructor(
		private readonly container: HTMLElement,
		private readonly menuId: MenuId,
		options: IMenuWorkbenchToolBarOptions | undefined,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this.menuOptions = options?.menuOptions;
		this.toolbarOptions = options?.toolbarOptions;
		this.hoverDelegate = options?.hoverDelegate;
		this.actionsView = this._register(createActionBarView({
			className: 'menu-workbench-toolbar',
			hoverService: this.hoverDelegate,
		}));
		append(container, this.actionsView.getElement());

		this._register(MenuRegistry.onDidChangeMenu(event => {
			if (event.has(this.menuId)) {
				this.refresh();
			}
		}));
		this._register(this.contextKeyService.onDidChangeContext(() => this.refresh()));
		this.refresh();
	}

	set context(value: unknown) {
		this.actionContext = value;
	}

	get context(): unknown {
		return this.actionContext;
	}

	getElement(): HTMLElement {
		return this.actionsView.getElement();
	}

	refresh(): void {
		const { primary, secondary } = getActionBarActions(
			getMenuActions(this.menuId, this.contextKeyService, this.menuOptions),
			this.toolbarOptions?.primaryGroup,
			this.toolbarOptions?.shouldInlineSubmenu,
			this.toolbarOptions?.useSeparatorsInPrimaryActions,
		);
		const items = Separator.join(primary, secondary).map(action => this.toActionBarItem(action));
		this.container.classList.toggle('has-no-actions', items.length === 0);
		const actionsSignature = this.getActionsSignature([...primary, ...secondary]);
		if (actionsSignature === this.actionsSignature) {
			return;
		}
		this.actionsSignature = actionsSignature;
		this.actionsView.setProps({
			className: 'menu-workbench-toolbar',
			hoverService: this.hoverDelegate,
			items,
		});
	}

	private toActionBarItem(action: IAction): ActionBarItem {
		if (action instanceof SubmenuAction) {
			const icon = action.class ? $('span', { class: action.class }) : undefined;
			return createDropdownMenuActionViewItem({
				id: action.id,
				label: action.label,
				title: action.tooltip || action.label,
				content: icon ?? action.label,
				mode: icon ? 'icon' : 'text',
				disabled: !action.enabled,
				menu: action.actions.map(submenuAction => this.toActionBarMenuItem(submenuAction)),
				hoverService: this.hoverDelegate,
				overlayAlignment: 'end',
				overlayPosition: 'below',
			});
		}

		if (action instanceof Separator) {
			return { type: 'separator' };
		}
		const icon = action.class ? $('span', { class: action.class }) : undefined;
		return {
			id: action.id,
			label: action.label,
			hover: action.tooltip || action.label,
			content: icon ?? action.label,
			mode: icon ? 'icon' : 'text',
			disabled: !action.enabled,
			checked: action.checked,
			run: () => action.run(this.actionContext),
		};
	}

	private toActionBarMenuItem(action: IAction): ActionBarMenuItem {
		const item: ActionBarMenuItem = {
			id: action.id,
			label: action.label,
			title: action.tooltip || action.label,
			disabled: !action.enabled,
			checked: action.checked,
			run: () => action.run(this.actionContext),
		};

		if (action instanceof SubmenuAction) {
			item.submenu = action.actions.map(submenuAction => this.toActionBarMenuItem(submenuAction));
		}

		return item;
	}

	private getActionsSignature(actions: readonly IAction[]): string {
		return JSON.stringify(actions.map(action => ({
			id: action.id,
			label: action.label,
			tooltip: action.tooltip,
			className: action.class,
			enabled: action.enabled,
			checked: action.checked,
			submenu: action instanceof SubmenuAction
				? this.getActionsSignature(action.actions)
				: undefined,
		})));
	}
}
