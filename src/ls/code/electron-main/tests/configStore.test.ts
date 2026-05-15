import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { createConfigStore } from 'ls/platform/storage/electron-main/configStore';
import { getDefaultBatchSources } from 'ls/platform/config/common/defaultBatchSources';

async function withConfigStore(
  run: (
    store: ReturnType<typeof createConfigStore>,
    paths: { configFile: string; userSettingsFile: string },
  ) => Promise<void>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'literature-config-'));
  try {
    const configFile = path.join(tempDir, 'config', 'config.json');
    const userSettingsFile = path.join(tempDir, 'User', 'settings.json');
    await mkdir(path.dirname(userSettingsFile), { recursive: true });
    const store = createConfigStore(configFile, userSettingsFile, {
      defaultLocale: 'en',
    });

    await run(store, { configFile, userSettingsFile });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

type TestJournalSourceOverride = {
  url?: string;
  journalTitle?: string;
  preferredExtractorId?: string | null;
};

function getJournalSourceOverrides(settingsJson: unknown): TestJournalSourceOverride[] {
  return (settingsJson as {
    'literature.journalSourceOverrides'?: TestJournalSourceOverride[];
  })['literature.journalSourceOverrides'] ?? [];
}

test('config store reads journal source overrides from user settings json', async () => {
  await withConfigStore(async (store, { userSettingsFile }) => {
    await writeFile(
      userSettingsFile,
      JSON.stringify({
        'literature.journalSourceOverrides': [
          {
            url: 'https://example.com/latest',
            journalTitle: 'Example Journal',
            preferredExtractorId: 'example-latest',
          },
        ],
      }),
      'utf8',
    );

    const settings = await store.loadSettings();

    assert.equal(settings.configPath, userSettingsFile);
    assert.ok(
      settings.journalSourceOverrides.some(
        (source) =>
          source.url === 'https://example.com/latest' &&
          source.journalTitle === 'Example Journal' &&
          source.preferredExtractorId === 'example-latest',
      ),
    );
    assert.ok(
      settings.journalSourceOverrides.some(
        (source) =>
          source.url === 'https://www.science.org/toc/science/current' &&
          source.journalTitle === 'Science' &&
          source.preferredExtractorId === 'science-current-news-in-depth-research-articles',
      ),
    );
  });
});

test('config store keeps user settings json separate from saved app settings', async () => {
  await withConfigStore(async (store, { configFile, userSettingsFile }) => {
    const userSettings = {
      'literature.journalSourceOverrides': [
        {
          url: 'https://example.com/latest',
          journalTitle: 'Example Journal',
        },
      ],
    };
    await writeFile(userSettingsFile, JSON.stringify(userSettings), 'utf8');

    await store.saveSettings({
      defaultBatchLimit: 12,
      journalSourceOverrides: [
        {
          url: 'https://ignored.example/latest',
          journalTitle: 'Ignored',
        },
      ],
    });

    const savedConfig = JSON.parse(await readFile(configFile, 'utf8'));
    const savedUserSettings = JSON.parse(await readFile(userSettingsFile, 'utf8'));
    const settings = await store.loadSettings();

    assert.equal(savedConfig.defaultBatchLimit, 12);
    assert.deepEqual(savedConfig.journalSourceOverrides, []);
    const savedSourceOverrides = getJournalSourceOverrides(savedUserSettings);
    assert.ok(
      savedSourceOverrides.some(
        (source) =>
          JSON.stringify(source) ===
          JSON.stringify({
            url: 'https://example.com/latest',
            journalTitle: 'Example Journal',
            preferredExtractorId: null,
          }),
      ),
    );
    assert.ok(
      savedSourceOverrides.some(
        (source) =>
          JSON.stringify(source) ===
          JSON.stringify({
            url: 'https://www.science.org/toc/science/current',
            journalTitle: 'Science',
            preferredExtractorId: 'science-current-news-in-depth-research-articles',
          }),
      ),
    );
    assert.ok(
      settings.journalSourceOverrides.some(
        (source) =>
          source.url === 'https://example.com/latest' &&
          source.journalTitle === 'Example Journal',
      ),
    );
  });
});

test('config store creates user settings json with editable journal titles on first load', async () => {
  await withConfigStore(async (store, { userSettingsFile }) => {
    const settings = await store.loadSettings();
    const rawUserSettings = await readFile(userSettingsFile, 'utf8');
    const sourceOverrides = getJournalSourceOverrides(JSON.parse(rawUserSettings));
    const defaultSources = getDefaultBatchSources();

    assert.equal(settings.configPath, userSettingsFile);
    assert.equal(sourceOverrides.length, defaultSources.length);
    assert.deepEqual(sourceOverrides[0], {
      url: 'https://www.science.org/toc/science/current',
      journalTitle: 'Science',
      preferredExtractorId: 'science-current-news-in-depth-research-articles',
    });
  });
});

test('config store migrates legacy journal source overrides into user settings json', async () => {
  await withConfigStore(async (store, { configFile, userSettingsFile }) => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(
      configFile,
      JSON.stringify({
        journalSourceOverrides: [
          {
            url: 'https://legacy.example/latest',
            journalTitle: 'Legacy Journal',
            preferredExtractorId: 'legacy-latest',
          },
        ],
      }),
      'utf8',
    );

    const settings = await store.loadSettings();
    const rawUserSettings = await readFile(userSettingsFile, 'utf8');

    const sourceOverrides = getJournalSourceOverrides(JSON.parse(rawUserSettings));

    assert.ok(
      sourceOverrides.some(
        (source) =>
          JSON.stringify(source) ===
          JSON.stringify({
            url: 'https://legacy.example/latest',
            journalTitle: 'Legacy Journal',
            preferredExtractorId: 'legacy-latest',
          }),
      ),
    );
    assert.ok(
      settings.journalSourceOverrides.some(
        (source) =>
          source.url === 'https://legacy.example/latest' &&
          source.journalTitle === 'Legacy Journal' &&
          source.preferredExtractorId === 'legacy-latest',
      ),
    );
  });
});
