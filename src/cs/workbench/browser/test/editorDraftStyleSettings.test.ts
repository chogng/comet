import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createDefaultEditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
	EditorDraftStyleService,
} from 'cs/editor/browser/text/editorDraftStyleService';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { SettingsController } from 'cs/workbench/contrib/preferences/browser/settingsController';
import { formatLocaleMessage } from 'cs/workbench/common/errorMessages';
import { WorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import type { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import { defaultBrowserTabKeepAliveLimit } from 'cs/workbench/services/webContent/webContentRetentionConfig';
import {
	maxBrowserTabKeepAliveLimit,
	minBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';
import {
	maxBrowserMaxHistoryEntries,
	minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { locales } from 'language/locales';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createSettingsController(
	invokeDesktop: ElectronInvoke,
	editorDraftStyleService: EditorDraftStyleService = new EditorDraftStyleService(),
): SettingsController {
	return new SettingsController(
		new SettingsModel(),
		{
			canInvoke: () => true,
			invoke: invokeDesktop,
		} as INativeHostService,
		new NoOpNotificationService(),
		{
			getLocale: () => 'en',
		} as IWorkbenchLocaleService,
		new WorkbenchLanguageService(),
		editorDraftStyleService,
	);
}

test('SettingsController uses the current locale for async completion notifications', async () => {
	let resolveTest!: (result: { provider: string; model: string }) => void;
	const testResult = new Promise<{ provider: string; model: string }>((resolve) => {
		resolveTest = resolve;
	});
	const invokeDesktop = (async (command: string) => {
		assert.equal(command, 'test_llm_connection');
		return testResult;
	}) as ElectronInvoke;
	let locale: 'en' | 'zh' = 'en';
	const notifications: string[] = [];
	const controller = new SettingsController(
		new SettingsModel(),
		{
			canInvoke: () => true,
			invoke: invokeDesktop,
		} as INativeHostService,
		{
			info: (message: string) => notifications.push(message),
		} as never,
		{
			getLocale: () => locale,
		} as IWorkbenchLocaleService,
		new WorkbenchLanguageService(),
		new EditorDraftStyleService(),
	);

	const operation = controller.handleTestLlmConnection();
	locale = 'zh';
	resolveTest({ provider: 'provider.test', model: 'model.test' });
	await operation;

	assert.deepEqual(notifications, [
		formatLocaleMessage(locales.zh.toastLlmConnectionSucceeded, {
			provider: 'provider.test',
			model: 'model.test',
		}),
	]);
	controller.dispose();
});

test('SettingsController syncs editorDraftStyleService through load and autosave', async () => {
	const editorDraftStyleService = new EditorDraftStyleService();
  const initialSnapshot = editorDraftStyleService.getSnapshot();
  const savePayloads: unknown[] = [];

  const invokeDesktop = (async (command: string, args?: { settings?: unknown }) => {
    if (command === 'load_settings') {
      return {
        editorDraftStyle: {
          defaultBodyStyle: {
            fontFamilyValue: '"Times New Roman", Times, serif',
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
        },
      };
    }

    if (command === 'save_settings') {
      savePayloads.push(args?.settings ?? null);
      return {
        ...(args?.settings as Record<string, unknown>),
        configPath: '/tmp/comet-studio.json',
      };
    }

    throw new Error(`Unexpected desktop command in editor draft style settings test: ${command}`);
  }) as ElectronInvoke;

	const controller = createSettingsController(invokeDesktop, editorDraftStyleService);

  try {
    controller.start();
    await flushMicrotasks();
    await delay(0);
    await flushMicrotasks();

    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.fontFamilyValue,
      '"Times New Roman", Times, serif',
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.fontSizeValue,
      '16px',
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingBeforePt,
      10,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingAfterPt,
      6,
    );
    assert.deepEqual(
      editorDraftStyleService.getSnapshot().fontFamilyPresets,
      initialSnapshot.fontFamilyPresets,
    );
    assert.deepEqual(
      editorDraftStyleService.getSnapshot().fontSizePresets,
      initialSnapshot.fontSizePresets,
    );
    assert.equal(savePayloads.length, 0);

    editorDraftStyleService.setSnapshot({
      ...editorDraftStyleService.getSnapshot(),
      defaultBodyStyle: {
        ...editorDraftStyleService.getSnapshot().defaultBodyStyle,
        fontFamilyValue: initialSnapshot.defaultBodyStyle.fontFamilyValue,
        fontSizeValue: initialSnapshot.defaultBodyStyle.fontSizeValue,
        lineHeight: initialSnapshot.defaultBodyStyle.lineHeight,
        paragraphSpacingBeforePt: initialSnapshot.defaultBodyStyle.paragraphSpacingBeforePt,
        paragraphSpacingAfterPt: initialSnapshot.defaultBodyStyle.paragraphSpacingAfterPt,
        color: initialSnapshot.defaultBodyStyle.color,
      },
    });

    controller.dispose();
    await flushMicrotasks();

    const lastPayload = savePayloads.at(-1) as
      | {
          editorDraftStyle?: {
            defaultBodyStyle?: {
              fontFamilyValue?: string;
              fontSizeValue?: string;
            };
          };
        }
      | undefined;
    assert(lastPayload);
    assert.equal(lastPayload.editorDraftStyle, undefined);
  } finally {
    controller.dispose();
  }
});

test('SettingsController editorDraft style handlers update service snapshot and persist changes', async () => {
	const editorDraftStyleService = new EditorDraftStyleService();
  const snapshotBeforeCustomize = editorDraftStyleService.getSnapshot();
  editorDraftStyleService.setSnapshot({
    ...snapshotBeforeCustomize,
    defaultBodyStyle: {
      ...snapshotBeforeCustomize.defaultBodyStyle,
      inlineStyleDefaults: {
        bold: true,
        italic: true,
        underline: true,
      },
    },
    fontFamilyPresets: [
      {
        value: '"Custom Sans", sans-serif',
        label: 'Custom Sans',
      },
    ],
    fontSizePresets: [
      {
        value: '15px',
        label: 'Custom Size',
      },
    ],
  });
  const savePayloads: unknown[] = [];

  const invokeDesktop = (async (command: string, args?: { settings?: unknown }) => {
    if (command === 'load_settings') {
      return {};
    }

    if (command === 'save_settings') {
      savePayloads.push(args?.settings ?? null);
      return {
        ...(args?.settings as Record<string, unknown>),
        configPath: '/tmp/comet-studio.json',
      };
    }

    throw new Error(`Unexpected desktop command in editor draft style settings test: ${command}`);
  }) as ElectronInvoke;

	const controller = createSettingsController(invokeDesktop, editorDraftStyleService);

  try {
    const runtimePresetsBeforeStart = editorDraftStyleService.getSnapshot();
    controller.start();
    await flushMicrotasks();

    assert.deepEqual(
      editorDraftStyleService.getSnapshot().fontFamilyPresets,
      runtimePresetsBeforeStart.fontFamilyPresets,
    );
    assert.deepEqual(
      editorDraftStyleService.getSnapshot().fontSizePresets,
      runtimePresetsBeforeStart.fontSizePresets,
    );

    controller.setEditorDraftFontFamily('"Times New Roman", Times, serif');
    controller.setEditorDraftFontSize('16px');
    controller.setEditorDraftLineHeight(1.6);
    controller.setEditorDraftParagraphSpacingBeforePt(14);
    controller.setEditorDraftParagraphSpacingAfterPt(9);
    controller.setEditorDraftColor('#112233');
    controller.setEditorDraftLineHeightFromInput('1.');
    controller.setEditorDraftParagraphSpacingBeforePtFromInput('14.5');
    controller.setEditorDraftParagraphSpacingAfterPtFromInput('9.5');

    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.fontFamilyValue,
      '"Times New Roman", Times, serif',
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.fontSizeValue,
      '16px',
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.lineHeight,
      1,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingBeforePt,
      14.5,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingAfterPt,
      9.5,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.color,
      '#112233',
    );
    controller.setEditorDraftLineHeightFromInput('.');
	controller.setEditorDraftLineHeightFromInput('1foo');
    controller.setEditorDraftParagraphSpacingBeforePtFromInput('.');
	controller.setEditorDraftParagraphSpacingBeforePtFromInput('15px');
    controller.setEditorDraftParagraphSpacingAfterPtFromInput('.');
	controller.setEditorDraftParagraphSpacingAfterPtFromInput('1e2');
    assert.equal(editorDraftStyleService.getSnapshot().defaultBodyStyle.lineHeight, 1);
    assert.equal(editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingBeforePt, 14.5);
    assert.equal(editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingAfterPt, 9.5);

    controller.handleResetEditorDraftStyle();

    const resetDefaults = createDefaultEditorDraftStyleSettings().defaultBodyStyle;
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.fontFamilyValue,
      resetDefaults.fontFamilyValue,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.fontSizeValue,
      resetDefaults.fontSizeValue,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.lineHeight,
      resetDefaults.lineHeight,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingBeforePt,
      resetDefaults.paragraphSpacingBeforePt,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.paragraphSpacingAfterPt,
      resetDefaults.paragraphSpacingAfterPt,
    );
    assert.equal(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.color,
      resetDefaults.color,
    );
    assert.deepEqual(
      editorDraftStyleService.getSnapshot().defaultBodyStyle.inlineStyleDefaults,
      {
        bold: true,
        italic: true,
        underline: true,
      },
    );
    assert.deepEqual(
      editorDraftStyleService.getSnapshot().fontFamilyPresets,
      runtimePresetsBeforeStart.fontFamilyPresets,
    );
    assert.deepEqual(
      editorDraftStyleService.getSnapshot().fontSizePresets,
      runtimePresetsBeforeStart.fontSizePresets,
    );

    controller.dispose();
    await flushMicrotasks();

    assert.ok(savePayloads.length > 0);
  } finally {
    controller.dispose();
  }
});

test('SettingsController loads and persists browser tab keep-alive limit', async () => {
  const savePayloads: unknown[] = [];

  const invokeDesktop = (async (command: string, args?: { settings?: unknown }) => {
    if (command === 'load_settings') {
      return {
        browserTabKeepAliveLimit: 5,
      };
    }

    if (command === 'save_settings') {
      savePayloads.push(args?.settings ?? null);
      return {
        ...(args?.settings as Record<string, unknown>),
        configPath: '/tmp/comet-studio.json',
      };
    }

    throw new Error(`Unexpected desktop command in browser tab keep-alive test: ${command}`);
  }) as ElectronInvoke;

  const controller = createSettingsController(invokeDesktop);

  try {
    controller.start();
    await flushMicrotasks();
    await delay(0);
    await flushMicrotasks();

    assert.equal(controller.getSnapshot().browserTabKeepAliveLimit, 5);

	controller.setBrowserTabKeepAliveLimit('0');
    await delay(0);
    await flushMicrotasks();

    const lastPayload = savePayloads.at(-1) as
      | {
          browserTabKeepAliveLimit?: number;
        }
      | undefined;
    assert.equal(lastPayload?.browserTabKeepAliveLimit, 0);

	controller.setBrowserTabKeepAliveLimit(String(defaultBrowserTabKeepAliveLimit));
    await delay(0);
    await flushMicrotasks();

    const restoredPayload = savePayloads.at(-1) as
      | {
          browserTabKeepAliveLimit?: number;
        }
      | undefined;
    assert.equal(
      restoredPayload?.browserTabKeepAliveLimit,
      defaultBrowserTabKeepAliveLimit,
    );
  } finally {
    controller.dispose();
  }
});

test('SettingsController owns strict numeric input normalization', () => {
	const controller = createSettingsController((async (command: string, args?: { settings?: unknown }) => {
		assert.equal(command, 'save_settings');
		return args?.settings ?? {};
	}) as ElectronInvoke);
	const initialSnapshot = controller.getSnapshot();

	controller.setBrowserTabKeepAliveLimit('');
	controller.setBrowserMaxHistoryEntries('12.5');
	controller.setMaxConcurrentIndexJobs('invalid');
	controller.setRetrievalCandidateCount('3items');
	controller.setRetrievalTopK('.');
	controller.setBrowserTabKeepAliveLimit('0x10');
	controller.setBrowserMaxHistoryEntries('1e2');
	controller.setMaxConcurrentIndexJobs('1.0');
	controller.setRetrievalCandidateCount('0b11');
	assert.deepEqual(controller.getSnapshot(), initialSnapshot);

	controller.setBrowserTabKeepAliveLimit('-20');
	controller.setBrowserMaxHistoryEntries('999999');
	controller.setMaxConcurrentIndexJobs('0');
	controller.setRetrievalCandidateCount('999');
	controller.setRetrievalTopK('999');

	assert.deepEqual(
		{
			browserTabKeepAliveLimit: controller.getSnapshot().browserTabKeepAliveLimit,
			browserMaxHistoryEntries: controller.getSnapshot().browserMaxHistoryEntries,
			maxConcurrentIndexJobs: controller.getSnapshot().maxConcurrentIndexJobs,
			retrievalCandidateCount: controller.getSnapshot().retrievalCandidateCount,
			retrievalTopK: controller.getSnapshot().retrievalTopK,
		},
		{
			browserTabKeepAliveLimit: minBrowserTabKeepAliveLimit,
			browserMaxHistoryEntries: maxBrowserMaxHistoryEntries,
			maxConcurrentIndexJobs: 1,
			retrievalCandidateCount: 20,
			retrievalTopK: 20,
		},
	);

	controller.setBrowserTabKeepAliveLimit('999');
	controller.setBrowserMaxHistoryEntries('-20');
	assert.equal(controller.getSnapshot().browserTabKeepAliveLimit, maxBrowserTabKeepAliveLimit);
	assert.equal(controller.getSnapshot().browserMaxHistoryEntries, minBrowserMaxHistoryEntries);
	controller.dispose();
});

test('SettingsModel ignores stale save results that resolve after newer saves', async () => {
  type SaveRequest = {
    readonly settings: Record<string, unknown>;
    readonly resolve: (value: Record<string, unknown>) => void;
  };

  const saveRequests: SaveRequest[] = [];
  const invokeDesktop = (async (command: string, args?: { settings?: unknown }) => {
    if (command === 'save_settings') {
      return new Promise<Record<string, unknown>>((resolve) => {
        saveRequests.push({
          settings: args?.settings as Record<string, unknown>,
          resolve,
        });
      });
    }

    throw new Error(`Unexpected desktop command in stale settings save test: ${command}`);
  }) as ElectronInvoke;
  const model = new SettingsModel();
  const saveContext = {
    desktopRuntime: true,
    invokeDesktop,
    locale: 'en' as const,
  };

  model.setBrowserTabKeepAliveLimit(1);
  const firstSave = model.saveSettingsDraft(saveContext);
  assert.equal(saveRequests.length, 1);

  model.setBrowserTabKeepAliveLimit(2);
  const secondSave = model.saveSettingsDraft(saveContext);
  assert.equal(saveRequests.length, 2);

  saveRequests[1]!.resolve({
    ...saveRequests[1]!.settings,
    configPath: '/tmp/comet-studio.json',
  });
  await secondSave;

  assert.equal(model.getSnapshot().browserTabKeepAliveLimit, 2);

  saveRequests[0]!.resolve({
    ...saveRequests[0]!.settings,
    configPath: '/tmp/comet-studio.json',
  });
  await firstSave;

  assert.equal(model.getSnapshot().browserTabKeepAliveLimit, 2);
});
