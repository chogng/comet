export function resolveWindowsCommand(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  return command.endsWith('.cmd') || command.endsWith('.exe') ? command : `${command}.cmd`;
}
