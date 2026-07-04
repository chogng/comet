import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { ResizableHTMLElement } from 'cs/base/browser/ui/resizable/resizable';
import { FigureResizableController } from 'cs/editor/browser/text/figureResizableController';
import type { FigureNodeAttrs } from 'cs/editor/browser/text/schema';

type GetPos = () => number | undefined;

export class FigureNodeView implements NodeView {
  node: ProseMirrorNode;
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private readonly mediaElement: ResizableHTMLElement;
  private readonly imageElement: HTMLImageElement;
  private readonly resizeHandleElement: HTMLElement;
  private readonly resizeController: FigureResizableController;

  constructor(node: ProseMirrorNode, private readonly view: EditorView, private readonly getPos: GetPos) {
    this.node = node;

    const ownerDocument = view.dom.ownerDocument;
    this.dom = ownerDocument.createElement('figure');
    this.dom.className = 'pm-figure';
    this.dom.setAttribute('data-editor-figure', 'true');

    this.mediaElement = new ResizableHTMLElement();
    this.mediaElement.domNode.className = 'pm-figure-media';
    this.mediaElement.domNode.contentEditable = 'false';

    this.imageElement = ownerDocument.createElement('img');
    this.imageElement.className = 'pm-figure-image';
    this.imageElement.draggable = false;

    this.resizeHandleElement = this.mediaElement.getSashElement('east');
    this.resizeHandleElement.classList.add('pm-resizable-handle');
    this.resizeHandleElement.setAttribute('aria-label', 'Resize figure');
    this.resizeHandleElement.setAttribute('role', 'presentation');
    this.resizeHandleElement.setAttribute('data-resize-handle', 'east');

    this.contentDOM = ownerDocument.createElement('div');
    this.contentDOM.className = 'pm-figure-caption-slot';

    this.mediaElement.domNode.append(this.imageElement);
    this.dom.append(this.mediaElement.domNode, this.contentDOM);

    this.resizeController = new FigureResizableController(node, {
      view,
      getPos,
      figureElement: this.dom,
      mediaElement: this.mediaElement,
      imageElement: this.imageElement,
      selectFigureNode: () => this.selectFigureNode(),
    });

    this.mediaElement.domNode.addEventListener('mousedown', this.handleMediaMouseDown);

    this.render(node);
    this.resizeController.update(node);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.render(node);
    this.resizeController.update(node);
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(event: Event) {
    const target = event.target;
    return (
      this.resizeController.isResizing() ||
      (target instanceof Node && this.resizeHandleElement.contains(target))
    );
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    if (mutation.type === 'selection') {
      return false;
    }

    return !this.contentDOM.contains(mutation.target);
  }

  destroy() {
    this.mediaElement.domNode.removeEventListener('mousedown', this.handleMediaMouseDown);
    this.resizeController.dispose();
    this.mediaElement.dispose();
  }

  private render(node: ProseMirrorNode) {
    const attrs = node.attrs as FigureNodeAttrs;
    this.dom.setAttribute('data-block-id', attrs.blockId ?? '');
    this.dom.setAttribute('data-figure-id', attrs.figureId ?? '');

    if (attrs.src) {
      this.imageElement.setAttribute('src', attrs.src);
    } else {
      this.imageElement.removeAttribute('src');
    }

    this.imageElement.setAttribute('alt', attrs.alt);
    if (attrs.title) {
      this.imageElement.setAttribute('title', attrs.title);
    } else {
      this.imageElement.removeAttribute('title');
    }
  }

  private handleMediaMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && this.resizeHandleElement.contains(target)) {
      return;
    }

    event.preventDefault();
    this.selectFigureNode();
  };

  private selectFigureNode() {
    const position = this.resolvePosition();
    if (position === null) {
      return;
    }

    const selection = this.view.state.selection;
    if (selection instanceof NodeSelection && selection.from === position) {
      this.view.focus();
      return;
    }

    this.view.dispatch(
      this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, position)),
    );
    this.view.focus();
  }

  private resolvePosition() {
    try {
      const position = this.getPos();
      return typeof position === 'number' ? position : null;
    } catch {
      return null;
    }
  }
}
