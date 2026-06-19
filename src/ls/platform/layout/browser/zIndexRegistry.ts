import { clearNode } from 'ls/base/browser/dom';
import { RunOnceScheduler } from 'ls/base/common/async';

export enum ZIndex {
  Base = 0,
  Sash = 35,
  SuggestWidget = 40,
  Hover = 50,
  DragImage = 1000,
  MenubarMenuItemsHolder = 2000,
  ContextView = 2500,
  ModalDialog = 2600,
  PaneDropOverlay = 10000,
}

const Z_INDEX_VALUES = Object.keys(ZIndex)
  .filter((key) => !Number.isNaN(Number(key)))
  .map((key) => Number(key))
  .sort((a, b) => b - a);

function findBase(zIndex: number) {
  for (const value of Z_INDEX_VALUES) {
    if (zIndex >= value) {
      return value;
    }
  }

  return -1;
}

function createStyleSheet() {
  const style = document.createElement('style');
  style.type = 'text/css';
  document.head.appendChild(style);
  return style;
}

function createCSSRule(selector: string, body: string, styleSheet: HTMLStyleElement) {
  styleSheet.appendChild(document.createTextNode(`${selector} {\n${body}}\n`));
}

class ZIndexRegistry {
  private readonly styleSheet: HTMLStyleElement;
  private readonly zIndexMap = new Map<string, number>();
  private readonly scheduler = new RunOnceScheduler(
    () => this.updateStyleElement(),
    200,
  );

  constructor() {
    this.styleSheet = createStyleSheet();
  }

  registerZIndex(relativeLayer: ZIndex, zIndex: number, name: string): string {
    if (this.zIndexMap.has(name)) {
      throw new Error(`z-index with name ${name} has already been registered.`);
    }

    const proposedValue = relativeLayer + zIndex;
    if (findBase(proposedValue) !== relativeLayer) {
      throw new Error(
        `Relative layer: ${relativeLayer} + z-index: ${zIndex} exceeds next layer ${proposedValue}.`,
      );
    }

    this.zIndexMap.set(name, proposedValue);
    this.scheduler.schedule();
    return this.getVarName(name);
  }

  private getVarName(name: string): string {
    return `--z-index-${name}`;
  }

  private updateStyleElement(): void {
    clearNode(this.styleSheet);
    let ruleBody = '';
    this.zIndexMap.forEach((zIndex, name) => {
      ruleBody += `${this.getVarName(name)}: ${zIndex};\n`;
    });
    createCSSRule(':root', ruleBody, this.styleSheet);
  }
}

const zIndexRegistry = new ZIndexRegistry();

export function registerZIndex(
  relativeLayer: ZIndex,
  zIndex: number,
  name: string,
): string {
  return zIndexRegistry.registerZIndex(relativeLayer, zIndex, name);
}
