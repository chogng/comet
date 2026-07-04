import {
  commandService,
  commandsRegistry,
  type CommandService,
} from 'cs/platform/commands/common/commands';
import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IWorkbenchCommandService =
  createDecorator<IWorkbenchCommandService>('workbenchCommandService');

export interface IWorkbenchCommandService extends CommandService {
  readonly _serviceBrand: undefined;
}

export class WorkbenchCommandServiceAdapter
  implements IWorkbenchCommandService
{
  declare readonly _serviceBrand: undefined;

  constructor(private readonly delegate: CommandService) {}

  executeCommand<TResult = unknown>(
    commandId: string,
    ...args: unknown[]
  ): TResult | undefined {
    return this.delegate.executeCommand<TResult>(commandId, ...args);
  }
}

export function createWorkbenchCommandService(
  delegate: CommandService = commandService,
): IWorkbenchCommandService {
  return new WorkbenchCommandServiceAdapter(delegate);
}

registerSingleton(
  IWorkbenchCommandService,
  new SyncDescriptor(WorkbenchCommandServiceAdapter, [commandService], true),
);

export { commandService, commandsRegistry };
export type {
  CommandDefinition,
  CommandHandler,
  CommandId,
  CommandRegistry,
  RegisteredCommand,
} from 'cs/platform/commands/common/commands';
