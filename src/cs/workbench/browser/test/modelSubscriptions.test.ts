/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import {
	ILibraryModel,
	LibraryModel,
} from 'cs/workbench/services/knowledgeBase/libraryModel';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import {
  getWorkbenchPartDomSnapshot,
  registerWorkbenchPartDomNode,
  subscribeWorkbenchPartDom,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
  subscribeStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
import {
  getPdfDownloadStatus,
  markPdfDownloadFailed,
  markPdfDownloadStarted,
  subscribePdfDownloadStatus,
} from 'cs/workbench/services/document/pdfDownloadStatus';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import {
	registerWorkbenchContribution,
	startWorkbenchContributions,
	stopWorkbenchContributions,
} from 'cs/workbench/common/contributions';
import {
	disposeWorkbenchInstantiationService,
	getWorkbenchInstantiationService,
	registerWorkbenchDisposable,
	registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

let cleanupDomEnvironment: (() => void) | null = null;
let originalDocumentLanguage = '';
let originalLocale: 'zh' | 'en';
let originalWorkbenchPartDomSnapshot = getWorkbenchPartDomSnapshot();
let originalStatusbarState = getStatusbarStateSnapshot();

function createInvokeDesktop(): ElectronInvoke {
  return (async (command: string) => {
    throw new Error(`Unexpected desktop command in model subscriptions test: ${command}`);
  }) as ElectronInvoke;
}

function createLibraryDocumentSummary(
  overrides: Partial<LibraryDocumentSummary> = {},
): LibraryDocumentSummary {
  return {
    documentId: 'doc-1',
    title: 'Document One',
    doi: null,
    authors: ['Ada Lovelace'],
    journalTitle: 'Journal',
    publishedAt: '2024-01-01',
    sourceUrl: 'https://example.com/doc-1',
    sourceId: 'source-1',
    ingestStatus: 'ready',
    fileCount: 1,
    latestFilePath: '/tmp/doc-1.pdf',
    latestDownloadedAt: '2024-01-02T00:00:00.000Z',
    latestJobType: 'extract',
    latestJobStatus: 'completed',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function createLibraryDocumentsResult(
  items: readonly LibraryDocumentSummary[],
): LibraryDocumentsResult {
  return {
    items: [...items],
    totalCount: items.length,
    fileCount: items.reduce((count, item) => count + item.fileCount, 0),
    queuedJobCount: 0,
    libraryDbFile: '/tmp/library.db',
    defaultManagedDirectory: '/tmp/library',
    ragCacheDir: '/tmp/rag-cache',
  };
}

function restoreWorkbenchPartDomSnapshot() {
  const partIds = Array.from(
    new Set(Object.values(WORKBENCH_PART_IDS)),
  ) as Array<(typeof WORKBENCH_PART_IDS)[keyof typeof WORKBENCH_PART_IDS]>;

  for (const partId of partIds) {
    registerWorkbenchPartDomNode(partId, originalWorkbenchPartDomSnapshot[partId]);
  }
}

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  originalDocumentLanguage = document.documentElement.lang;
  originalLocale = localeService.getLocale();
  originalWorkbenchPartDomSnapshot = getWorkbenchPartDomSnapshot();
  originalStatusbarState = getStatusbarStateSnapshot();
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

afterEach(() => {
  localeService.applyLocale(originalLocale);
  document.documentElement.lang = originalDocumentLanguage;
  restoreWorkbenchPartDomSnapshot();
  setStatusbarState(originalStatusbarState);
  document.body.replaceChildren();
});

test('localeService subscriptions can be disposed independently', () => {
  const receivedLocales: Array<'zh' | 'en'> = [];
  const disposeListener = localeService.subscribe(() => {
    receivedLocales.push(localeService.getLocale());
  });

  localeService.applyLocale(originalLocale === 'en' ? 'zh' : 'en');
  disposeListener();
  localeService.applyLocale(originalLocale);

  assert.equal(receivedLocales.length, 1);
});

test('LibraryModel subscriptions stop after listener disposal and model dispose', () => {
  const registrations = getSingletonServiceDescriptors().filter(([id]) => id === ILibraryModel);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][1].supportsDelayedInstantiation, true);

  const model = new LibraryModel({
    canInvoke: () => false,
    invoke: createInvokeDesktop(),
  } as never);
  const itemCounts: number[] = [];
  const disposeListener = model.subscribe(() => {
    itemCounts.push(model.getSnapshot().librarySnapshot.items.length);
  });

  model.upsertDocumentSummary(createLibraryDocumentSummary());
  disposeListener();
  model.removeDocumentSummary('doc-1');
  model.dispose();
  model.dispose();
  model.upsertDocumentSummary(
    createLibraryDocumentSummary({
      documentId: 'doc-2',
      sourceUrl: 'https://example.com/doc-2',
    }),
  );

  assert.deepEqual(itemCounts, [1]);
  assert.equal(model.getSnapshot().librarySnapshot.items.length, 1);
});

test('LibraryModel starts once and commits only the latest refresh', async () => {
  const requests: Array<{
    resolve: (result: LibraryDocumentsResult) => void;
  }> = [];
  const model = new LibraryModel({
    canInvoke: () => true,
    invoke: (async (command: string) => {
      assert.equal(command, 'list_library_documents');
      return new Promise<LibraryDocumentsResult>((resolve) => {
        requests.push({ resolve });
      });
    }) as ElectronInvoke,
  } as never);
  assert.equal(requests.length, 1);

  const latestRefresh = model.refresh();
  assert.equal(requests.length, 2);
  const latest = createLibraryDocumentSummary({
    documentId: 'latest',
    sourceUrl: 'https://example.com/latest',
  });
  requests[1]!.resolve(createLibraryDocumentsResult([latest]));
  await latestRefresh;

  const stale = createLibraryDocumentSummary({
    documentId: 'stale',
    sourceUrl: 'https://example.com/stale',
  });
  requests[0]!.resolve(createLibraryDocumentsResult([stale]));
  await Promise.resolve();

  assert.deepEqual(
    model.getSnapshot().librarySnapshot.items.map(item => item.documentId),
    ['latest'],
  );
  model.dispose();
});

test('LibraryModel does not publish a pending refresh after disposal', async () => {
  let resolveRefresh!: (result: LibraryDocumentsResult) => void;
  const refreshPromise = new Promise<LibraryDocumentsResult>((resolve) => {
    resolveRefresh = resolve;
  });
  const model = new LibraryModel({
    canInvoke: () => true,
    invoke: (async () => refreshPromise) as ElectronInvoke,
  } as never);
  let changes = 0;
  model.subscribe(() => {
    changes += 1;
  });

  model.dispose();
  resolveRefresh(createLibraryDocumentsResult([createLibraryDocumentSummary()]));
  await refreshPromise;
  await Promise.resolve();

  assert.equal(changes, 0);
});

test('SettingsModel subscriptions stop after disposal', () => {
  const model = new SettingsModel();
  const useMicaValues: boolean[] = [];
  const disposeListener = model.subscribe(() => {
    useMicaValues.push(model.getSnapshot().useMica);
  });

  model.setUseMica(!model.getSnapshot().useMica);
  disposeListener();
  model.setStatusbarVisible(!model.getSnapshot().statusbarVisible);

  assert.equal(useMicaValues.length, 1);
});

test('pdfDownloadStatus subscriptions stop after disposal', () => {
  const pageUrl = 'https://example.com/pdf-download/subscriptions';
  let notificationCount = 0;
  const disposeListener = subscribePdfDownloadStatus(() => {
    notificationCount += 1;
  });

  markPdfDownloadStarted(pageUrl);
  disposeListener();
  markPdfDownloadFailed(pageUrl, 'network error');

  assert.equal(notificationCount, 1);
  assert.equal(getPdfDownloadStatus(pageUrl).lastError, 'network error');
});

test('statusbarModel subscriptions stop after disposal', () => {
  let notificationCount = 0;
  const disposeListener = subscribeStatusbarState(() => {
    notificationCount += 1;
  });

  setStatusbarState({
    ariaLabel: 'Status',
    paneMode: 'browser',
    modeLabel: 'Source',
    summary: 'Ready',
    leftItems: [],
    rightItems: [],
  });
  disposeListener();
  setStatusbarState({
    ariaLabel: 'Status',
    paneMode: 'pdf',
    modeLabel: 'PDF',
    summary: 'Updated',
    leftItems: [],
    rightItems: [],
  });

  assert.equal(notificationCount, 1);
  assert.equal(getStatusbarStateSnapshot().summary, 'Updated');
});

test('workbenchPartDom subscriptions stop after disposal', () => {
  const element = document.createElement('div');
  let notificationCount = 0;
  const disposeListener = subscribeWorkbenchPartDom(() => {
    notificationCount += 1;
  });

  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, element);
  disposeListener();
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, null);

  assert.equal(notificationCount, 1);
  assert.equal(getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.editor], null);
});

