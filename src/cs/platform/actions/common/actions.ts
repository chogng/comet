import {
  type IAction,
  SubmenuAction,
} from 'cs/base/common/actions';
import { EventEmitter, type Event } from 'cs/base/common/event';
import {
  DisposableStore,
  dispose,
  type IDisposable,
  markAsSingleton,
  toDisposable,
} from 'cs/base/common/lifecycle';
import {
  commandService,
  commandsRegistry,
} from 'cs/platform/commands/common/commands';
import {
  ContextKeyExpr,
  contextKeyService,
  type ContextKeyExpression,
  type ContextKeyService,
} from 'cs/platform/contextkey/common/contextkey';
import {
  KeybindingsRegistry,
  type IKeybindingRule,
} from 'cs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import {
  isICommandActionToggleInfo,
  type ICommandAction,
  type ICommandActionTitle,
  type Icon,
  type ILocalizedString,
} from 'cs/platform/action/common/action';

type CommandActionLabel = string | ICommandActionTitle;

export interface IMenuItem {
  command: ICommandAction;
  alt?: ICommandAction;
  when?: ContextKeyExpression;
  group?: 'navigation' | string;
  order?: number;
  isHiddenByDefault?: boolean;
}

export interface ISubmenuItem {
  title: CommandActionLabel;
  submenu: MenuId;
  icon?: Icon;
  when?: ContextKeyExpression;
  group?: 'navigation' | string;
  order?: number;
  isSelection?: boolean;
  isSplitButton?:
    | boolean
    | {
        togglePrimaryAction: true;
      };
}

export function isIMenuItem(item: unknown): item is IMenuItem {
  return Boolean((item as IMenuItem | undefined)?.command);
}

export function isISubmenuItem(item: unknown): item is ISubmenuItem {
  return Boolean((item as ISubmenuItem | undefined)?.submenu);
}

export class MenuId {
  private static readonly instances = new Map<string, MenuId>();

  static readonly CommandPalette = new MenuId('CommandPalette');
  static readonly EditorContext = new MenuId('EditorContext');
  static readonly EditorTitle = new MenuId('EditorTitle');
  static readonly EditorTitleContext = new MenuId('EditorTitleContext');
  static readonly EditorTabsBarContext = new MenuId('EditorTabsBarContext');
  static readonly MenubarFileMenu = new MenuId('MenubarFileMenu');
  static readonly MenubarEditMenu = new MenuId('MenubarEditMenu');
  static readonly MenubarViewMenu = new MenuId('MenubarViewMenu');
  static readonly MenubarHelpMenu = new MenuId('MenubarHelpMenu');
  static readonly SidebarTitle = new MenuId('SidebarTitle');
  static readonly ViewTitle = new MenuId('ViewTitle');
  static readonly ViewTitleContext = new MenuId('ViewTitleContext');
  static readonly BrowserActionsToolbar = new MenuId('BrowserActionsToolbar');
  static readonly BrowserChatActionsMenu = new MenuId('BrowserChatActionsMenu');
  static readonly BrowserEmulationToolbar = new MenuId('BrowserEmulationToolbar');
  static readonly BrowserNavigationToolbar = new MenuId('BrowserNavigationToolbar');

  static for(identifier: string): MenuId {
    return MenuId.instances.get(identifier) ?? new MenuId(identifier);
  }

  readonly id: string;

  constructor(identifier: string) {
    if (MenuId.instances.has(identifier)) {
      throw new TypeError(
        `MenuId with identifier '${identifier}' already exists.`,
      );
    }

    MenuId.instances.set(identifier, this);
    this.id = identifier;
  }
}

export interface IMenuActionOptions {
  arg?: unknown;
  args?: unknown[];
  shouldForwardArgs?: boolean;
  renderShortTitle?: boolean;
}

export interface IMenuChangeEvent {
  readonly menu: IMenu;
  readonly isStructuralChange: boolean;
  readonly isToggleChange: boolean;
  readonly isEnablementChange: boolean;
}

