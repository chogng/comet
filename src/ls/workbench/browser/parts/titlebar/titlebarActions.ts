import type { LocaleMessages } from 'language/locales';
import type { EditorPartProps } from 'ls/workbench/browser/parts/editor/editorPartView';
import type { EditorTopbarActionsViewProps } from 'ls/workbench/browser/parts/editor/editorTopbarActionsView';
import type { PrimaryBarFooterActionsProps, PrimaryBarFooterLayoutMode } from 'ls/workbench/browser/parts/primarybar/primarybarFooterActions';
import type { SidebarTopbarActionsProps } from 'ls/workbench/browser/parts/sidebar/sidebarTopbarActions';
import type { EditorOpenHandler } from 'ls/workbench/services/editor/common/editorOpenTypes';

export type PrimaryBarTitlebarLabels = Pick<
  PrimaryBarFooterActionsProps,
  'accountLabel' | 'moreLabel' | 'settingsLabel'
>;

export function resolvePrimaryBarFooterLayoutMode(props: {
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
}): PrimaryBarFooterLayoutMode | null {
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

export function createSidebarTitlebarActionsProps(params: {
  ui: LocaleMessages;
  isPrimarySidebarVisible: boolean;
  onTogglePrimarySidebar: () => void;
  onFocusAddressBar: () => void;
}): SidebarTopbarActionsProps {
  const {
    ui,
    isPrimarySidebarVisible,
    onTogglePrimarySidebar,
    onFocusAddressBar,
  } = params;

  return {
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

export function createPrimaryBarTitlebarLabels(
  ui: LocaleMessages,
): PrimaryBarTitlebarLabels {
  return {
    accountLabel: ui.appName,
    moreLabel: ui.agentbarToolbarMore,
    settingsLabel: ui.titlebarSettings,
  };
}

export function createPrimaryBarTitlebarActionsProps(params: {
  ui: LocaleMessages;
  isSettingsActive: boolean;
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
  onApplyLayoutAgent: () => void;
  onApplyLayoutFlow: () => void;
  onOpenSettings: () => void;
}): PrimaryBarFooterActionsProps {
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
    ...createPrimaryBarTitlebarLabels(ui),
    isSettingsActive,
    activeLayoutMode: isSettingsActive
      ? 'flow'
      : resolvePrimaryBarFooterLayoutMode({
          isAgentSidebarVisible,
          isEditorCollapsed,
        }),
    onApplyLayoutAgent,
    onApplyLayoutFlow,
    onOpenSettings,
  };
}
