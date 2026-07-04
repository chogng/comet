export { ScrollbarVisibility } from 'ls/base/common/scrollable';
import { ScrollbarVisibility } from 'ls/base/common/scrollable';

export interface ScrollableElementCreationOptions {
  className?: string;
  useShadows?: boolean;
  handleMouseWheel?: boolean;
  mouseWheelSmoothScroll?: boolean;
  flipAxes?: boolean;
  scrollYToX?: boolean;
  consumeMouseWheelIfScrollbarIsNeeded?: boolean;
  alwaysConsumeMouseWheel?: boolean;
  mouseWheelScrollSensitivity?: number;
  fastScrollSensitivity?: number;
  scrollPredominantAxis?: boolean;
  listenOnDomNode?: HTMLElement;
  horizontal?: ScrollbarVisibility;
  horizontalScrollbarSize?: number;
  vertical?: ScrollbarVisibility;
  verticalScrollbarSize?: number;
  scrollByPage?: boolean;
}

export interface ScrollableElementChangeOptions {
  className?: string;
  handleMouseWheel?: boolean;
  horizontal?: ScrollbarVisibility;
  horizontalScrollbarSize?: number;
  vertical?: ScrollbarVisibility;
  verticalScrollbarSize?: number;
  mouseWheelScrollSensitivity?: number;
  fastScrollSensitivity?: number;
  scrollByPage?: boolean;
}

export interface ScrollableElementResolvedOptions {
  className: string;
  useShadows: boolean;
  handleMouseWheel: boolean;
  mouseWheelSmoothScroll: boolean;
  flipAxes: boolean;
  scrollYToX: boolean;
  consumeMouseWheelIfScrollbarIsNeeded: boolean;
  alwaysConsumeMouseWheel: boolean;
  mouseWheelScrollSensitivity: number;
  fastScrollSensitivity: number;
  scrollPredominantAxis: boolean;
  listenOnDomNode: HTMLElement | null;
  horizontal: ScrollbarVisibility;
  horizontalScrollbarSize: number;
  vertical: ScrollbarVisibility;
  verticalScrollbarSize: number;
  scrollByPage: boolean;
}

export function resolveScrollableElementOptions(
  options: ScrollableElementCreationOptions = {},
): ScrollableElementResolvedOptions {
  return {
    className: options.className ?? '',
    useShadows: options.useShadows ?? false,
    handleMouseWheel: options.handleMouseWheel ?? true,
    mouseWheelSmoothScroll: options.mouseWheelSmoothScroll ?? false,
    flipAxes: options.flipAxes ?? false,
    scrollYToX: options.scrollYToX ?? false,
    consumeMouseWheelIfScrollbarIsNeeded:
      options.consumeMouseWheelIfScrollbarIsNeeded ?? false,
    alwaysConsumeMouseWheel: options.alwaysConsumeMouseWheel ?? false,
    mouseWheelScrollSensitivity: options.mouseWheelScrollSensitivity ?? 1,
    fastScrollSensitivity: options.fastScrollSensitivity ?? 5,
    scrollPredominantAxis: options.scrollPredominantAxis ?? true,
    listenOnDomNode: options.listenOnDomNode ?? null,
    horizontal: options.horizontal ?? ScrollbarVisibility.Auto,
    horizontalScrollbarSize: options.horizontalScrollbarSize ?? 10,
    vertical: options.vertical ?? ScrollbarVisibility.Auto,
    verticalScrollbarSize: options.verticalScrollbarSize ?? 10,
    scrollByPage: options.scrollByPage ?? false,
  };
}
