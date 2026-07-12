/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import type { SidebarFooterActionsProps, SidebarFooterLayoutMode } from 'cs/workbench/browser/parts/sidebar/sidebarFooterActions';
import type { TitlebarLeadingActionsProps } from 'cs/workbench/browser/parts/titlebar/titlebarPart';
export type SidebarFooterTitlebarLabels = Pick<
  SidebarFooterActionsProps,
  'accountLabel' | 'moreLabel' | 'settingsLabel'
>;

export type SidebarTitlebarLabels = {
  controlsAriaLabel: string;
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
  refresh: string;
};

export function resolveSidebarFooterLayoutMode(props: {
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
}): SidebarFooterLayoutMode | null {
  if (props.isEditorCollapsed) {
    return null;
  }

  return props.isAgentSidebarVisible ? 'agent' : 'flow';
}

export function resolveTitlebarAssistantToggleLabel(
  ui: LocaleMessages,
  isAgentSidebarVisible: boolean,
) {
  return isAgentSidebarVisible
    ? ui.titlebarHideAssistant
    : ui.titlebarShowAssistant;
}

export function resolveTitlebarPrimarySidebarToggleLabel(
  ui: LocaleMessages,
  isPrimarySidebarVisible: boolean,
) {
  return isPrimarySidebarVisible
    ? ui.titlebarHidePrimarySidebar
    : ui.titlebarShowPrimarySidebar;
}

export function resolveTitlebarSettingsLabel(ui: LocaleMessages) {
  return ui.titlebarSettings;
}

export function resolveTitlebarCloseLabel(ui: LocaleMessages) {
  return ui.titlebarClose;
}

export function createTitlebarLeadingActionsProps(params: {
  ui: LocaleMessages;
  isPrimarySidebarVisible: boolean;
  onTogglePrimarySidebar: () => void;
  onFocusAddressBar: () => void;
}): TitlebarLeadingActionsProps {
  const {
    ui,
    isPrimarySidebarVisible,
    onTogglePrimarySidebar,
    onFocusAddressBar,
  } = params;

  return {
    menuLabel: ui.titlebarMenu,
    isPrimarySidebarVisible,
    primarySidebarToggleLabel: resolveTitlebarPrimarySidebarToggleLabel(
      ui,
      isPrimarySidebarVisible,
    ),
    addressBarLabel: ui.agentbarToolbarAddressBar,
    onTogglePrimarySidebar,
    onFocusAddressBar,
  };
}

export function createSidebarTitlebarLabels(
  ui: LocaleMessages,
): SidebarTitlebarLabels {
  return {
    controlsAriaLabel: ui.titlebarControls,
    minimize: ui.titlebarMinimize,
    maximize: ui.titlebarMaximize,
    restore: ui.titlebarRestore,
    close: ui.titlebarClose,
    refresh: ui.titlebarRefresh,
  };
}

export function createSidebarFooterTitlebarLabels(
  ui: LocaleMessages,
): SidebarFooterTitlebarLabels {
  return {
    accountLabel: ui.appName,
    moreLabel: ui.agentbarToolbarMore,
    settingsLabel: resolveTitlebarSettingsLabel(ui),
  };
}

export function createSidebarFooterTitlebarActionsProps(params: {
  ui: LocaleMessages;
  isSettingsActive: boolean;
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
  onApplyLayoutAgent: () => void;
  onApplyLayoutFlow: () => void;
  onOpenSettings: () => void;
}): SidebarFooterActionsProps {
  const {
    ui,
    isSettingsActive,
    isAgentSidebarVisible,
    isEditorCollapsed,
    onApplyLayoutAgent,
    onApplyLayoutFlow,
    onOpenSettings,
  } = params;

  return {
    ...createSidebarFooterTitlebarLabels(ui),
    isSettingsActive,
    activeLayoutMode: isSettingsActive
      ? 'flow'
      : resolveSidebarFooterLayoutMode({
          isAgentSidebarVisible,
          isEditorCollapsed,
        }),
    onApplyLayoutAgent,
    onApplyLayoutFlow,
    onOpenSettings,
  };
}
