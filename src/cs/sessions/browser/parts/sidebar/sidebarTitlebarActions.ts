/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { createActionBarView, type ActionBarItem } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { isMacintosh, isWeb } from 'cs/base/common/platform';
import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

export class SidebarTitlebarActionsView extends Disposable {
	private readonly actionBarView = this._register(createActionBarView({
		className: 'comet-titlebar-leading-actions',
		ariaRole: 'group',
	}));

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		this._register(this.layoutService.onDidChangeLayoutState(this.render, this));
		this._register(toDisposable(this.localeService.subscribe(this.render)));
		this.render();
	}

	getElement(): HTMLElement {
		return this.actionBarView.getElement();
	}

	private readonly render = (): void => {
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		const isSidebarVisible = this.layoutService.getLayoutState().isSidebarVisible;
		const items: ActionBarItem[] = [];

		if (!isMacintosh || isWeb) {
			items.push(createDropdownMenuActionViewItem({
				contextMenuService: this.contextMenuService,
				contextViewProvider: this.contextViewService,
				label: ui.titlebarMenu,
				title: ui.titlebarMenu,
				mode: 'icon',
				buttonClassName: 'comet-titlebar-menu-btn',
				content: createLxIcon('three-bars'),
				renderOverlay: () => {
					const element = $<HTMLElementTagNameMap['div']>('div.comet-titlebar-main-menu');
					element.setAttribute('role', 'menu');
					return element;
				},
				overlayRole: 'menu',
				menuClassName: 'comet-titlebar-main-menu-overlay',
				menuData: 'titlebar-main-menu',
				minWidth: 180,
				overlayAlignmentPolicy: 'prefer-start',
			}));
		}

		const toggleLabel = isSidebarVisible
			? ui.titlebarHidePrimarySidebar
			: ui.titlebarShowPrimarySidebar;
		items.push({
			label: toggleLabel,
			title: toggleLabel,
			mode: 'icon',
			buttonClassName: 'comet-titlebar-primary-sidebar-toggle-btn',
			content: createLxIcon(
				isSidebarVisible ? 'layout-sidebar-left' : 'layout-sidebar-left-off',
			),
			onClick: () => this.layoutService.toggleSidebarVisibility(),
		});
		items.push({
			label: ui.agentbarToolbarAddressBar,
			title: ui.agentbarToolbarAddressBar,
			mode: 'icon',
			buttonClassName: 'comet-titlebar-address-bar-btn',
			content: createLxIcon('search'),
			onClick: () => {
				void this.editorService.openEditor({
					resource: BrowserViewUri.forId(generateUuid()),
				});
				this.editorGroupsService.mainPart.focusPrimaryInput();
			},
		});

		this.actionBarView.setProps({
			className: 'comet-titlebar-leading-actions',
			ariaRole: 'group',
			items,
		});
	};
}
