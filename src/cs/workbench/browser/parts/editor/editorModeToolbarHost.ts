import {
  createEditorBrowserModeToolbarContribution,
} from 'cs/workbench/browser/parts/editor/editorBrowserModeToolbarContribution';
import {
  createEditorPdfModeToolbarContribution,
} from 'cs/workbench/browser/parts/editor/editorPdfModeToolbarContribution';
import type {
  EditorModeToolbarContribution,
  EditorModeToolbarContributionContext,
  EditorModeToolbarKind,
} from 'cs/workbench/browser/parts/editor/editorModeToolbarContribution';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';

export class EditorModeToolbarHost {
  private context: EditorModeToolbarContributionContext;
  private readonly contributionsByMode = new Map<
    EditorModeToolbarKind,
    EditorModeToolbarContribution
  >();

  constructor(
    context: EditorModeToolbarContributionContext,
    dropdownServices: DropdownContextServices,
  ) {
    this.context = context;
    this.contributionsByMode.set(
      'browser',
      createEditorBrowserModeToolbarContribution(context, dropdownServices),
    );
    this.contributionsByMode.set(
      'pdf',
      createEditorPdfModeToolbarContribution(context, dropdownServices),
    );
  }

  getElement() {
    const contribution = this.getActiveContribution();
    return contribution?.getElement() ?? null;
  }

  setContext(context: EditorModeToolbarContributionContext) {
    this.context = context;
    const contribution = this.getActiveContribution();
    contribution?.setContext(context);
  }

  focusPrimaryInput() {
    this.getActiveContribution()?.focusPrimaryInput?.();
  }

  dispose() {
    for (const contribution of this.contributionsByMode.values()) {
      contribution.dispose();
    }
    this.contributionsByMode.clear();
  }

  private getActiveContribution() {
    const mode = this.context.mode;
    if (!mode) {
      return null;
    }
    return this.contributionsByMode.get(mode) ?? null;
  }
}

export function createEditorModeToolbarHost(
  context: EditorModeToolbarContributionContext,
  dropdownServices: DropdownContextServices,
) {
  return new EditorModeToolbarHost(context, dropdownServices);
}
