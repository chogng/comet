import { Orientation } from 'ls/base/browser/ui/splitview/splitview';

export const WORKBENCH_SPLITVIEW_LIMITS = {
  sidebar: {
    minimum: 170,
    maximum: Number.POSITIVE_INFINITY,
    defaultSize: 220,
  },
  editor: {
    minimum: 220,
    maximum: Number.POSITIVE_INFINITY,
  },
  agentSidebar: {
    minimum: 332,
    maximum: Number.POSITIVE_INFINITY,
    defaultSize: 360,
  },
} as const;

export type LayoutAxisLimits = {
  minimum: number;
  maximum: number;
};

export type LayoutLimits = {
  primarySidebar: LayoutAxisLimits;
  editor: LayoutAxisLimits;
  agentSidebar: LayoutAxisLimits;
};

const MOBILE_SPLITVIEW_LIMITS = {
  sidebar: {
    minimum: 160,
    maximum: Number.POSITIVE_INFINITY,
  },
  editor: {
    minimum: 180,
    maximum: Number.POSITIVE_INFINITY,
  },
  agentSidebar: {
    minimum: 160,
    maximum: Number.POSITIVE_INFINITY,
  },
} as const;

export function getLayoutLimits(
  orientation: Orientation,
): LayoutLimits {
  const desktop = WORKBENCH_SPLITVIEW_LIMITS;
  const isHorizontal = orientation === Orientation.HORIZONTAL;

  return {
    primarySidebar: {
      minimum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.sidebar.minimum
        : desktop.sidebar.minimum,
      maximum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.sidebar.maximum
        : desktop.sidebar.maximum,
    },
    editor: {
      minimum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.editor.minimum
        : desktop.editor.minimum,
      maximum: desktop.editor.maximum,
    },
    agentSidebar: {
      minimum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.agentSidebar.minimum
        : desktop.agentSidebar.minimum,
      maximum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.agentSidebar.maximum
        : desktop.agentSidebar.maximum,
    },
  };
}