export interface IMenu extends IDisposable {
  readonly onDidChange: Event<IMenuChangeEvent>;
  getActions(
    options?: IMenuActionOptions,
  ): [string, Array<MenuItemAction | SubmenuItemAction>][];
}

export interface IMenuRegistryChangeEvent {
  has(id: MenuId): boolean;
}

class MenuRegistryChangeEvent implements IMenuRegistryChangeEvent {
  constructor(private readonly changedMenuId: MenuId) {}

  has(id: MenuId): boolean {
    return id === this.changedMenuId;
  }
}

type CommandsMap = Map<string, ICommandAction>;

export interface IMenuRegistry {
  readonly onDidChangeMenu: Event<IMenuRegistryChangeEvent>;
  addCommand(userCommand: ICommandAction): IDisposable;
  getCommand(id: string): ICommandAction | undefined;
  getCommands(): CommandsMap;
  appendMenuItems(
    items: Iterable<{ id: MenuId; item: IMenuItem | ISubmenuItem }>,
  ): IDisposable;
  appendMenuItem(menu: MenuId, item: IMenuItem | ISubmenuItem): IDisposable;
  getMenuItems(menu: MenuId): Array<IMenuItem | ISubmenuItem>;
}

export const MenuRegistry: IMenuRegistry = new (class implements IMenuRegistry {
  private readonly commands = new Map<string, ICommandAction>();
  private readonly menuItems = new Map<MenuId, Array<IMenuItem | ISubmenuItem>>();
  private readonly onDidChangeMenuEmitter =
    new EventEmitter<IMenuRegistryChangeEvent>();

  readonly onDidChangeMenu = this.onDidChangeMenuEmitter.event;

  addCommand(userCommand: ICommandAction): IDisposable {
    this.commands.set(userCommand.id, userCommand);
    this.onDidChangeMenuEmitter.fire(
      new MenuRegistryChangeEvent(MenuId.CommandPalette),
    );

    return markAsSingleton(
      toDisposable(() => {
        if (this.commands.delete(userCommand.id)) {
          this.onDidChangeMenuEmitter.fire(
            new MenuRegistryChangeEvent(MenuId.CommandPalette),
          );
        }
      }),
    );
  }

  getCommand(id: string): ICommandAction | undefined {
    return this.commands.get(id);
  }

  getCommands(): CommandsMap {
    return new Map(this.commands);
  }

  appendMenuItems(
    items: Iterable<{ id: MenuId; item: IMenuItem | ISubmenuItem }>,
  ): IDisposable {
    const store = new DisposableStore();
    for (const { id, item } of items) {
      store.add(this.appendMenuItem(id, item));
    }
    return store;
  }

  appendMenuItem(menu: MenuId, item: IMenuItem | ISubmenuItem): IDisposable {
    const items = this.menuItems.get(menu) ?? [];
    items.push(item);
    this.menuItems.set(menu, items);
    this.onDidChangeMenuEmitter.fire(new MenuRegistryChangeEvent(menu));

    return markAsSingleton(
      toDisposable(() => {
        const index = items.indexOf(item);
        if (index >= 0) {
          items.splice(index, 1);
          this.onDidChangeMenuEmitter.fire(new MenuRegistryChangeEvent(menu));
        }
      }),
    );
  }

  getMenuItems(menu: MenuId): Array<IMenuItem | ISubmenuItem> {
    const result = [...(this.menuItems.get(menu) ?? [])];
    if (menu === MenuId.CommandPalette) {
      const registeredIds = new Set(
        result.filter(isIMenuItem).map((item) => item.command.id),
      );
      for (const command of this.commands.values()) {
        if (!registeredIds.has(command.id)) {
          result.push({ command });
        }
      }
    }

    return result;
  }
})();

export class MenuItemAction implements IAction {
  static label(action: ICommandAction, options?: IMenuActionOptions): string {
    const title =
      options?.renderShortTitle && action.shortTitle
        ? action.shortTitle
        : action.title;
    return localizeCommandLabel(title);
  }

