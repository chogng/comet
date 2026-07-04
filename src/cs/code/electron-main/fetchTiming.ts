function getCompatFetchEnvValue(name: string, legacyName: string) {
  return process.env[name] ?? process.env[legacyName];
}

export function isCompatFetchEnvEnabled(name: string, legacyName: string) {
  return getCompatFetchEnvValue(name, legacyName) !== '0';
}

export function getCompatFetchEnvValueOrDefault(
  name: string,
  legacyName: string,
  defaultValue: string,
) {
  return getCompatFetchEnvValue(name, legacyName) ?? defaultValue;
}

const FETCH_TIMING_LOG_ENABLED = isCompatFetchEnvEnabled(
  'LS_FETCH_TIMING',
  'READER_FETCH_TIMING',
);

export function createFetchTraceId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}

export function shortenForLog(value: string, maxLength = 120) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

export function timingLog(traceId: string, stage: string, details: Record<string, unknown> = {}) {
  if (!FETCH_TIMING_LOG_ENABLED) return;

  let encodedDetails = '';
  try {
    encodedDetails = JSON.stringify(details);
  } catch {
    encodedDetails = '{"error":"unserializable_log_details"}';
  }

  console.info(`[fetch-timing][${traceId}] ${stage} ${encodedDetails}`);
}
