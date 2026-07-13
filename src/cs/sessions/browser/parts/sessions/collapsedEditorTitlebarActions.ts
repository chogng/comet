/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { getEditorCreationActions } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import { createEditorTitlebarActionsView } from 'cs/workbench/browser/parts/editor/editorTitlebarActionsView';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';

export class CollapsedEditorTitlebarActionsView extends Disposable {
	private readonly actionsView: ReturnType<typeof createEditorTitlebarActionsView>;

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.actionsView = this._register(createEditorTitlebarActionsView(this.createViewProps()));
		this._register(this.layoutService.onDidChangeLayoutState(this.render, this));
		this._register(toDisposable(this.localeService.subscribe(this.render)));
		this.render();
	}

	getElement(): HTMLElement {
		return this.actionsView.getElement();
	}

	private readonly render = (): void => {
		const element = this.actionsView.getElement();
		element.hidden = !this.layoutService.getLayoutState().isEditorCollapsed;
		this.actionsView.setProps(this.createViewProps());
	};

	private createViewProps(): Parameters<typeof createEditorTitlebarActionsView>[0] {
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		return {
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewService,
			isEditorCollapsed: true,
			labels: {
				headerAddAction: ui.editorHeaderAddAction,
				expandEditor: ui.editorExpand,
				collapseEditor: ui.editorCollapse,
			},
			creationActions: getEditorCreationActions(ui),
			commandService: this.commandService,
			onToggleEditorCollapse: () => this.layoutService.toggleEditorCollapsed(),
		};
	}
}
