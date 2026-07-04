import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { ResizableHTMLElement } from 'cs/base/browser/ui/resizable/resizable';

const MIN_FIGURE_WIDTH = 160;

function normalizeFigureWidth(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const roundedValue = Math.round(value);
  return roundedValue > 0 ? roundedValue : null;
}

type GetPos = () => number | undefined;

type FigureResizableControllerOptions = {
  view: EditorView;
  getPos: GetPos;
  figureElement: HTMLElement;
  mediaElement: ResizableHTMLElement;
  imageElement: HTMLImageElement;
  selectFigureNode: () => void;
};

export class FigureResizableController {
  private node: ProseMirrorNode;
  private readonly disposers: Array<() => void> = [];

  constructor(
    node: ProseMirrorNode,
    private readonly options: FigureResizableControllerOptions,
  ) {
    this.node = node;
    this.options.mediaElement.minSize = {
      width: MIN_FIGURE_WIDTH,
      height: 0,
    };
    this.options.mediaElement.enableSashes(false, true, false, false);

    this.disposers.push(
      this.options.mediaElement.onDidWillResize(this.handleResizeStart),
      this.options.mediaElement.onDidResize(this.handleResize),
    );
    this.options.imageElement.addEventListener('load', this.handleImageLoad);

    this.syncMediaLayout();
  }

  update(node: ProseMirrorNode) {
    this.node = node;
    this.syncMediaLayout();
  }

  isResizing() {
    return this.options.mediaElement.isResizing();
  }

  dispose() {
    this.options.figureElement.classList.remove('comet-pm-resizable-active');
    this.options.imageElement.removeEventListener('load', this.handleImageLoad);
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
  }

  private readonly handleResizeStart = () => {
    this.options.selectFigureNode();
    this.options.figureElement.classList.add('comet-pm-resizable-active');
  };

  private readonly handleResize = (event: { dimension: { width: number }; done: boolean }) => {
    if (!event.done) {
      return;
    }

    this.options.figureElement.classList.remove('comet-pm-resizable-active');
    this.commitWidth(event.dimension.width);
  };

  private readonly handleImageLoad = () => {
    this.syncMediaLayout();
  };

  private commitWidth(width: number) {
    const position = this.resolvePosition();
    if (position === null) {
      return;
    }

    const nextWidth = normalizeFigureWidth(width);
    const currentWidth = normalizeFigureWidth(this.node.attrs.width);
    if (nextWidth === currentWidth) {
      return;
    }

    this.options.view.dispatch(
      this.options.view.state.tr.setNodeMarkup(position, undefined, {
        ...this.node.attrs,
        width: nextWidth,
      }),
    );
  }

  private getRenderedWidth() {
    const mediaWidth = normalizeFigureWidth(
      this.options.mediaElement.domNode.getBoundingClientRect().width,
    );
    if (mediaWidth) {
      return mediaWidth;
    }

    return normalizeFigureWidth(this.options.imageElement.getBoundingClientRect().width);
  }

  private getRenderedHeight() {
    const mediaHeight = normalizeFigureWidth(
      this.options.mediaElement.domNode.getBoundingClientRect().height,
    );
    if (mediaHeight) {
      return mediaHeight;
    }

    return normalizeFigureWidth(this.options.imageElement.getBoundingClientRect().height);
  }

  private getMaximumWidth() {
    const currentWidth = normalizeFigureWidth(this.node.attrs.width) ?? this.getRenderedWidth();
    const editorClientWidth = normalizeFigureWidth(this.options.view.dom.clientWidth);
    if (editorClientWidth && (!currentWidth || editorClientWidth >= currentWidth)) {
      return editorClientWidth;
    }

    const editorMeasuredWidth = normalizeFigureWidth(
      this.options.view.dom.getBoundingClientRect().width,
    );
    if (editorMeasuredWidth && (!currentWidth || editorMeasuredWidth >= currentWidth)) {
      return editorMeasuredWidth;
    }

    return null;
  }

  private getWidthRatio() {
    const naturalWidth = normalizeFigureWidth(this.options.imageElement.naturalWidth);
    const naturalHeight = normalizeFigureWidth(this.options.imageElement.naturalHeight);
    if (naturalWidth && naturalHeight) {
      return naturalHeight / naturalWidth;
    }

    const renderedWidth = this.getRenderedWidth();
    const renderedHeight = this.getRenderedHeight();
    if (renderedWidth && renderedHeight) {
      return renderedHeight / renderedWidth;
    }

    return null;
  }

  private getAutoWidth() {
    const explicitWidth = normalizeFigureWidth(this.node.attrs.width);
    if (explicitWidth) {
      return explicitWidth;
    }

    const naturalWidth = normalizeFigureWidth(this.options.imageElement.naturalWidth);
    if (naturalWidth) {
      const maximumWidth = this.getMaximumWidth();
      if (maximumWidth) {
        return Math.min(naturalWidth, maximumWidth);
      }

      return naturalWidth;
    }

    return this.getRenderedWidth();
  }

  private syncMediaLayout() {
    const width = this.getAutoWidth();
    if (!width) {
      this.options.mediaElement.domNode.style.removeProperty('width');
      this.options.mediaElement.domNode.style.removeProperty('height');
      return;
    }

    const ratio = this.getWidthRatio();
    const height = ratio ? Math.max(1, Math.round(width * ratio)) : this.getRenderedHeight() ?? 1;
    this.options.imageElement.setAttribute('width', String(width));
    this.options.mediaElement.maxSize = {
      width: this.getMaximumWidth() ?? Number.MAX_SAFE_INTEGER,
      height: Number.MAX_SAFE_INTEGER,
    };
    this.options.mediaElement.layout(height, width);
  }

  private resolvePosition() {
    try {
      const position = this.options.getPos();
      return typeof position === 'number' ? position : null;
    } catch {
      return null;
    }
  }
}
