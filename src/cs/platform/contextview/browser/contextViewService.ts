/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextView, ContextViewDOMPosition, type IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IContextViewService, type IContextViewDelegate, type IOpenContextView } from 'cs/platform/contextview/browser/contextView';

export class PlatformContextViewService implements IContextViewService {
  declare readonly _serviceBrand: undefined;

  private openContextView: IOpenContextView | undefined;
  private readonly contextView = new ContextView(document.body, ContextViewDOMPosition.FIXED);

  showContextView(delegate: IContextViewDelegate, container?: HTMLElement, shadowRoot?: boolean): IOpenContextView {
    const contextContainer = container ?? document.body;
    this.contextView.setContainer(
      contextContainer,
      shadowRoot ? ContextViewDOMPosition.FIXED_SHADOW : ContextViewDOMPosition.FIXED,
    );
    this.contextView.show(delegate);

    const openContextView: IOpenContextView = {
      close: () => {
        if (this.openContextView === openContextView) {
          this.hideContextView();
        }
      },
    };
    this.openContextView = openContextView;
    return openContextView;
  }

  hideContextView(data?: unknown): void {
    this.contextView.hide(data);
    this.openContextView = undefined;
  }

  getContextViewElement(): HTMLElement {
    return this.contextView.getViewElement();
  }

  layout(): void {
    this.contextView.layout();
  }

  dispose(): void {
    this.contextView.dispose();
  }
}

registerSingleton(IContextViewService, PlatformContextViewService, InstantiationType.Delayed);
