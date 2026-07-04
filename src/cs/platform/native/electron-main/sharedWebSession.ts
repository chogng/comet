import type { Session } from 'electron';

export const WORKBENCH_SHARED_WEB_PARTITION = 'persist:comet-studio-web';

const defaultWorkbenchSharedSessionStorages = [
  'cookies',
  'localstorage',
  'indexdb',
  'cachestorage',
  'serviceworkers',
] as const;

export type WorkbenchSharedSessionStorage =
  typeof defaultWorkbenchSharedSessionStorages[number];

export async function resolveWorkbenchSharedSession(): Promise<Session | null> {
  try {
    const electronModule = (await import('electron')) as {
      app?: { isReady?: () => boolean };
      session?: {
        fromPartition?: (partition: string) => Session;
      };
    };

    const electronApp = electronModule.app;
    const electronSession = electronModule.session;
    if (!electronApp || typeof electronApp.isReady !== 'function' || !electronApp.isReady()) {
      return null;
    }
    if (!electronSession || typeof electronSession.fromPartition !== 'function') {
      return null;
    }

    return electronSession.fromPartition(WORKBENCH_SHARED_WEB_PARTITION);
  } catch {
    return null;
  }
}

export async function clearWorkbenchSharedSessionOrigins(
  origins: readonly string[],
  storages: readonly WorkbenchSharedSessionStorage[] = defaultWorkbenchSharedSessionStorages,
) {
  const workbenchSession = await resolveWorkbenchSharedSession();
  if (!workbenchSession) {
    return false;
  }

  try {
    for (const origin of origins) {
      await workbenchSession.clearStorageData({
        origin,
        storages: [...storages],
      });
    }
  } catch {
    // Ignore partial cleanup failures and continue with best-effort reset.
  }

  try {
    await workbenchSession.clearAuthCache();
  } catch {
    // Ignore auth-cache cleanup failures.
  }

  try {
    await workbenchSession.clearCache();
  } catch {
    // Ignore HTTP cache cleanup failures.
  }

  return true;
}

export async function clearWorkbenchSharedSessionCookies() {
  const workbenchSession = await resolveWorkbenchSharedSession();
  if (!workbenchSession) {
    return false;
  }

  try {
    await workbenchSession.clearStorageData({
      storages: ['cookies'],
    });
  } catch {
    // Ignore cookie cleanup failures and continue with best-effort reset.
  }

  try {
    await workbenchSession.clearAuthCache();
  } catch {
    // Ignore auth-cache cleanup failures.
  }

  return true;
}

export async function clearWorkbenchSharedSessionCache() {
  const workbenchSession = await resolveWorkbenchSharedSession();
  if (!workbenchSession) {
    return false;
  }

  try {
    await workbenchSession.clearStorageData({
      storages: ['cachestorage'],
    });
  } catch {
    // Ignore storage cleanup failures and continue with best-effort reset.
  }

  try {
    await workbenchSession.clearCache();
  } catch {
    // Ignore HTTP cache cleanup failures.
  }

  return true;
}
