export type TopbarActionRouteMode = 'content' | 'settings';

export type TopbarActionSource = 'sidebar' | 'editorAuxiliary';
export type TopbarActionTarget = 'primary' | 'agent' | 'editor' | null;

export type TopbarActionRouterState = {
  mode?: TopbarActionRouteMode;
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
};

export type TopbarActionRoute = {
  sidebarTarget: TopbarActionTarget;
  editorAuxiliaryTarget: TopbarActionTarget;
  editorActionOrder: readonly TopbarActionSource[];
};

const DEFAULT_EDITOR_ACTION_ORDER: readonly TopbarActionSource[] = [
  'sidebar',
  'editorAuxiliary',
];

function resolveMode(mode: TopbarActionRouterState['mode']) {
  return mode === 'settings' ? 'settings' : 'content';
}

export function resolveTopbarActionRoute(
  state: TopbarActionRouterState,
): TopbarActionRoute {
  if (resolveMode(state.mode) === 'settings') {
    return {
      sidebarTarget: null,
      editorAuxiliaryTarget: null,
      editorActionOrder: DEFAULT_EDITOR_ACTION_ORDER,
    };
  }

  let sidebarTarget: TopbarActionTarget = 'primary';
  if (!state.isPrimarySidebarVisible) {
    sidebarTarget = state.isAgentSidebarVisible ? 'agent' : 'editor';
  }

  let editorAuxiliaryTarget: TopbarActionTarget = null;
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
