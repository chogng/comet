import type { NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';

import type { LocaleMessages } from 'language/locales';
import type {
  WritingEditorCommand,
  WritingEditorToolbarState,
} from 'cs/editor/browser/text/commands';
import type { EditorDraftToolbarStyleModel } from 'cs/editor/browser/text/editorDraftToolbarStyleModel';
import {
  redoCommand,
  setParagraphCommand,
  setTextAlignCommand,
  toggleBoldCommand,
  toggleBulletListCommand,
  toggleHeadingCommand,
  toggleItalicCommand,
  toggleUnderlineCommand,
  toggleOrderedListCommand,
  undoCommand,
} from 'cs/editor/browser/text/commands';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';

type WritingEditorKeybindingId =
  | 'undo'
  | 'redo'
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'setParagraph'
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'setTextAlignLeft'
  | 'setTextAlignCenter'
  | 'setTextAlignRight'
  | 'toggleOrderedList'
  | 'toggleBulletList'
  | 'splitListItem'
  | 'sinkListItem'
  | 'liftListItem';

type WritingEditorToolbarCommandId =
  | 'setParagraph'
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'setFontFamily'
  | 'setFontSize'
  | 'setTextAlignLeft'
  | 'setTextAlignCenter'
  | 'setTextAlignRight'
  | 'clearInlineStyles'
  | 'toggleBulletList'
  | 'toggleOrderedList'
  | 'toggleBlockquote'
  | 'undo'
  | 'redo'
  | 'insertCitation'
  | 'insertFigure'
  | 'insertFigureRef';

export type WritingEditorRegisteredCommandId =
  | WritingEditorKeybindingId
  | WritingEditorToolbarCommandId
  | DraftEditorCommandId;

type WritingEditorToolbarGroupId = 'text' | 'format' | 'insert' | 'history';

export type WritingEditorToolbarActions = {
  setParagraph: () => boolean | void;
  toggleHeading: (level: number) => boolean | void;
  toggleBold: () => boolean | void;
  toggleItalic: () => boolean | void;
  toggleUnderline: () => boolean | void;
  setFontFamily: (fontFamily: string | null) => boolean | void;
  setFontSize: (fontSize: string | null) => boolean | void;
  setTextAlign: (textAlign: 'left' | 'center' | 'right') => boolean | void;
  clearInlineStyles: () => boolean | void;
  toggleBulletList: () => boolean | void;
  toggleOrderedList: () => boolean | void;
  toggleBlockquote: () => boolean | void;
  undo: () => boolean | void;
  redo: () => boolean | void;
  insertCitation: () => boolean | void;
  insertFigure: () => boolean | void;
  insertFigureRef: () => boolean | void;
};

export type WritingEditorToolbarButtonConfig = {
  label: string;
  onClick: () => void;
  icon?:
    | 'tx'
    | 'text-size'
    | 'h1'
    | 'h2'
    | 'h3'
    | 'bold'
    | 'italics'
    | 'underline'
    | 'align-left'
    | 'align-center'
    | 'align-right'
    | 'circle-slash'
    | 'list-unordered'
    | 'list-ordered'
    | 'quote'
    | 'quotes'
    | 'image'
    | 'mention'
    | 'arrow-left'
    | 'arrow-right';
  glyph?: string;
  isActive?: boolean;
  disabled?: boolean;
  isToggle?: boolean;
};

export type WritingEditorToolbarDropdownConfig = {
  label: string;
  title?: string;
  value: string;
  placeholder: string;
  options: readonly {
    value: string;
    label: string;
    title?: string;
    disabled?: boolean;
  }[];
  onChange: (value: string) => void;
};

export type WritingEditorToolbarSplitButtonConfig = {
  label: string;
  title?: string;
  buttonLabel: string;
  buttonMode?: 'icon' | 'text' | 'custom';
  buttonIcon?: WritingEditorToolbarButtonConfig['icon'];
  buttonGlyph?: string;
  onClick: () => void;
  menu: readonly {
    label: string;
    title?: string;
    checked?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }[];
};

export type WritingEditorToolbarItemConfig =
  | WritingEditorToolbarButtonConfig
  | WritingEditorToolbarDropdownConfig
  | WritingEditorToolbarSplitButtonConfig;

export type WritingEditorToolbarButtonGroup = {
  title: string;
  items: readonly WritingEditorToolbarItemConfig[];
};

export type WritingEditorToolbarMenuItemConfig = {
  id: string;
  label: string;
  title?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export type WritingEditorDraftCommandContext = {
  availableFigureIds: readonly string[];
};

type WritingEditorToolbarLabels = {
  textGroup: string;
  formatGroup: string;
  insertGroup: string;
  historyGroup: string;
  paragraph: string;
  heading1: string;
  heading2: string;
  heading3: string;
  bold: string;
  italic: string;
  underline: string;
  fontFamily: string;
  fontSize: string;
  defaultTextStyle: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  clearInlineStyles: string;
  bulletList: string;
  orderedList: string;
  blockquote: string;
  undo: string;
  redo: string;
  insertCitation: string;
  insertFigure: string;
  insertFigureRef: string;
};

type WritingEditorCommandContext = {
  listItemType: NodeType;
};

type WritingEditorToolbarBaseDefinition = {
  group: WritingEditorToolbarGroupId;
  getLabel: (labels: WritingEditorToolbarLabels) => string;
};

type WritingEditorToolbarButtonDefinition = WritingEditorToolbarBaseDefinition & {
  kind?: 'button';
  icon?: WritingEditorToolbarButtonConfig['icon'];
  glyph?: string;
  overflowMenu?: boolean;
  isActive?: (state: WritingEditorToolbarState) => boolean;
  isEnabled?: (state: WritingEditorToolbarState) => boolean;
  run: (actions: WritingEditorToolbarActions) => void;
};

type WritingEditorToolbarDropdownDefinition = WritingEditorToolbarBaseDefinition & {
  kind: 'dropdown';
  getValue: (state: WritingEditorToolbarState) => string;
  getPlaceholder: (labels: WritingEditorToolbarLabels) => string;
  run: (actions: WritingEditorToolbarActions, value: string) => void;
};

type WritingEditorToolbarDefinition =
  | WritingEditorToolbarButtonDefinition
  | WritingEditorToolbarDropdownDefinition;

type WritingEditorCommandDefinition = {
  id: WritingEditorRegisteredCommandId;
  shortcuts?: readonly string[];
  createCommand?: (context: WritingEditorCommandContext) => WritingEditorCommand;
  toolbar?: WritingEditorToolbarDefinition;
  draftShortcutLabel?: string;
  getWorkbenchLabel?: (ui: LocaleMessages) => string;
  isEnabledInDraft?: (context: WritingEditorDraftCommandContext) => boolean;
};

function registerWritingEditorCommand(definition: WritingEditorCommandDefinition) {
  return definition;
}

const writingEditorCommandDefinitions: readonly WritingEditorCommandDefinition[] = [
  registerWritingEditorCommand({
    id: 'undo',
    shortcuts: ['Mod-z'],
    createCommand: () => undoCommand(),
    toolbar: {
      group: 'history',
      overflowMenu: true,
      getLabel: (labels) => labels.undo,
      icon: 'arrow-left',
      isEnabled: (state) => state.canUndo,
      run: (actions: WritingEditorToolbarActions) => {
        actions.undo();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'redo',
    shortcuts: ['Shift-Mod-z', 'Mod-y'],
    createCommand: () => redoCommand(),
    toolbar: {
      group: 'history',
      overflowMenu: true,
      getLabel: (labels) => labels.redo,
      icon: 'arrow-right',
      isEnabled: (state) => state.canRedo,
      run: (actions: WritingEditorToolbarActions) => {
        actions.redo();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleBold',
    shortcuts: ['Mod-b'],
    createCommand: () => toggleBoldCommand(),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.bold,
      icon: 'bold',
      isActive: (state) => state.isBoldActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleBold();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleItalic',
    shortcuts: ['Mod-i'],
    createCommand: () => toggleItalicCommand(),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.italic,
      icon: 'italics',
      isActive: (state) => state.isItalicActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleItalic();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleUnderline',
    shortcuts: ['Mod-u'],
    createCommand: () => toggleUnderlineCommand(),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.underline,
      icon: 'underline',
      isActive: (state) => state.isUnderlineActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleUnderline();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'setFontFamily',
    toolbar: {
      kind: 'dropdown',
      group: 'format',
      getLabel: (labels) => labels.fontFamily,
      getValue: (state) => state.fontFamily ?? '',
      getPlaceholder: (labels) => labels.fontFamily,
      run: (actions: WritingEditorToolbarActions, value: string) => {
        actions.setFontFamily(value || null);
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'setFontSize',
    toolbar: {
      kind: 'dropdown',
      group: 'format',
      getLabel: (labels) => labels.fontSize,
      getValue: (state) => state.fontSize ?? '',
      getPlaceholder: (labels) => labels.fontSize,
      run: (actions: WritingEditorToolbarActions, value: string) => {
        actions.setFontSize(value || null);
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'setTextAlignLeft',
    shortcuts: ['Mod-Shift-l'],
    createCommand: () => setTextAlignCommand('left'),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.alignLeft,
      icon: 'align-left',
      isActive: (state) => state.textAlign === 'left',
      run: (actions: WritingEditorToolbarActions) => {
        actions.setTextAlign('left');
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'setTextAlignCenter',
    shortcuts: ['Mod-Shift-e'],
    createCommand: () => setTextAlignCommand('center'),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.alignCenter,
      icon: 'align-center',
      isActive: (state) => state.textAlign === 'center',
      run: (actions: WritingEditorToolbarActions) => {
        actions.setTextAlign('center');
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'setTextAlignRight',
    shortcuts: ['Mod-Shift-r'],
    createCommand: () => setTextAlignCommand('right'),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.alignRight,
      icon: 'align-right',
      isActive: (state) => state.textAlign === 'right',
      run: (actions: WritingEditorToolbarActions) => {
        actions.setTextAlign('right');
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'setParagraph',
    shortcuts: ['Mod-Alt-0'],
    createCommand: () => setParagraphCommand(),
    toolbar: {
      group: 'text',
      getLabel: (labels) => labels.paragraph,
      icon: 'tx',
      isActive: (state) => state.isParagraphActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.setParagraph();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleHeading1',
    shortcuts: ['Mod-Alt-1'],
    createCommand: () => toggleHeadingCommand(1),
    toolbar: {
      group: 'text',
      getLabel: (labels) => labels.heading1,
      icon: 'h1',
      isActive: (state) => state.activeHeadingLevel === 1,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleHeading(1);
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleHeading2',
    shortcuts: ['Mod-Alt-2'],
    createCommand: () => toggleHeadingCommand(2),
    toolbar: {
      group: 'text',
      getLabel: (labels) => labels.heading2,
      icon: 'h2',
      isActive: (state) => state.activeHeadingLevel === 2,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleHeading(2);
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleHeading3',
    shortcuts: ['Mod-Alt-3'],
    createCommand: () => toggleHeadingCommand(3),
    toolbar: {
      group: 'text',
      getLabel: (labels) => labels.heading3,
      icon: 'h3',
      isActive: (state) => state.activeHeadingLevel === 3,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleHeading(3);
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleOrderedList',
    shortcuts: ['Mod-Shift-7'],
    createCommand: () => toggleOrderedListCommand(),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.orderedList,
      icon: 'list-ordered',
      isActive: (state) => state.isOrderedListActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleOrderedList();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleBulletList',
    shortcuts: ['Mod-Shift-8'],
    createCommand: () => toggleBulletListCommand(),
    toolbar: {
      group: 'format',
      getLabel: (labels) => labels.bulletList,
      icon: 'list-unordered',
      isActive: (state) => state.isBulletListActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleBulletList();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'splitListItem',
    shortcuts: ['Enter'],
    createCommand: ({ listItemType }) => splitListItem(listItemType),
  }),
  registerWritingEditorCommand({
    id: 'sinkListItem',
    shortcuts: ['Tab'],
    createCommand: ({ listItemType }) => sinkListItem(listItemType),
  }),
  registerWritingEditorCommand({
    id: 'liftListItem',
    shortcuts: ['Shift-Tab'],
    createCommand: ({ listItemType }) => liftListItem(listItemType),
  }),
  registerWritingEditorCommand({
    id: 'clearInlineStyles',
    toolbar: {
      group: 'format',
      overflowMenu: true,
      getLabel: (labels) => labels.clearInlineStyles,
      icon: 'circle-slash',
      run: (actions: WritingEditorToolbarActions) => {
        actions.clearInlineStyles();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'toggleBlockquote',
    toolbar: {
      group: 'format',
      overflowMenu: true,
      getLabel: (labels) => labels.blockquote,
      icon: 'quote',
      isActive: (state) => state.isBlockquoteActive,
      run: (actions: WritingEditorToolbarActions) => {
        actions.toggleBlockquote();
      },
    },
  }),
  registerWritingEditorCommand({
    id: 'insertCitation',
    toolbar: {
      group: 'insert',
      overflowMenu: true,
      getLabel: (labels) => labels.insertCitation,
      icon: 'quotes',
      run: (actions: WritingEditorToolbarActions) => {
        actions.insertCitation();
      },
    },
    draftShortcutLabel: 'Mod+Shift+C',
    getWorkbenchLabel: (ui) => ui.editorInsertCitation,
  }),
  registerWritingEditorCommand({
    id: 'insertFigure',
    toolbar: {
      group: 'insert',
      getLabel: (labels) => labels.insertFigure,
      icon: 'image',
      run: (actions: WritingEditorToolbarActions) => {
        actions.insertFigure();
      },
    },
    draftShortcutLabel: 'Mod+Shift+F',
    getWorkbenchLabel: (ui) => ui.editorInsertFigure,
  }),
  registerWritingEditorCommand({
    id: 'insertFigureRef',
    toolbar: {
      group: 'insert',
      overflowMenu: true,
      getLabel: (labels) => labels.insertFigureRef,
      icon: 'mention',
      isEnabled: (state) => state.availableFigureIds.length > 0,
      run: (actions: WritingEditorToolbarActions) => {
        actions.insertFigureRef();
      },
    },
    draftShortcutLabel: 'Mod+Shift+R',
    getWorkbenchLabel: (ui) => ui.editorInsertFigureRef,
    isEnabledInDraft: (context) => context.availableFigureIds.length > 0,
  }),
];

function getToolbarGroupTitle(groupId: WritingEditorToolbarGroupId, labels: WritingEditorToolbarLabels) {
  switch (groupId) {
    case 'text':
      return labels.textGroup;
    case 'format':
      return labels.formatGroup;
    case 'insert':
      return labels.insertGroup;
    case 'history':
      return labels.historyGroup;
  }
}

function createTextStyleToolbarSplitButton(params: {
  labels: WritingEditorToolbarLabels;
  toolbarState: WritingEditorToolbarState;
  actions: WritingEditorToolbarActions;
}): WritingEditorToolbarSplitButtonConfig {
  const { labels, toolbarState, actions } = params;
  const currentValue = toolbarState.activeHeadingLevel
    ? `heading-${toolbarState.activeHeadingLevel}`
    : 'paragraph';
  const buttonLabel =
    currentValue === 'heading-1'
      ? 'h1'
      : currentValue === 'heading-2'
        ? 'h2'
        : currentValue === 'heading-3'
          ? 'h3'
          : 'Tx';

  return {
    label: labels.textGroup,
    title: labels.textGroup,
    buttonLabel,
    buttonMode: 'text',
    onClick: () => {
      switch (currentValue) {
        case 'heading-1':
          actions.toggleHeading(1);
          return;
        case 'heading-2':
          actions.toggleHeading(2);
          return;
        case 'heading-3':
          actions.toggleHeading(3);
          return;
        default:
          actions.setParagraph();
      }
    },
    menu: [
      {
        label: labels.paragraph,
        title: labels.paragraph,
        checked: currentValue === 'paragraph',
        onClick: () => {
          actions.setParagraph();
        },
      },
      {
        label: labels.heading1,
        title: labels.heading1,
        checked: currentValue === 'heading-1',
        onClick: () => {
          actions.toggleHeading(1);
        },
      },
      {
        label: labels.heading2,
        title: labels.heading2,
        checked: currentValue === 'heading-2',
        onClick: () => {
          actions.toggleHeading(2);
        },
      },
      {
        label: labels.heading3,
        title: labels.heading3,
        checked: currentValue === 'heading-3',
        onClick: () => {
          actions.toggleHeading(3);
        },
      },
    ],
  };
}

function createFontSizeToolbarSplitButton(params: {
  labels: WritingEditorToolbarLabels;
  actions: WritingEditorToolbarActions;
  model: EditorDraftToolbarStyleModel['fontSize'];
  options: readonly WritingEditorToolbarDropdownConfig['options'][number][];
}): WritingEditorToolbarSplitButtonConfig {
  const { labels, actions, model, options } = params;
  const currentValue = model.currentValue;
  const currentLabel = model.currentLabel;
  const defaultValue = model.defaultValue;

  return {
    label: labels.fontSize,
    title: labels.fontSize,
    buttonLabel: currentLabel,
    buttonMode: 'text',
    onClick: () => {
      actions.setFontSize(currentValue || null);
    },
    menu: options.map((option) => {
      const isDefaultOption = option.value === defaultValue;
      return {
        label: option.label,
        title: option.title ?? option.label,
        checked: currentValue ? option.value === currentValue : isDefaultOption,
        disabled: option.disabled,
        onClick: () => {
          actions.setFontSize(isDefaultOption ? null : (option.value || null));
        },
      };
    }),
  };
}

function createFontFamilyToolbarSplitButton(params: {
  labels: WritingEditorToolbarLabels;
  actions: WritingEditorToolbarActions;
  model: EditorDraftToolbarStyleModel['fontFamily'];
  options: readonly WritingEditorToolbarDropdownConfig['options'][number][];
}): WritingEditorToolbarSplitButtonConfig {
  const { labels, actions, model, options } = params;
  const currentValue = model.currentValue;
  const currentLabel = model.currentLabel;
  const defaultValue = model.defaultValue;

  return {
    label: labels.fontFamily,
    title: labels.fontFamily,
    buttonLabel: currentLabel,
    buttonMode: 'text',
    onClick: () => {
      actions.setFontFamily(currentValue || null);
    },
    menu: options.map((option) => {
      const isDefaultOption = option.value === defaultValue;
      return {
        label: option.label,
        title: option.title ?? option.label,
        checked: currentValue ? option.value === currentValue : isDefaultOption,
        disabled: option.disabled,
        onClick: () => {
          actions.setFontFamily(isDefaultOption ? null : (option.value || null));
        },
      };
    }),
  };
}

function isDraftEditorCommandId(commandId: WritingEditorRegisteredCommandId): commandId is DraftEditorCommandId {
  return commandId === 'insertCitation' || commandId === 'insertFigure' || commandId === 'insertFigureRef';
}

export function getWritingEditorCommands() {
  return writingEditorCommandDefinitions;
}

export function getWritingEditorCommand(commandId: WritingEditorRegisteredCommandId) {
  return writingEditorCommandDefinitions.find((definition) => definition.id === commandId) ?? null;
}

export function createWritingEditorKeymapBindings(listItemType: NodeType) {
  const bindings: Record<string, WritingEditorCommand> = {};

  for (const definition of writingEditorCommandDefinitions) {
    if (!definition.shortcuts || !definition.createCommand) {
      continue;
    }

    for (const shortcut of definition.shortcuts) {
      bindings[shortcut] = definition.createCommand({ listItemType });
    }
  }

  return bindings;
}

export function getDraftEditorCommandIds() {
  return writingEditorCommandDefinitions
    .map((definition) => definition.id)
    .filter(isDraftEditorCommandId);
}

export function getDraftEditorShortcutLabel(commandId: DraftEditorCommandId) {
  return getWritingEditorCommand(commandId)?.draftShortcutLabel ?? '';
}

export function isDraftEditorCommandEnabled(
  commandId: DraftEditorCommandId,
  context: WritingEditorDraftCommandContext,
) {
  return getWritingEditorCommand(commandId)?.isEnabledInDraft?.(context) ?? true;
}

export function getDraftEditorWorkbenchLabel(
  commandId: DraftEditorCommandId,
  ui: LocaleMessages,
) {
  return getWritingEditorCommand(commandId)?.getWorkbenchLabel?.(ui) ?? commandId;
}

export function matchesShortcutLabel(shortcutLabel: string, event: KeyboardEvent) {
  const parts = shortcutLabel
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const expectedKey = parts.at(-1);
  if (!expectedKey) {
    return false;
  }

  return (
    (parts.includes('mod')
      ? (event.metaKey || event.ctrlKey)
      : (!event.metaKey && !event.ctrlKey)) &&
    (parts.includes('shift') ? event.shiftKey : !event.shiftKey) &&
    (parts.includes('alt') ? event.altKey : !event.altKey) &&
    event.key.toLowerCase() === expectedKey
  );
}

export function createWritingEditorToolbarButtonGroups(params: {
  labels: WritingEditorToolbarLabels;
  toolbarState: WritingEditorToolbarState;
  actions: WritingEditorToolbarActions;
  dropdownOptions: Partial<Record<'setFontFamily' | 'setFontSize', WritingEditorToolbarDropdownConfig['options']>>;
  styleModel: EditorDraftToolbarStyleModel;
}): {
  groups: readonly WritingEditorToolbarButtonGroup[];
  overflowMenuItems: readonly WritingEditorToolbarMenuItemConfig[];
} {
  const {
    labels,
    toolbarState,
    actions,
    dropdownOptions,
    styleModel,
  } = params;
  const groups = new Map<WritingEditorToolbarGroupId, WritingEditorToolbarItemConfig[]>();
  const overflowMenuItems: WritingEditorToolbarMenuItemConfig[] = [];

  for (const definition of writingEditorCommandDefinitions) {
    const toolbar = definition.toolbar;
    if (!toolbar) {
      continue;
    }

    const items = groups.get(toolbar.group) ?? [];
    if (toolbar.kind === 'dropdown') {
      const options = dropdownOptions[definition.id as 'setFontFamily' | 'setFontSize'] ?? [];
      if (definition.id === 'setFontFamily') {
        items.push(
          createFontFamilyToolbarSplitButton({
            labels,
            actions,
            model: styleModel.fontFamily,
            options,
          }),
        );
      } else if (definition.id === 'setFontSize') {
        items.push(
          createFontSizeToolbarSplitButton({
            labels,
            actions,
            model: styleModel.fontSize,
            options,
          }),
        );
      } else {
        items.push({
          label: toolbar.getLabel(labels),
          title: toolbar.getLabel(labels),
          value: toolbar.getValue(toolbarState),
          placeholder: toolbar.getPlaceholder(labels),
          options,
          onChange: (value) => {
            toolbar.run(actions, value);
          },
        });
      }
    } else {
      if (toolbar.overflowMenu) {
        overflowMenuItems.push({
          id: definition.id,
          label: toolbar.getLabel(labels),
          title: toolbar.getLabel(labels),
          checked: toolbar.isActive?.(toolbarState),
          disabled: toolbar.isEnabled ? !toolbar.isEnabled(toolbarState) : undefined,
          onClick: () => {
            toolbar.run(actions);
          },
        });
        continue;
      }

      items.push({
        label: toolbar.getLabel(labels),
        onClick: () => {
          toolbar.run(actions);
        },
        icon: toolbar.icon,
        glyph: toolbar.glyph,
        isActive: toolbar.isActive?.(toolbarState),
        disabled: toolbar.isEnabled ? !toolbar.isEnabled(toolbarState) : undefined,
        isToggle: typeof toolbar.isActive === 'function',
      });
    }
    groups.set(toolbar.group, items);
  }

  const headingSplit = createTextStyleToolbarSplitButton({
    labels,
    toolbarState,
    actions,
  });
  const formatItems = [...(groups.get('format') ?? [])];
  const fontSizeIndex = formatItems.findIndex(
    (item) => 'menu' in item && item.label === labels.fontSize,
  );
  const headingInsertIndex = fontSizeIndex >= 0 ? fontSizeIndex + 1 : formatItems.length;
  formatItems.splice(headingInsertIndex, 0, headingSplit);
  const leadingSplitLabels = [labels.fontFamily, labels.fontSize];
  const leadingSplitItems: WritingEditorToolbarItemConfig[] = [];
  for (const splitLabel of leadingSplitLabels) {
    const index = formatItems.findIndex(
      (item) => 'menu' in item && item.label === splitLabel,
    );
    if (index < 0) {
      continue;
    }

    const [item] = formatItems.splice(index, 1);
    if (item) {
      leadingSplitItems.push(item);
    }
  }
  formatItems.unshift(...leadingSplitItems);
  groups.set('format', formatItems);
  groups.delete('text');

  const buttonGroups = (['text', 'format', 'insert', 'history'] as const)
    .filter((groupId) => (groups.get(groupId)?.length ?? 0) > 0)
    .map((groupId) => ({
      title: getToolbarGroupTitle(groupId, labels),
      items: groups.get(groupId) ?? [],
    }));

  return {
    groups: buttonGroups,
    overflowMenuItems,
  };
}
