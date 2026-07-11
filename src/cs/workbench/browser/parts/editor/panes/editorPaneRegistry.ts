import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type {
  AnyEditorPane,
  EditorPaneDescriptor,
  EditorPaneResolution,
  EditorPane,
} from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export type EditorPaneResolverContext = DropdownContextServices & {
  labels: EditorPartLabels;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  dialogService: IDialogService;
  instantiationService: IInstantiationService;
  onOpenEditor?: EditorOpenHandler;
  onOpenSources: () => void;
};

export type EditorPaneId = string;

export type ResolvedEditorPane = {
} & EditorPaneResolution<AnyEditorPane, EditorPaneId>;

type EditorPaneRegistryDescriptor<
  TInput extends EditorInput,
  TPane extends EditorPane<TInput, unknown>,
  TPaneId extends EditorPaneId,
> = EditorPaneDescriptor<
  TInput,
  EditorPaneResolverContext,
  TPane,
  TPaneId
>;

type EditorPaneDescriptorOptions<
  TInput extends EditorInput,
  TPane extends EditorPane<TInput, unknown>,
  TPaneId extends EditorPaneId,
> = {
  paneId: TPaneId;
  contentClassNames: readonly string[];
  acceptsInput: (input: EditorInput) => input is TInput;
  createPaneKey?: (input: TInput) => string;
  createPane: (input: TInput, context: EditorPaneResolverContext) => TPane;
  updatePane?: (pane: TPane, context: EditorPaneResolverContext) => void;
};

type AnyEditorPaneRegistryDescriptor = {
  readonly paneId: EditorPaneId;
  acceptsInput(input: EditorInput): boolean;
  resolvePane(input: EditorInput, context: EditorPaneResolverContext): ResolvedEditorPane;
};

export function createEditorPaneDescriptor<
  TInput extends EditorInput,
  TPane extends EditorPane<TInput, unknown>,
  TPaneId extends EditorPaneId,
>(
  options: EditorPaneDescriptorOptions<TInput, TPane, TPaneId>,
): EditorPaneRegistryDescriptor<TInput, TPane, TPaneId> {
  return {
    paneId: options.paneId,
    acceptsInput: options.acceptsInput,
    resolvePane: (input, context) => {
      return {
        paneId: options.paneId,
        paneKey: options.createPaneKey?.(input) ?? options.paneId,
        contentClassNames: options.contentClassNames,
        createPane: () => options.createPane(input, context),
        setInput: (pane, token) => {
          options.updatePane?.(pane, context);
          return pane.setInput(input, token);
        },
      };
    },
  };
}

const editorPaneDescriptors: AnyEditorPaneRegistryDescriptor[] = [];

export function registerEditorPaneDescriptor<
  TInput extends EditorInput,
  TPane extends EditorPane<TInput, unknown>,
  TPaneId extends EditorPaneId,
>(
  descriptor: EditorPaneRegistryDescriptor<TInput, TPane, TPaneId>,
) {
  const registeredDescriptor = descriptor as unknown as AnyEditorPaneRegistryDescriptor;
  if (editorPaneDescriptors.some(candidate => candidate.paneId === descriptor.paneId)) {
    throw new Error(`Editor pane '${descriptor.paneId}' is already registered.`);
  }
  editorPaneDescriptors.push(registeredDescriptor);
  return toDisposable(() => {
    const index = editorPaneDescriptors.indexOf(registeredDescriptor);
    if (index >= 0) {
      editorPaneDescriptors.splice(index, 1);
    }
  });
}

export function resolveEditorPane(
  input: EditorInput,
  context: EditorPaneResolverContext,
): ResolvedEditorPane {
  const matchingDescriptors = editorPaneDescriptors.filter(descriptor => descriptor.acceptsInput(input));
  if (matchingDescriptors.length === 0) {
    throw new Error(`No editor pane descriptor found for input type '${input.typeId}'.`);
  }
  if (matchingDescriptors.length === 1) {
    return matchingDescriptors[0]!.resolvePane(input, context);
  }

  const preferredPaneId = input.editorId;
  const preferredDescriptors = matchingDescriptors.filter(descriptor => descriptor.paneId === preferredPaneId);
  if (preferredDescriptors.length !== 1) {
    throw new Error(`Multiple editor panes match '${input.typeId}' and no unique preferred pane is registered.`);
  }
  return preferredDescriptors[0]!.resolvePane(input, context);
}
