import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createDefaultEditorDraftStyleSettings } from 'ls/base/common/editorDraftStyle';
import type { ElectronInvoke } from 'ls/base/parts/sandbox/common/desktopTypes';
import { editorDraftStyleService } from 'ls/editor/browser/text/editorDraftStyleService';
import { createSettingsController } from 'ls/workbench/contrib/preferences/browser/settingsController';
import { locales } from 'language/locales';
import { defaultBrowserTabKeepAliveLimit } from 'ls/workbench/services/webContent/webContentRetentionConfig';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('SettingsController syncs editorDraftStyleService through load and autosave', async () => {
  editorDraftStyleService.resetToCatalog();
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
        configPath: '/tmp/literature-studio.json',
      };
    }

    throw new Error(`Unexpected desktop command in editor draft style settings test: ${command}`);
  }) as ElectronInvoke;

  const controller = createSettingsController({
    desktopRuntime: true,
    invokeDesktop,
    ui: locales.en,
    locale: 'en',
  });

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
    assert.equal(
      lastPayload.editorDraftStyle?.defaultBodyStyle?.fontFamilyValue,
      initialSnapshot.defaultBodyStyle.fontFamilyValue,
    );
    assert.equal(
      lastPayload.editorDraftStyle?.defaultBodyStyle?.fontSizeValue,
      initialSnapshot.defaultBodyStyle.fontSizeValue,
    );
  } finally {
    controller.dispose();
    editorDraftStyleService.resetToCatalog();
  }
});

test('SettingsController editorDraft style handlers update service snapshot and persist changes', async () => {
  editorDraftStyleService.resetToCatalog();
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
        configPath: '/tmp/literature-studio.json',
      };
    }

    throw new Error(`Unexpected desktop command in editor draft style settings test: ${command}`);
  }) as ElectronInvoke;

  const controller = createSettingsController({
    desktopRuntime: true,
    invokeDesktop,
    ui: locales.en,
    locale: 'en',
  });

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
    controller.setEditorDraftParagraphSpacingBeforePtFromInput('.');
    controller.setEditorDraftParagraphSpacingAfterPtFromInput('.');
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
    editorDraftStyleService.resetToCatalog();
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
        configPath: '/tmp/literature-studio.json',
      };
    }

    throw new Error(`Unexpected desktop command in browser tab keep-alive test: ${command}`);
  }) as ElectronInvoke;

  const controller = createSettingsController({
    desktopRuntime: true,
    invokeDesktop,
    ui: locales.en,
    locale: 'en',
  });

  try {
    controller.start();
    await flushMicrotasks();
    await delay(0);
    await flushMicrotasks();

    assert.equal(controller.getSnapshot().browserTabKeepAliveLimit, 5);

    controller.setBrowserTabKeepAliveLimit(0);
    await delay(0);
    await flushMicrotasks();

    const lastPayload = savePayloads.at(-1) as
      | {
          browserTabKeepAliveLimit?: number;
        }
      | undefined;
    assert.equal(lastPayload?.browserTabKeepAliveLimit, 0);

    controller.setBrowserTabKeepAliveLimit(defaultBrowserTabKeepAliveLimit);
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
