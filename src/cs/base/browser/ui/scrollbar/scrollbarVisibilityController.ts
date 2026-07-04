import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';

export class ScrollbarVisibilityController {
  private static readonly HIDING_CLASS_NAME = 'comet-is-scrollbar-hiding';
  private visibility: ScrollbarVisibility;
  private domNode: HTMLElement | null = null;
  private rawShouldBeVisible = false;
  private shouldBeVisible = false;
  private isNeeded = false;
  private isVisible = false;
  private revealTimer: number | null = null;

  constructor(
    visibility: ScrollbarVisibility,
    private readonly visibleClassName: string,
  ) {
    this.visibility = visibility;
  }

  setVisibility(visibility: ScrollbarVisibility) {
    if (this.visibility === visibility) {
      return;
    }

    this.visibility = visibility;
    this.updateShouldBeVisible();
  }

  setShouldBeVisible(rawShouldBeVisible: boolean) {
    this.rawShouldBeVisible = rawShouldBeVisible;
    this.updateShouldBeVisible();
  }

  setIsNeeded(isNeeded: boolean) {
    if (this.isNeeded === isNeeded) {
      return;
    }

    this.isNeeded = isNeeded;
    this.ensureVisibility();
  }

  setDomNode(domNode: HTMLElement) {
    this.domNode = domNode;
    this.hide(false);
    this.setShouldBeVisible(false);
  }

  ensureVisibility() {
    if (!this.isNeeded) {
      this.hide(false);
      return;
    }

    if (this.shouldBeVisible) {
      this.reveal();
      return;
    }

    this.hide(true);
  }

  dispose() {
    if (this.revealTimer !== null) {
      window.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  private applyVisibilitySetting() {
    if (this.visibility === ScrollbarVisibility.Hidden) {
      return false;
    }
    if (this.visibility === ScrollbarVisibility.Visible) {
      return true;
    }
    return this.rawShouldBeVisible;
  }

  private updateShouldBeVisible() {
    const shouldBeVisible = this.applyVisibilitySetting();
    if (this.shouldBeVisible === shouldBeVisible) {
      return;
    }

    this.shouldBeVisible = shouldBeVisible;
    this.ensureVisibility();
  }

  private reveal() {
    if (this.isVisible) {
      return;
    }

    this.isVisible = true;
    if (this.revealTimer !== null) {
      window.clearTimeout(this.revealTimer);
    }
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = null;
      this.applyVisibleState(true);
    }, 0);
  }

  private hide(withFadeAway: boolean) {
    if (this.revealTimer !== null) {
      window.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    if (!this.isVisible) {
      this.applyVisibleState(false, withFadeAway);
      return;
    }

    this.isVisible = false;
    this.applyVisibleState(false, withFadeAway);
  }

  private applyVisibleState(visible: boolean, withFadeAway = false) {
    if (!this.domNode) {
      return;
    }

    this.domNode.classList.toggle(this.visibleClassName, visible);
    this.domNode.classList.remove(ScrollbarVisibilityController.HIDING_CLASS_NAME);
    if (!visible && withFadeAway) {
      this.domNode.classList.add(ScrollbarVisibilityController.HIDING_CLASS_NAME);
    }
  }
}

export default ScrollbarVisibilityController;