  readonly item: ICommandAction;
  readonly alt: MenuItemAction | undefined;
  readonly id: string;
  readonly label: string;
  readonly tooltip: string;
  readonly class: string | undefined;
  readonly enabled: boolean;
  readonly checked?: boolean;

  constructor(
    item: ICommandAction,
    alt: ICommandAction | undefined,
    private readonly options: IMenuActionOptions | undefined,
    readonly hideActions: IMenuItemHide | undefined,
    readonly menuKeybinding: IAction | undefined,
    private readonly contextKeyServiceValue: ContextKeyService = contextKeyService,
  ) {
    this.item = item;
    this.id = item.id;
    this.label = MenuItemAction.label(item, options);
    this.tooltip = localizeOptionalCommandLabel(item.tooltip) ?? '';
    this.enabled =
      !item.precondition ||
      contextKeyServiceValue.contextMatchesRules(item.precondition);
    this.checked = this.resolveChecked(item);
    this.alt = alt
      ? new MenuItemAction(
          alt,
          undefined,
          options,
          hideActions,
          undefined,
          contextKeyServiceValue,
        )
      : undefined;
    this.class = iconClassName(item.icon);
  }

  run(...args: unknown[]): unknown {
    let runArgs: unknown[] = [];
    if (this.options?.args) {
      runArgs = [...runArgs, ...this.options.args];
    } else if ('arg' in (this.options ?? {})) {
      runArgs = [...runArgs, this.options?.arg];
    }

    if (this.options?.shouldForwardArgs) {
      runArgs = [...runArgs, ...args];
    }

    return commandService.executeCommand(this.id, ...runArgs);
  }

  private resolveChecked(item: ICommandAction): boolean | undefined {
    if (!item.toggled) {
      return undefined;
    }

    const expression = isICommandActionToggleInfo(item.toggled)
      ? item.toggled.condition
      : item.toggled;
    return this.contextKeyServiceValue.contextMatchesRules(expression);
  }
}

export class SubmenuItemAction extends SubmenuAction {
  constructor(
    readonly item: ISubmenuItem,
    readonly hideActions: IMenuItemHide | undefined,
    actions: readonly IAction[],
  ) {
    super(
      `submenuitem.${item.submenu.id}`,
      localizeCommandLabel(item.title),
      actions,
      'submenu',
    );
  }
}

export interface IMenuItemHide {
  readonly isHidden: boolean;
  readonly hide: IAction;
  readonly toggle: IAction;
}

interface IAction2CommonOptions extends ICommandAction {
  menu?:
    | ({ id: MenuId; precondition?: ContextKeyExpression | null } & Omit<
        IMenuItem,
        'command'
      >)
    | Array<
        { id: MenuId; precondition?: ContextKeyExpression | null } & Omit<
          IMenuItem,
          'command'
        >
      >;
  keybinding?:
    | Omit<IKeybindingRule, 'id'>
    | Array<Omit<IKeybindingRule, 'id'>>;
}

interface IBaseAction2Options extends IAction2CommonOptions {
  f1?: false;
}

export interface ICommandPaletteOptions extends IAction2CommonOptions {
  title: CommandActionLabel;
  f1: true;
}

export type IAction2Options = ICommandPaletteOptions | IBaseAction2Options;

export abstract class Action2 {
  constructor(readonly desc: Readonly<IAction2Options>) {}

  abstract run(accessor: ServicesAccessor, ...args: unknown[]): unknown;
}

