export type HeaderActionRouteMode = 'content' | 'settings';

export type HeaderActionSource = 'sidebar' | 'editorAuxiliary';
export type HeaderActionTarget = 'primary' | 'agent' | 'editor' | null;

export type HeaderActionRouterState = {
  mode?: HeaderActionRouteMode;
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
};

export type HeaderActionRoute = {
  sidebarTarget: HeaderActionTarget;
  editorAuxiliaryTarget: HeaderActionTarget;
  editorActionOrder: readonly HeaderActionSource[];
};

const DEFAULT_EDITOR_ACTION_ORDER: readonly HeaderActionSource[] = [
  'sidebar',
  'editorAuxiliary',
];

function resolveMode(mode: HeaderActionRouterState['mode']) {
  return mode === 'settings' ? 'settings' : 'content';
}

export function resolveHeaderActionRoute(
  state: HeaderActionRouterState,
): HeaderActionRoute {
  if (resolveMode(state.mode) === 'settings') {
    return {
      sidebarTarget: null,
      editorAuxiliaryTarget: null,
      editorActionOrder: DEFAULT_EDITOR_ACTION_ORDER,
    };
  }

  let sidebarTarget: HeaderActionTarget = 'primary';
  if (!state.isPrimarySidebarVisible) {
    sidebarTarget = state.isAgentSidebarVisible ? 'agent' : 'editor';
  }

  let editorAuxiliaryTarget: HeaderActionTarget = null;
  if (state.isEditorCollapsed) {
    editorAuxiliaryTarget = state.isAgentSidebarVisible
      ? 'agent'
      : state.isPrimarySidebarVisible
        ? 'primary'
        : 'editor';
  }

  return {
    sidebarTarget,
    editorAuxiliaryTarget,
    editorActionOrder: DEFAULT_EDITOR_ACTION_ORDER,
  };
}
