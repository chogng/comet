import { dispose } from 'cs/base/common/lifecycle';

export {
  createHoverController,
  normalizeHoverInput,
  type HoverAction,
  type HoverHandle,
  type HoverInput,
  type HoverOptions,
  type HoverRenderable,
} from './hoverWidget';

import {
  createHoverController,
  type HoverHandle,
  type HoverInput,
} from './hoverWidget';

export interface HoverDelegate {
  createHover: (target: HTMLElement, input: HoverInput) => HoverHandle;
}

export interface HoverService {
  createHover: (target: HTMLElement, input: HoverInput) => HoverHandle;
}

export type HoverServiceOptions = {
  delegate: HoverDelegate;
};

export type HoverBinding = {
  update: (input: HoverInput | null | undefined) => void;
  dispose: () => void;
};

type ManagedHoverHandle = {
  handle: HoverHandle;
  service: HoverService;
};

class DelegateHoverService implements HoverService {
  constructor(private readonly delegate: HoverDelegate) {}

  createHover = (target: HTMLElement, input: HoverInput) =>
    this.delegate.createHover(target, input);
}

class DomHoverDelegate implements HoverDelegate {
  createHover = (target: HTMLElement, input: HoverInput) =>
    createHoverController(target, input);
}

const hoverDelegate = new DomHoverDelegate();
const hoverService = new DelegateHoverService(hoverDelegate);
const managedHoverHandles = new WeakMap<HTMLElement, ManagedHoverHandle>();

export function createHoverService(options: HoverServiceOptions): HoverService {
  return new DelegateHoverService(options.delegate);
}

export function getHoverService(): HoverService {
  return hoverService;
}

export function bindHover(
  target: HTMLElement,
  initialInput?: HoverInput | null,
  hoverService: HoverService = getHoverService(),
): HoverBinding {
  const handle = hoverService.createHover(target, null);
  target.removeAttribute('title');

  if (initialInput !== undefined) {
    handle.update(initialInput);
  }

  return {
    update: (input) => {
      handle.update(input ?? null);
      target.removeAttribute('title');
    },
    dispose: () => {
      dispose(handle);
    },
  };
}

export function applyHover(
  target: HTMLElement,
  input: HoverInput,
  hoverService: HoverService = getHoverService(),
): HoverHandle {
  const current = managedHoverHandles.get(target);
  if (current && current.service !== hoverService) {
    dispose(current.handle);
    managedHoverHandles.delete(target);
  }

  const handle = managedHoverHandles.get(target)?.handle
    ?? hoverService.createHover(target, null);
  managedHoverHandles.set(target, {
    handle,
    service: hoverService,
  });
  handle.update(input);
  target.removeAttribute('title');
  return handle;
}