export function registerAction2(ctor: { new (): Action2 }): IDisposable {
  const disposables: IDisposable[] = [];
  const action = new ctor();
  const { f1, menu, keybinding, ...command } = action.desc;

  if (commandsRegistry.getCommand(command.id)) {
    throw new Error(`Cannot register two commands with the same id: ${command.id}`);
  }

  disposables.push(
    commandsRegistry.registerCommand(command.id, (accessor, ...args) =>
      action.run(accessor, ...args),
    ),
  );

  if (Array.isArray(menu)) {
    for (const item of menu) {
      disposables.push(registerMenuItem(command, item));
    }
  } else if (menu) {
    disposables.push(registerMenuItem(command, menu));
  }

  if (f1) {
    disposables.push(
      MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
        command,
        when: command.precondition,
      }),
    );
    disposables.push(MenuRegistry.addCommand(command));
  }

  if (Array.isArray(keybinding)) {
    for (const item of keybinding) {
      disposables.push(registerKeybinding(command, item));
    }
  } else if (keybinding) {
    disposables.push(registerKeybinding(command, keybinding));
  }

  return toDisposable(() => dispose(disposables));
}

export function getMenuActions(
  menuId: MenuId,
  contextService: ContextKeyService = contextKeyService,
  options?: IMenuActionOptions,
): [string, Array<MenuItemAction | SubmenuItemAction>][] {
  return getMenuActionsFor(menuId, contextService, options, new Set());
}

function getMenuActionsFor(
  menuId: MenuId,
  contextService: ContextKeyService,
  options: IMenuActionOptions | undefined,
  parentMenus: ReadonlySet<MenuId>,
): [string, Array<MenuItemAction | SubmenuItemAction>][] {
  if (parentMenus.has(menuId)) {
    return [];
  }

  const nestedParentMenus = new Set(parentMenus);
  nestedParentMenus.add(menuId);
  const groups = new Map<string, Array<MenuItemAction | SubmenuItemAction>>();

  for (const item of MenuRegistry.getMenuItems(menuId)) {
    if (isIMenuItem(item)) {
      if (!contextService.contextMatchesRules(item.when)) {
        continue;
      }

      const group = item.group ?? '';
      const actions = groups.get(group) ?? [];
      actions.push(
        new MenuItemAction(
          item.command,
          item.alt,
          options,
          undefined,
          undefined,
          contextService,
        ),
      );
      groups.set(group, actions);
      continue;
    }

    if (!contextService.contextMatchesRules(item.when)) {
      continue;
    }

    const group = item.group ?? '';
    const actions = groups.get(group) ?? [];
    const submenuActions = getMenuActionsFor(
      item.submenu,
      contextService,
      options,
      nestedParentMenus,
    ).flatMap(([, submenuGroupActions]) => submenuGroupActions);
    actions.push(new SubmenuItemAction(item, undefined, submenuActions));
    groups.set(group, actions);
  }

  return [...groups.entries()];
}

function registerMenuItem(
  command: ICommandAction,
  item: { id: MenuId; precondition?: ContextKeyExpression | null } & Omit<
    IMenuItem,
    'command'
  >,
): IDisposable {
  const { id, precondition, ...rest } = item;
  return MenuRegistry.appendMenuItem(id, {
    command: {
      ...command,
      precondition:
        precondition === null ? undefined : (precondition ?? command.precondition),
    },
    ...rest,
  });
}

function registerKeybinding(
  command: ICommandAction,
  item: Omit<IKeybindingRule, 'id'>,
): IDisposable {
  return KeybindingsRegistry.registerKeybindingRule({
    ...item,
    id: command.id,
    when: command.precondition
      ? ContextKeyExpr.and(command.precondition, item.when)
      : item.when,
  });
}

function localizeCommandLabel(label: CommandActionLabel): string {
  return typeof label === 'string' ? label : label.value;
}

function localizeOptionalCommandLabel(
  label: string | ILocalizedString | undefined,
): string | undefined {
  return label === undefined
    ? undefined
    : typeof label === 'string'
      ? label
      : label.value;
}

function iconClassName(icon: Icon | undefined): string | undefined {
  if (!icon) {
    return undefined;
  }

  if (typeof icon === 'string') {
    return icon;
  }

  if ('id' in icon) {
    return icon.id;
  }

  return undefined;
}
