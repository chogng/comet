/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StandardMouseEvent } from 'cs/base/browser/mouseEvent';
import {
  AnchorAlignment,
  AnchorAxisAlignment,
  AnchorPosition,
  type IAnchor,
  type IContextViewProvider,
} from 'cs/base/browser/ui/contextview/contextview';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export { ContextViewDOMPosition } from 'cs/base/browser/ui/contextview/contextview';

export interface IContextViewDelegate {
  canRelayout?: boolean;
  getAnchor(): HTMLElement | StandardMouseEvent | IAnchor;
  render(container: HTMLElement): IDisposable | null;
  onDOMEvent?(event: Event, activeElement: HTMLElement): void;
  onHide?(data?: unknown): void;
  focus?(): void;
  anchorAlignment?: AnchorAlignment;
  anchorAxisAlignment?: AnchorAxisAlignment;
  anchorPosition?: AnchorPosition;
  layer?: number;
}

export interface IOpenContextView {
  close: () => void;
}

export const IContextViewService = createDecorator<IContextViewService>('contextViewService');

export interface IContextViewService extends IContextViewProvider {
  readonly _serviceBrand: undefined;
  showContextView(delegate: IContextViewDelegate, container?: HTMLElement, shadowRoot?: boolean): IOpenContextView;
  hideContextView(data?: unknown): void;
  getContextViewElement(): HTMLElement;
}

export type ContextMenuListener = () => void;
export interface ContextMenuListenerDisposable {
  dispose: () => void;
}
