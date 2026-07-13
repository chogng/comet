/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { ISessionsSettingsOverlayService } from 'cs/sessions/services/settings/browser/settingsOverlayService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

const LayoutLabel = localize('sessions.sidebar.footer.layout', "Layout");
const AgentLayoutLabel = localize('sessions.sidebar.footer.layout.agent', "Agent");
const FlowLayoutLabel = localize('sessions.sidebar.footer.layout.flow', "Flow");

export class SidebarFooterActionsView extends Disposable {
	private readonly hostElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-footer-actions-host');
	private readonly accountLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-footer-account-label');
	private readonly actionBarView = this._register(createActionBarView({
		className: 'comet-sidebar-footer-actions',
		ariaRole: 'group',
	}));

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
		@ISessionsSettingsOverlayService private readonly settingsOverlayService: ISessionsSettingsOverlayService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		const accountElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-footer-account');
		const avatarElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-footer-avatar');
		avatarElement.append(createLxIcon('account'));
		accountElement.append(avatarElement, this.accountLabelElement);
		this.hostElement.append(accountElement, this.actionBarView.getElement());
		this._register(this.layoutService.onDidChangeLayoutState(this.render, this));
		this._register(this.settingsOverlayService.onDidChangeVisibility(this.render, this));
		this._register(toDisposable(this.localeService.subscribe(this.render)));
		this.render();
	}

	getElement(): HTMLElement {
		return this.hostElement;
	}

	override dispose(): void {
		this.hostElement.replaceChildren();
		super.dispose();
	}

	private readonly render = (): void => {
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		const layoutState = this.layoutService.getLayoutState();
		const isSettingsVisible = this.settingsOverlayService.isVisible();
		const activeLayoutMode = isSettingsVisible
			? 'flow'
			: layoutState.isEditorCollapsed
				? null
				: layoutState.mode;

		this.accountLabelElement.textContent = ui.appName;
		this.actionBarView.setProps({
			className: 'comet-sidebar-footer-actions',
			ariaRole: 'group',
			items: [
				createDropdownMenuActionViewItem({
					contextMenuService: this.contextMenuService,
					contextViewProvider: this.contextViewService,
					label: ui.agentbarToolbarMore,
					title: ui.agentbarToolbarMore,
					mode: 'icon',
					buttonClassName: 'comet-sidebar-footer-more-btn',
					content: createLxIcon('more-2'),
					menuClassName: 'comet-sidebar-footer-more-menu-overlay',
					minWidth: 160,
					menuData: 'comet-sidebar-footer-more',
					menu: [{
						id: 'comet-sidebar-footer-more-layout',
						label: LayoutLabel,
						icon: 'layout',
						submenu: [
							{
								id: 'comet-sidebar-footer-more-layout-agent',
								label: AgentLayoutLabel,
								checked: activeLayoutMode === 'agent',
								onClick: () => this.layoutService.applyLayoutMode('agent'),
							},
							{
								id: 'comet-sidebar-footer-more-layout-flow',
								label: FlowLayoutLabel,
								checked: activeLayoutMode === 'flow',
								onClick: () => this.layoutService.applyLayoutMode('flow'),
							},
						],
					}],
				}),
				{
					label: ui.titlebarSettings,
					title: ui.titlebarSettings,
					mode: 'icon',
					active: isSettingsVisible,
					buttonClassName: 'comet-sidebar-footer-settings-btn',
					content: createLxIcon('gear'),
					onClick: () => this.settingsOverlayService.toggleVisibility(),
				},
			],
		});
	};
}
