import { JSDOM } from 'jsdom';

type InstalledDomEnvironment = {
  cleanup: () => void;
};

type GlobalKey =
  | 'window'
  | 'document'
  | 'navigator'
  | 'HTMLElement'
  | 'HTMLDivElement'
  | 'HTMLButtonElement'
  | 'HTMLInputElement'
  | 'HTMLTextAreaElement'
  | 'Element'
  | 'Node'
  | 'Text'
  | 'SVGElement'
  | 'DocumentFragment'
  | 'Event'
  | 'MouseEvent'
  | 'PointerEvent'
  | 'KeyboardEvent'
  | 'CompositionEvent'
  | 'InputEvent'
  | 'DOMParser'
  | 'MutationObserver'
  | 'getComputedStyle'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'Range'
  | 'Selection';

const GLOBAL_KEYS: readonly GlobalKey[] = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'Element',
  'Node',
  'Text',
  'SVGElement',
  'DocumentFragment',
  'Event',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'CompositionEvent',
  'InputEvent',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'Range',
  'Selection',
];

function createDomRect(width = 120, height = 24) {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON() {
      return this;
    },
  };
}

function createDomRectList() {
  const rect = createDomRect() as DOMRect;
  return {
    0: rect,
    item: (index: number) => (index === 0 ? rect : null),
    length: 1,
    [Symbol.iterator]: function* iterator() {
      yield rect;
    },
  } as DOMRectList;
}

export function installDomTestEnvironment(): InstalledDomEnvironment {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const previousDescriptors = new Map<GlobalKey, PropertyDescriptor | undefined>();
  const globalTarget = globalThis as Record<string, unknown>;
  const windowRecord = dom.window as unknown as Record<string, unknown>;

  for (const key of GLOBAL_KEYS) {
    previousDescriptors.set(
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    );
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: windowRecord[key],
    });
  }

  if (!globalTarget.performance) {
    globalTarget.performance = windowRecord.performance;
  }

  const elementPrototype = dom.window.HTMLElement.prototype as HTMLElement & {
    scrollIntoView?: () => void;
    getBoundingClientRect?: () => DOMRect;
    getClientRects?: () => DOMRectList;
  };
  const rangePrototype = dom.window.Range.prototype as Range & {
    getBoundingClientRect?: () => DOMRect;
    getClientRects?: () => DOMRectList;
  };

  if (!elementPrototype.scrollIntoView) {
    elementPrototype.scrollIntoView = () => {};
  }

  elementPrototype.getBoundingClientRect = () => createDomRect() as DOMRect;
  elementPrototype.getClientRects = () => createDomRectList();
  rangePrototype.getBoundingClientRect = () => createDomRect() as DOMRect;
  rangePrototype.getClientRects = () => createDomRectList();

  return {
    cleanup() {
      const currentDocument = globalTarget.document as Document | undefined;
      currentDocument?.body?.replaceChildren();
      for (const key of GLOBAL_KEYS) {
        const previousDescriptor = previousDescriptors.get(key);
        if (!previousDescriptor) {
          delete globalTarget[key];
          continue;
        }

        Object.defineProperty(globalThis, key, previousDescriptor);
      }
      dom.window.close();
    },
  };
}

export default installDomTestEnvironment;
