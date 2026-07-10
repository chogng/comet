import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { createConfigurationMainService } from 'cs/platform/configuration/electron-main/configurationService';
import {
  BaseSecretStorageService,
  ProviderApiKeySecretStorage,
} from 'cs/platform/secrets/common/secret';
import { createStorageMainService } from 'cs/platform/storage/electron-main/storageMainService';
import { getDefaultBatchSources } from 'cs/platform/configuration/common/defaultBatchSources';
import type { EditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';

async function withConfigurationService(
  run: (
    service: ReturnType<typeof createConfigurationMainService>,
    paths: { configFile: string; userSettingsFile: string },
  ) => Promise<void>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'literature-config-'));
  const storageMainService = createStorageMainService({
    stateDbFile: path.join(tempDir, 'state.vscdb'),
  });
  const secretStorageService = new BaseSecretStorageService(storageMainService);
  try {
    const configFile = path.join(tempDir, 'config', 'config.json');
    const userSettingsFile = path.join(tempDir, 'User', 'settings.json');
    await mkdir(path.dirname(userSettingsFile), { recursive: true });
    await storageMainService.init();
    const service = createConfigurationMainService(configFile, userSettingsFile, {
      defaultLocale: 'en',
      providerApiKeySecretStorage: new ProviderApiKeySecretStorage(secretStorageService),
    });

    await run(service, { configFile, userSettingsFile });
  } finally {
    secretStorageService.dispose();
    await storageMainService.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

type TestJournalSourceOverride = {
  url?: string;
  journalTitle?: string;
  preferredExtractorId?: string | null;
	fetchTarget?: 'background' | 'webContentsView';
};

function getJournalSourceOverrides(settingsJson: unknown): TestJournalSourceOverride[] {
  return (settingsJson as {
    'literature.journalSourceOverrides'?: TestJournalSourceOverride[];
  })['literature.journalSourceOverrides'] ?? [];
}

function createTestEditorDraftStyle(fontFamilyValue: string): EditorDraftStyleSettings {
  return {
    defaultBodyStyle: {
      fontFamilyValue,
      fontSizeValue: '16px',
      lineHeight: 1.6,
      paragraphSpacingBeforePt: 10,
      paragraphSpacingAfterPt: 6,
      color: '#112233',
      inlineStyleDefaults: {
        bold: false,
        italic: false,
        underline: false,
      },
    },
  };
}

test('configuration service reads journal source overrides from user settings json', async () => {
  await withConfigurationService(async (service, { userSettingsFile }) => {
    await writeFile(
      userSettingsFile,
      JSON.stringify({
        'literature.journalSourceOverrides': [
          {
            url: 'https://example.com/latest',
            journalTitle: 'Example Journal',
            preferredExtractorId: 'example-latest',
						fetchTarget: 'webContentsView',
          },
        ],
      }),
      'utf8',
    );

    const settings = await service.loadSettings();

    assert.equal(settings.configPath, userSettingsFile);
    assert.ok(
      settings.journalSourceOverrides.some(
        (source) =>
          source.url === 'https://example.com/latest' &&
          source.journalTitle === 'Example Journal' &&
					source.preferredExtractorId === 'example-latest' &&
					source.fetchTarget === 'webContentsView',
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

test('configuration service keeps user settings json separate from saved app settings', async () => {
  await withConfigurationService(async (service, { configFile, userSettingsFile }) => {
    const userSettings = {
      'literature.journalSourceOverrides': [
        {
          url: 'https://example.com/latest',
          journalTitle: 'Example Journal',
        },
      ],
    };
    await writeFile(userSettingsFile, JSON.stringify(userSettings), 'utf8');

    await service.saveSettings({
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
    const settings = await service.loadSettings();

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
						fetchTarget: 'background',
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
						fetchTarget: 'background',
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

test('configuration service reads editor draft style only from user settings json', async () => {
  await withConfigurationService(async (service, { configFile, userSettingsFile }) => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(
      configFile,
      JSON.stringify({
        editorDraftStyle: createTestEditorDraftStyle('"Config Serif", serif'),
      }),
      'utf8',
    );
    await writeFile(
      userSettingsFile,
      JSON.stringify({
        'literature.editorDraftStyle': createTestEditorDraftStyle('"User Sans", sans-serif'),
      }),
      'utf8',
    );

    const settings = await service.loadSettings();

    assert.equal(
      settings.editorDraftStyle.defaultBodyStyle.fontFamilyValue,
      '"User Sans", sans-serif',
    );
  });
});

test('configuration service ignores legacy editor draft style from config json', async () => {
  await withConfigurationService(async (service, { configFile }) => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(
      configFile,
      JSON.stringify({
        editorDraftStyle: createTestEditorDraftStyle('"Legacy Serif", serif'),
      }),
      'utf8',
    );

    const settings = await service.loadSettings();

    assert.notEqual(
      settings.editorDraftStyle.defaultBodyStyle.fontFamilyValue,
      '"Legacy Serif", serif',
    );
  });
});

test('configuration service saves editor draft style into user settings json', async () => {
  await withConfigurationService(async (service, { configFile, userSettingsFile }) => {
    const nextEditorDraftStyle = createTestEditorDraftStyle('"Saved Sans", sans-serif');

    await service.saveSettings({
      defaultBatchLimit: 12,
      editorDraftStyle: nextEditorDraftStyle,
    });

    const savedConfig = JSON.parse(await readFile(configFile, 'utf8'));
    const savedUserSettings = JSON.parse(await readFile(userSettingsFile, 'utf8'));
    const savedEditorDraftStyle = savedUserSettings['literature.editorDraftStyle'];
    const settings = await service.loadSettings();

    assert.equal(savedConfig.editorDraftStyle, undefined);
    assert.equal(
      savedEditorDraftStyle.defaultBodyStyle.fontFamilyValue,
      '"Saved Sans", sans-serif',
    );
    assert.equal(
      settings.editorDraftStyle.defaultBodyStyle.fontFamilyValue,
      '"Saved Sans", sans-serif',
    );
  });
});

test('configuration service creates user settings json with editable journal titles on first load', async () => {
  await withConfigurationService(async (service, { userSettingsFile }) => {
    const settings = await service.loadSettings();
    const rawUserSettings = await readFile(userSettingsFile, 'utf8');
    const sourceOverrides = getJournalSourceOverrides(JSON.parse(rawUserSettings));
    const defaultSources = getDefaultBatchSources();

    assert.equal(settings.configPath, userSettingsFile);
    assert.equal(sourceOverrides.length, defaultSources.length);
    assert.deepEqual(sourceOverrides[0], {
      url: 'https://www.science.org/toc/science/current',
      journalTitle: 'Science',
      preferredExtractorId: 'science-current-news-in-depth-research-articles',
		fetchTarget: 'background',
    });
  });
});

test('configuration service migrates legacy journal source overrides into user settings json', async () => {
  await withConfigurationService(async (service, { configFile, userSettingsFile }) => {
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

    const settings = await service.loadSettings();
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
						fetchTarget: 'background',
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

test('configuration service saves user settings into a changed config path', async () => {
  await withConfigurationService(async (service, { configFile, userSettingsFile }) => {
    const customUserSettingsFile = path.join(
      path.dirname(userSettingsFile),
      'custom',
      'settings.json',
    );
    const nextEditorDraftStyle = createTestEditorDraftStyle('"Moved Sans", sans-serif');

    await writeFile(
      userSettingsFile,
      JSON.stringify({
        'literature.journalSourceOverrides': [
          {
            url: 'https://example.com/latest',
            journalTitle: 'Example Journal',
          },
        ],
      }),
      'utf8',
    );

    await service.saveSettings({
      userSettingsPathOverride: customUserSettingsFile,
      editorDraftStyle: nextEditorDraftStyle,
    });

    const savedConfig = JSON.parse(await readFile(configFile, 'utf8'));
    const movedUserSettings = JSON.parse(await readFile(customUserSettingsFile, 'utf8'));
    const settings = await service.loadSettings();

    assert.equal(savedConfig.userSettingsPathOverride, customUserSettingsFile);
    assert.equal(settings.configPath, customUserSettingsFile);
    assert.ok(
      getJournalSourceOverrides(movedUserSettings).some(
        (source) =>
          source.url === 'https://example.com/latest' &&
          source.journalTitle === 'Example Journal',
      ),
    );
    assert.equal(
      movedUserSettings['literature.editorDraftStyle'].defaultBodyStyle.fontFamilyValue,
      '"Moved Sans", sans-serif',
    );
  });
});

test('configuration service saves custom translation provider settings', async () => {
  await withConfigurationService(async (service, { configFile }) => {
    const translation = createDefaultTranslationSettings();
    translation.activeProvider = 'custom';
    translation.providers.custom = {
      apiKey: 'custom-key',
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      models: ['custom-model', 'custom-large'],
    };

    await service.saveSettings({ translation });

    const savedConfig = JSON.parse(await readFile(configFile, 'utf8'));
    const settings = await service.loadSettings();

    assert.equal(savedConfig.translation.activeProvider, 'custom');
    assert.deepEqual(savedConfig.translation.providers.custom, {
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      models: ['custom-model', 'custom-large'],
    });
    assert.deepEqual(settings.translation.providers.custom, {
      apiKey: 'custom-key',
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      models: ['custom-model', 'custom-large'],
    });
  });
});

test('configuration service migrates provider api keys out of config json', async () => {
  await withConfigurationService(async (service, { configFile }) => {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(
      configFile,
      JSON.stringify({
        translation: {
          activeProvider: 'custom',
          providers: {
            custom: {
              apiKey: 'legacy-custom-key',
              baseUrl: 'https://custom.example/v1',
              model: 'custom-model',
              models: ['custom-model'],
            },
          },
        },
      }),
      'utf8',
    );

    const settings = await service.loadSettings();
    const savedConfig = JSON.parse(await readFile(configFile, 'utf8'));

    assert.equal(settings.translation.providers.custom.apiKey, 'legacy-custom-key');
    assert.equal(savedConfig.translation.providers.custom.apiKey, undefined);
    assert.deepEqual(savedConfig.translation.providers.custom, {
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      models: ['custom-model'],
    });
  });
});
