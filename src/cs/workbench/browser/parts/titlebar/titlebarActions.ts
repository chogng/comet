import type { LocaleMessages } from 'language/locales';
import type { EditorPartLabels, EditorPartProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorTopbarActionsViewProps } from 'cs/workbench/browser/parts/editor/editorTopbarActionsView';
import type { SidebarFooterActionsProps, SidebarFooterLayoutMode } from 'cs/workbench/browser/parts/sidebar/sidebarFooterActions';
import type { TitlebarLeadingActionsProps } from 'cs/workbench/browser/parts/titlebar/titlebarPart';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorOpenTypes';

export type SidebarFooterTitlebarLabels = Pick<
  SidebarFooterActionsProps,
  'accountLabel' | 'moreLabel' | 'settingsLabel'
>;

export type EditorBrowserToolbarTitlebarLabels = Pick<
  EditorPartLabels,
  'toolbarBack' | 'toolbarForward' | 'toolbarRefresh' | 'toolbarExportDocx'
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

export function createEditorTitlebarActionsProps(params: {
  ui: LocaleMessages;
  editorPartProps: EditorPartProps;
  isAgentSidebarVisible: boolean;
  showAgentSidebarToggle: boolean;
  onOpenEditor: EditorOpenHandler;
  onToggleEditorCollapse: () => void;
  onToggleAgentSidebar: () => void;
}): EditorTopbarActionsViewProps {
  const {
    ui,
    editorPartProps,
    isAgentSidebarVisible,
    showAgentSidebarToggle,
    onOpenEditor,
    onToggleEditorCollapse,
    onToggleAgentSidebar,
  } = params;

  return {
    isEditorCollapsed: true,
    isAgentSidebarVisible,
    showAgentSidebarToggle,
    agentSidebarToggleLabel: resolveTitlebarAssistantToggleLabel(
      ui,
      isAgentSidebarVisible,
    ),
    labels: {
      topbarAddAction: editorPartProps.labels.topbarAddAction,
      createDraft: editorPartProps.labels.createDraft,
      createBrowser: editorPartProps.labels.createBrowser,
      createFile: editorPartProps.labels.createFile,
      expandEditor: editorPartProps.labels.expandEditor,
      collapseEditor: editorPartProps.labels.collapseEditor,
    },
    onOpenEditor,
    onToggleEditorCollapse,
    onToggleAgentSidebar,
  };
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

export function createEditorBrowserToolbarTitlebarLabels(
  ui: LocaleMessages,
): EditorBrowserToolbarTitlebarLabels {
  return {
    toolbarBack: ui.titlebarBack,
    toolbarForward: ui.titlebarForward,
    toolbarRefresh: ui.titlebarRefresh,
    toolbarExportDocx: ui.titlebarExportDocx,
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
