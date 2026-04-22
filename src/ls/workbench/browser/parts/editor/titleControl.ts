import type { EditorGroupModel } from 'ls/workbench/browser/parts/editor/editorGroupModel';

export type TitleControlCallbacks = {
  onActivateTab: (tabId: string) => void;
  onReorderTab?: (
    tabId: string,
    targetSlotIndex: number,
  ) => void | Promise<void>;
  onCloseTab: (tabId: string) => Promise<boolean> | boolean | void;
  onCloseOtherTabs?: (tabId: string) => Promise<boolean> | boolean | void;
  onCloseAllTabs?: () => Promise<boolean> | boolean | void;
  onRenameTab?: (tabId: string) => void | Promise<void>;
  onOpenPaneMode: (paneMode: EditorGroupModel['tabs'][number]['paneMode']) => void;
};

export type TitleControlLabels = {
  close: string;
  closeOthers?: string;
  closeAll?: string;
  rename?: string;
};

export type TitleControlProps = {
  group: EditorGroupModel;
  labels: TitleControlLabels;
} & TitleControlCallbacks;

export abstract class TitleControl {
  private element: HTMLElement | null = null;

  constructor(protected props: TitleControlProps) {}

  getElement() {
    if (!this.element) {
      this.element = this.create();
    }

    return this.element;
  }

  setProps(props: TitleControlProps) {
    this.props = props;
    if (!this.element) {
      return;
    }

    this.update();
  }

  dispose() {
    this.element = null;
  }

  protected abstract create(): HTMLElement;

  protected abstract update(): void;
}
