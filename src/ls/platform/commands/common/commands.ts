import type { DisposableLike } from 'ls/base/common/lifecycle';
import { toDisposable } from 'ls/base/common/lifecycle';

export type CommandId = string;

export type CommandHandler<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
> = (...args: TArgs) => TResult;

export type CommandDefinition<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
> = {
  readonly id: CommandId;
  readonly handler: CommandHandler<TArgs, TResult>;
};

export type RegisteredCommand = CommandDefinition<unknown[], unknown>;

export interface CommandRegistry {
  registerCommand<TArgs extends unknown[], TResult>(
    command: CommandDefinition<TArgs, TResult>,
  ): DisposableLike;
  registerCommand<TArgs extends unknown[], TResult>(
    id: CommandId,
    handler: CommandHandler<TArgs, TResult>,
  ): DisposableLike;
  getCommand(id: CommandId): RegisteredCommand | null;
  getCommands(): readonly RegisteredCommand[];
}

export class CommandRegistryImpl implements CommandRegistry {
  private readonly commands = new Map<CommandId, RegisteredCommand>();

  registerCommand<TArgs extends unknown[], TResult>(
    commandOrId: CommandDefinition<TArgs, TResult> | CommandId,
    handler?: CommandHandler<TArgs, TResult>,
  ): DisposableLike {
    const command =
      typeof commandOrId === 'string'
        ? {
            id: commandOrId,
            handler,
          }
        : commandOrId;

    if (!command.handler) {
      throw new Error(`Command '${command.id}' must provide a handler.`);
    }

    if (this.commands.has(command.id)) {
      throw new Error(`Command '${command.id}' is already registered.`);
    }

    const registered = command as RegisteredCommand;
    this.commands.set(command.id, registered);

    return toDisposable(() => {
      if (this.commands.get(command.id) === registered) {
        this.commands.delete(command.id);
      }
    });
  }

  getCommand(id: CommandId): RegisteredCommand | null {
    return this.commands.get(id) ?? null;
  }

  getCommands(): readonly RegisteredCommand[] {
    return [...this.commands.values()];
  }
}

export interface CommandService {
  executeCommand<TResult = unknown>(
    commandId: CommandId,
    ...args: unknown[]
  ): TResult | undefined;
}

export class CommandServiceImpl implements CommandService {
  constructor(private readonly registry: CommandRegistry) {}

  executeCommand<TResult = unknown>(
    commandId: CommandId,
    ...args: unknown[]
  ): TResult | undefined {
    const command = this.registry.getCommand(commandId);
    if (!command) {
      return undefined;
    }

    return command.handler(...args) as TResult;
  }
}

export const commandsRegistry: CommandRegistry = new CommandRegistryImpl();
export const commandService: CommandService = new CommandServiceImpl(
  commandsRegistry,
);