test('workbench contributions clean up a partial failed start and can restart', () => {
	const transitions: string[] = [];
	const startError = new Error('contribution startup failed');
	let shouldFailStart = true;

	registerWorkbenchContribution(() => {
		transitions.push('start:first');
		return {
			dispose: () => transitions.push('dispose:first'),
		};
	});
	registerWorkbenchContribution(() => {
		transitions.push('start:second');
		if (shouldFailStart) {
			shouldFailStart = false;
			throw startError;
		}
		return {
			dispose: () => transitions.push('dispose:second'),
		};
	});

	assert.throws(startWorkbenchContributions, error => error === startError);
	assert.deepEqual(transitions, [
		'start:first',
		'start:second',
		'dispose:first',
	]);

	try {
		startWorkbenchContributions();
	} finally {
		stopWorkbenchContributions();
	}
	assert.deepEqual(transitions, [
		'start:first',
		'start:second',
		'dispose:first',
		'start:first',
		'start:second',
		'dispose:second',
		'dispose:first',
	]);
});

test('workbench contributions instantiate factories registered during startup exactly once', () => {
	const transitions: string[] = [];
	let hasRegisteredNestedFactory = false;

	registerWorkbenchContribution(() => {
		transitions.push('start:parent');
		if (!hasRegisteredNestedFactory) {
			hasRegisteredNestedFactory = true;
			registerWorkbenchContribution(() => {
				transitions.push('start:nested');
				return {
					dispose: () => transitions.push('dispose:nested'),
				};
			});
		}
		return {
			dispose: () => transitions.push('dispose:parent'),
		};
	});

	startWorkbenchContributions();
	stopWorkbenchContributions();
	assert.deepEqual(transitions, [
		'start:parent',
		'start:nested',
		'dispose:nested',
		'dispose:parent',
	]);

	transitions.length = 0;
	startWorkbenchContributions();
	stopWorkbenchContributions();
	assert.deepEqual(transitions, [
		'start:parent',
		'start:nested',
		'dispose:nested',
		'dispose:parent',
	]);
});

