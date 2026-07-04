import assert from 'node:assert/strict';
import test from 'node:test';

import { isAppError } from 'cs/base/common/errors';
import { testLlmConnection } from 'cs/code/electron-main/llm/llm';

test('LLM connection test surfaces provider error response text', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message: '余额不足或无可用资源包,请充值。',
        },
      }),
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )) as typeof globalThis.fetch;

  try {
    await assert.rejects(
      () =>
        testLlmConnection({
          provider: 'glm',
          apiKey: 'test-key',
          baseUrl: 'https://example.test/v1',
          model: 'glm-5.2',
        }),
      error => {
        assert.ok(isAppError(error));
        assert.equal(error.code, 'LLM_CONNECTION_FAILED');
        assert.equal(error.details?.status, 429);
        assert.equal(error.details?.statusText, '余额不足或无可用资源包,请充值。');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
