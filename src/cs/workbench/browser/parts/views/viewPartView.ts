import {
  getWorkbenchPartDomNode,
  WORKBENCH_PART_IDS,
  registerWorkbenchPartDomNode,
} from 'cs/workbench/browser/layout';
import 'cs/workbench/browser/parts/views/media/view.css';

export type ViewPartLabels = {
  emptyState: string;
  contentUnavailable: string;
};

export type ViewPartProps = {
  browserUrl: string;
  browserPageTitle?: string;
  browserFaviconUrl?: string;
  browserIsLoading?: boolean;
  electronRuntime: boolean;
  webContentRuntime: boolean;
  labels: ViewPartLabels;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

export class ViewPartView {
  private props: ViewPartProps;
  private readonly element = createElement('div', 'comet-browser-frame-container');
  private readonly contentElement = createElement(
    'div',
    'comet-native-webcontentview-host',
  );
  private readonly webContentHost = createElement(
    'div',
    'comet-browser-frame comet-browser-frame-placeholder',
  );
  private readonly overlayElement = createElement('div', 'comet-webcontent-overlay');
  private isWebContentHostRegistered = false;

  constructor(props: ViewPartProps) {
    this.props = props;
    this.webContentHost.setAttribute('aria-hidden', 'true');
    this.contentElement.append(this.webContentHost, this.overlayElement);
    this.element.append(this.contentElement);
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: ViewPartProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    this.setWebContentHostRegistered(false);
    this.element.replaceChildren();
  }

  private render() {
    const canHostNativeWebContent =
      this.props.electronRuntime && this.props.webContentRuntime;
    const shouldShowNativeWebContent =
      canHostNativeWebContent && Boolean(this.props.browserUrl);
    const nextWebContentActive = shouldShowNativeWebContent ? 'true' : 'false';

    if (this.webContentHost.dataset.webcontentActive !== nextWebContentActive) {
      this.webContentHost.dataset.webcontentActive = nextWebContentActive;
    }
    this.overlayElement.replaceChildren();

    if (!this.props.browserUrl) {
      this.setWebContentHostRegistered(canHostNativeWebContent);
      const emptyFrame = createElement('div', 'comet-browser-frame');
      emptyFrame.setAttribute('aria-hidden', 'true');
      this.overlayElement.className = 'comet-webcontent-overlay visible';
      this.overlayElement.append(emptyFrame);
      return;
    }

    if (!canHostNativeWebContent) {
      this.setWebContentHostRegistered(false);
      const warning = createElement(
        'div',
        'empty-state webcontent-runtime-warning',
      );
      warning.textContent = this.props.labels.contentUnavailable;
      this.overlayElement.className = 'comet-webcontent-overlay visible';
      this.overlayElement.append(warning);
      return;
    }

    this.setWebContentHostRegistered(true);
    this.overlayElement.className = 'comet-webcontent-overlay';
  }

  private setWebContentHostRegistered(registered: boolean) {
    if (this.isWebContentHostRegistered === registered) {
      return;
    }

    this.isWebContentHostRegistered = registered;
    if (registered) {
      registerWorkbenchPartDomNode(
        WORKBENCH_PART_IDS.webContentViewHost,
        this.webContentHost,
      );
      return;
    }

    if (
      getWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost) ===
      this.webContentHost
    ) {
      registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, null);
    }
  }
}

export function createViewPartView(props: ViewPartProps) {
  return new ViewPartView(props);
}

export default ViewPartView;
