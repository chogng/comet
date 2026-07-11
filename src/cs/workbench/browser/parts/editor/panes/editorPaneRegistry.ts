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
  EditorPaneRuntimeState,
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
  onDidChangePaneState: (input: EditorInput, state: EditorPaneRuntimeState) => void;
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
        createPane: () => {
          const pane = options.createPane(input, context);
          pane.setInput(input);
          return pane;
        },
        setInput: pane => pane.setInput(input),
      };
    },
  };
}

export const editorPaneDescriptors: AnyEditorPaneRegistryDescriptor[] = [];

export function registerEditorPaneDescriptor<
  TInput extends EditorInput,
  TPane extends EditorPane<TInput, unknown>,
  TPaneId extends EditorPaneId,
>(
  descriptor: EditorPaneRegistryDescriptor<TInput, TPane, TPaneId>,
) {
  const registeredDescriptor = descriptor as unknown as AnyEditorPaneRegistryDescriptor;
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
  for (const descriptor of editorPaneDescriptors) {
    if (!descriptor.acceptsInput(input)) {
      continue;
    }

    const resolvedPane = descriptor.resolvePane(input, context);
    if (resolvedPane) {
      return resolvedPane;
    }
  }

  throw new Error(
    `No editor pane descriptor found for input type '${input.typeId}'.`,
  );
}
