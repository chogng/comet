export const defaultBrowserTabKeepAliveLimit = 2;
export const minBrowserTabKeepAliveLimit = 0;
export const maxBrowserTabKeepAliveLimit = 12;

export function normalizeBrowserTabKeepAliveLimit(
  value: unknown,
  fallbackValue = defaultBrowserTabKeepAliveLimit,
) {
  const normalizedFallback = Number.isFinite(fallbackValue)
    ? Math.min(
        maxBrowserTabKeepAliveLimit,
        Math.max(minBrowserTabKeepAliveLimit, Math.trunc(fallbackValue)),
      )
    : defaultBrowserTabKeepAliveLimit;
  const parsedValue = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsedValue)) {
    return normalizedFallback;
  }

  return Math.min(
    maxBrowserTabKeepAliveLimit,
    Math.max(minBrowserTabKeepAliveLimit, parsedValue),
  );
}
