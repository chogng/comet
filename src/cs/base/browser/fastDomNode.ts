export class FastDomNode<T extends HTMLElement> {
  private maxWidth = '';
  private width = '';
  private height = '';
  private top = '';
  private left = '';
  private bottom = '';
  private right = '';
  private paddingTop = '';
  private paddingLeft = '';
  private paddingBottom = '';
  private paddingRight = '';
  private fontFamily = '';
  private fontWeight = '';
  private fontSize = '';
  private fontStyle = '';
  private fontFeatureSettings = '';
  private fontVariationSettings = '';
  private textDecoration = '';
  private lineHeight = '';
  private letterSpacing = '';
  private className = '';
  private display = '';
  private position = '';
  private visibility = '';
  private color = '';
  private backgroundColor = '';
  private layerHint = false;
  private contain: 'none' | 'strict' | 'content' | 'size' | 'layout' | 'style' | 'paint' = 'none';
  private boxShadow = '';

  constructor(public readonly domNode: T) {}

  focus(): void {
    this.domNode.focus();
  }

  setMaxWidth(value: number | string): void {
    const maxWidth = numberAsPixels(value);
    if (this.maxWidth === maxWidth) {
      return;
    }
    this.maxWidth = maxWidth;
    this.domNode.style.maxWidth = maxWidth;
  }

  setWidth(value: number | string): void {
    const width = numberAsPixels(value);
    if (this.width === width) {
      return;
    }
    this.width = width;
    this.domNode.style.width = width;
  }

  setHeight(value: number | string): void {
    const height = numberAsPixels(value);
    if (this.height === height) {
      return;
    }
    this.height = height;
    this.domNode.style.height = height;
  }

  setTop(value: number | string): void {
    const top = numberAsPixels(value);
    if (this.top === top) {
      return;
    }
    this.top = top;
    this.domNode.style.top = top;
  }

  setLeft(value: number | string): void {
    const left = numberAsPixels(value);
    if (this.left === left) {
      return;
    }
    this.left = left;
    this.domNode.style.left = left;
  }

  setBottom(value: number | string): void {
    const bottom = numberAsPixels(value);
    if (this.bottom === bottom) {
      return;
    }
    this.bottom = bottom;
    this.domNode.style.bottom = bottom;
  }

  setRight(value: number | string): void {
    const right = numberAsPixels(value);
    if (this.right === right) {
      return;
    }
    this.right = right;
    this.domNode.style.right = right;
  }

  setPaddingTop(value: number | string): void {
    const paddingTop = numberAsPixels(value);
    if (this.paddingTop === paddingTop) {
      return;
    }
    this.paddingTop = paddingTop;
    this.domNode.style.paddingTop = paddingTop;
  }

  setPaddingLeft(value: number | string): void {
    const paddingLeft = numberAsPixels(value);
    if (this.paddingLeft === paddingLeft) {
      return;
    }
    this.paddingLeft = paddingLeft;
    this.domNode.style.paddingLeft = paddingLeft;
  }

  setPaddingBottom(value: number | string): void {
    const paddingBottom = numberAsPixels(value);
    if (this.paddingBottom === paddingBottom) {
      return;
    }
    this.paddingBottom = paddingBottom;
    this.domNode.style.paddingBottom = paddingBottom;
  }

  setPaddingRight(value: number | string): void {
    const paddingRight = numberAsPixels(value);
    if (this.paddingRight === paddingRight) {
      return;
    }
    this.paddingRight = paddingRight;
    this.domNode.style.paddingRight = paddingRight;
  }

  setFontFamily(fontFamily: string): void {
    if (this.fontFamily === fontFamily) {
      return;
    }
    this.fontFamily = fontFamily;
    this.domNode.style.fontFamily = fontFamily;
  }

  setFontWeight(fontWeight: string): void {
    if (this.fontWeight === fontWeight) {
      return;
    }
    this.fontWeight = fontWeight;
    this.domNode.style.fontWeight = fontWeight;
  }

  setFontSize(value: number | string): void {
    const fontSize = numberAsPixels(value);
    if (this.fontSize === fontSize) {
      return;
    }
    this.fontSize = fontSize;
    this.domNode.style.fontSize = fontSize;
  }

  setFontStyle(fontStyle: string): void {
    if (this.fontStyle === fontStyle) {
      return;
    }
    this.fontStyle = fontStyle;
    this.domNode.style.fontStyle = fontStyle;
  }

  setFontFeatureSettings(fontFeatureSettings: string): void {
    if (this.fontFeatureSettings === fontFeatureSettings) {
      return;
    }
    this.fontFeatureSettings = fontFeatureSettings;
    this.domNode.style.fontFeatureSettings = fontFeatureSettings;
  }

  setFontVariationSettings(fontVariationSettings: string): void {
    if (this.fontVariationSettings === fontVariationSettings) {
      return;
    }
    this.fontVariationSettings = fontVariationSettings;
    this.domNode.style.fontVariationSettings = fontVariationSettings;
  }

  setTextDecoration(textDecoration: string): void {
    if (this.textDecoration === textDecoration) {
      return;
    }
    this.textDecoration = textDecoration;
    this.domNode.style.textDecoration = textDecoration;
  }

  setLineHeight(value: number | string): void {
    const lineHeight = numberAsPixels(value);
    if (this.lineHeight === lineHeight) {
      return;
    }
    this.lineHeight = lineHeight;
    this.domNode.style.lineHeight = lineHeight;
  }

  setLetterSpacing(value: number | string): void {
    const letterSpacing = numberAsPixels(value);
    if (this.letterSpacing === letterSpacing) {
      return;
    }
    this.letterSpacing = letterSpacing;
    this.domNode.style.letterSpacing = letterSpacing;
  }

  setClassName(className: string): void {
    if (this.className === className) {
      return;
    }
    this.className = className;
    this.domNode.className = className;
  }

  toggleClassName(className: string, shouldHaveIt?: boolean): void {
    this.domNode.classList.toggle(className, shouldHaveIt);
    this.className = this.domNode.className;
  }

  setDisplay(display: string): void {
    if (this.display === display) {
      return;
    }
    this.display = display;
    this.domNode.style.display = display;
  }

  setPosition(position: string): void {
    if (this.position === position) {
      return;
    }
    this.position = position;
    this.domNode.style.position = position;
  }

  setVisibility(visibility: string): void {
    if (this.visibility === visibility) {
      return;
    }
    this.visibility = visibility;
    this.domNode.style.visibility = visibility;
  }

  setColor(color: string): void {
    if (this.color === color) {
      return;
    }
    this.color = color;
    this.domNode.style.color = color;
  }

  setBackgroundColor(backgroundColor: string): void {
    if (this.backgroundColor === backgroundColor) {
      return;
    }
    this.backgroundColor = backgroundColor;
    this.domNode.style.backgroundColor = backgroundColor;
  }

  setLayerHinting(layerHint: boolean): void {
    if (this.layerHint === layerHint) {
      return;
    }
    this.layerHint = layerHint;
    this.domNode.style.transform = layerHint ? 'translate3d(0px, 0px, 0px)' : '';
  }

  setBoxShadow(boxShadow: string): void {
    if (this.boxShadow === boxShadow) {
      return;
    }
    this.boxShadow = boxShadow;
    this.domNode.style.boxShadow = boxShadow;
  }

  setContain(contain: 'none' | 'strict' | 'content' | 'size' | 'layout' | 'style' | 'paint'): void {
    if (this.contain === contain) {
      return;
    }
    this.contain = contain;
    this.domNode.style.contain = contain;
  }

  setAttribute(name: string, value: string): void {
    this.domNode.setAttribute(name, value);
  }

  removeAttribute(name: string): void {
    this.domNode.removeAttribute(name);
  }

  appendChild(child: FastDomNode<T>): void {
    this.domNode.appendChild(child.domNode);
  }

  removeChild(child: FastDomNode<T>): void {
    this.domNode.removeChild(child.domNode);
  }
}

function numberAsPixels(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}

export function createFastDomNode<T extends HTMLElement>(domNode: T): FastDomNode<T> {
  return new FastDomNode(domNode);
}