test('workbench contributions finish LIFO cleanup after dispose errors and can restart', () => {
	const transitions: string[] = [];
	const firstDisposeError = new Error('first contribution dispose failed');
	const secondDisposeError = new Error('second contribution dispose failed');
	let shouldFailFirstDispose = true;
	let shouldFailSecondDispose = true;

	registerWorkbenchContribution(() => ({
		dispose: () => transitions.push('dispose:retained'),
	}));
	registerWorkbenchContribution(() => ({
		dispose: () => {
			transitions.push('dispose:first-error');
			if (shouldFailFirstDispose) {
				shouldFailFirstDispose = false;
				throw firstDisposeError;
			}
		},
	}));
	registerWorkbenchContribution(() => ({
		dispose: () => {
			transitions.push('dispose:second-error');
			if (shouldFailSecondDispose) {
				shouldFailSecondDispose = false;
				throw secondDisposeError;
			}
		},
	}));

	startWorkbenchContributions();
	assert.throws(stopWorkbenchContributions, error => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [secondDisposeError, firstDisposeError]);
		return true;
	});
	assert.deepEqual(transitions, [
		'dispose:second-error',
		'dispose:first-error',
		'dispose:retained',
	]);

	transitions.length = 0;
	startWorkbenchContributions();
	stopWorkbenchContributions();
	assert.deepEqual(transitions, [
		'dispose:second-error',
		'dispose:first-error',
		'dispose:retained',
	]);
});

interface IThrowingWorkbenchTeardownService {
	readonly _serviceBrand: undefined;
}

const IThrowingWorkbenchTeardownService = createDecorator<IThrowingWorkbenchTeardownService>(
	'throwingWorkbenchTeardownService',
);

class ThrowingWorkbenchTeardownService implements IThrowingWorkbenchTeardownService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly transitions: string[],
		private readonly error: Error,
	) {}

	dispose(): void {
		this.transitions.push('dispose:instantiation-service');
		throw this.error;
	}
}

test('workbench instantiation teardown releases every stage and aggregates failures', () => {
	const transitions: string[] = [];
	const registeredError = new Error('registered disposable failed');
	const serviceError = new Error('instantiation service failed');

	registerWorkbenchService(
		IThrowingWorkbenchTeardownService,
		new SyncDescriptor(ThrowingWorkbenchTeardownService, [transitions, serviceError]),
	);
	getWorkbenchInstantiationService().invokeFunction(accessor => {
		accessor.get(IThrowingWorkbenchTeardownService);
	});
	registerWorkbenchDisposable({
		dispose: () => transitions.push('dispose:registered-tail'),
	});
	registerWorkbenchDisposable({
		dispose: () => {
			transitions.push('dispose:registered-error');
			throw registeredError;
		},
	});

	try {
		assert.throws(disposeWorkbenchInstantiationService, error => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [registeredError, serviceError]);
			return true;
		});
		assert.deepEqual(transitions, [
			'dispose:registered-error',
			'dispose:registered-tail',
			'dispose:instantiation-service',
		]);
	} finally {
		getWorkbenchInstantiationService();
	}
});
