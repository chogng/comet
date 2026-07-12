/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { Disposable } from 'cs/base/common/lifecycle';
import { localize, localize2 } from 'cs/nls';
import { Categories } from 'cs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import { SessionsLayoutCommandIds } from 'cs/sessions/common/layoutCommands';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

/** Registers Sessions layout actions against the injected product layout owner. */
export class SessionsLayoutActionsContribution extends Disposable {
	constructor(
		@ISessionsLayoutService layoutService: ISessionsLayoutService,
	) {
		super();
		this._register(registerAction2(class ApplyAgentLayoutAction extends Action2 {
			constructor() {
				super({
					id: SessionsLayoutCommandIds.applyAgentLayout,
					title: localize2('applyAgentLayout', "Apply Agent Layout"),
					category: Categories.View,
					f1: true,
				});
			}

			run(): void {
				layoutService.applyLayoutMode('agent');
			}
		}));
		this._register(registerAction2(class ApplyFlowLayoutAction extends Action2 {
			constructor() {
				super({
					id: SessionsLayoutCommandIds.applyFlowLayout,
					title: localize2('applyFlowLayout', "Apply Flow Layout"),
					category: Categories.View,
					f1: true,
				});
			}

			run(): void {
				layoutService.applyLayoutMode('flow');
			}
		}));
		this._register(registerAction2(class ToggleSidebarVisibilityAction extends Action2 {
			constructor() {
				super({
					id: SessionsLayoutCommandIds.toggleSidebarVisibility,
					title: localize2('toggleSidebar', "Toggle Primary Side Bar Visibility"),
					toggled: {
						condition: SessionsContextKeys.sidebarVisible.isEqualTo(true),
						title: localize('primary sidebar', "Primary Side Bar"),
						mnemonicTitle: localize(
							{
								key: 'primary sidebar mnemonic',
								comment: ['&& denotes a mnemonic'],
							},
							"&&Primary Side Bar",
						),
					},
					metadata: {
						description: localize('openAndCloseSidebar', 'Open/Show and Close/Hide Sidebar'),
					},
					category: Categories.View,
					f1: true,
					keybinding: {
						weight: KeybindingWeight.SessionsContrib,
						primary: KeyMod.CtrlCmd | KeyCode.KeyB,
					},
				});
			}

			run(): void {
				layoutService.toggleSidebarVisibility();
			}
		}));
		this._register(registerAction2(class ToggleEditorCollapsedAction extends Action2 {
			constructor() {
				super({
					id: SessionsLayoutCommandIds.toggleEditorCollapsed,
					title: localize2('toggleEditorCollapsed', "Toggle Editor Collapsed"),
					category: Categories.View,
					f1: true,
				});
			}

			run(_accessor: ServicesAccessor, expandedEditorSize?: number): void {
				layoutService.toggleEditorCollapsed(expandedEditorSize);
			}
		}));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(SessionsLayoutActionsContribution),
);
