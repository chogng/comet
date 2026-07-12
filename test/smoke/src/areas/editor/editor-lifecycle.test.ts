/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert = require('node:assert/strict');
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

import type { Code } from '../../../../automation';
import {
	createSmokeTestContext,
	disposeSmokeTestContext,
	type SmokeTestContext,
} from '../../fixtures';

type RendererSnapshot = {
	readonly activeTabKind: string | null;
	readonly rendererWebviewCount: number;
	readonly settingsOverlayVisible: boolean;
	readonly browserContainer: {
		readonly childCount: number;
		readonly bounds: {
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
		};
	} | null;
	readonly hasWorkbench: boolean;
	readonly tabCount: number;
};

type WebContentState = {
	readonly targetId: string | null;
	readonly activeTargetId: string | null;
	readonly ownership: 'active' | 'inactive';
	readonly layoutPhase: 'hidden' | 'measuring' | 'visible';
	readonly visible: boolean;
};

type BrowserDomSnapshot = {
	readonly href: string;
	readonly title: string;
	readonly heading: string;
	readonly paragraphCount: number;
	readonly bodyTextSample: string;
};

type PlaywrightSmokeSnapshot = {
	readonly title: string;
	readonly containsHeading: boolean;
	readonly cancellationRejected: boolean;
	readonly deferredFunctionStarted: boolean;
	readonly lifecycleCommandRejected: boolean;
};

type SessionsReloadSnapshot = {
	readonly headerTitle: string | null;
	readonly hasChatInput: boolean;
	readonly storedState: {
		readonly slots: readonly { readonly kind: string; readonly sessionId?: string }[];
		readonly activeSlotIndex: number;
	} | null;
};

type EditorViewStateStorageSnapshot = {
	readonly version: number;
	readonly entries: readonly {
		readonly key: {
			readonly groupId: string;
			readonly paneId: string;
			readonly resourceKey: string;
		};
		readonly state: {
			readonly url: string;
			readonly scrollX: number;
			readonly scrollY: number;
		};
	}[];
};

const editorGroupsLocalStorageKey = 'comet.workbench.storage.workspace.workbench.editorGroups';
const editorViewStateLocalStorageKey = 'comet.workbench.storage.workspace.workbench.editor.viewState';
const sessionsViewStateLocalStorageKey = 'comet.workbench.storage.application.sessions.viewState';

function createSmokePageHtml(delayedContent = false): string {
	const sections = Array.from({ length: 180 }, (_, index) =>
		`<p>Smoke section ${index + 1}: editor lifecycle hide and restore check.</p>`,
	).join('\n');

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Electron Smoke</title>
		<style>
			body { margin: 0; font-family: ui-serif, Georgia, serif; line-height: 1.6; }
			main { max-width: 720px; margin: 0 auto; padding: 48px 24px 240px; }
			p { margin: 0 0 20px; }
		</style>
	</head>
	<body>
		<main>
			<h1>Editor Lifecycle Smoke</h1>
			<div id="smoke-sections"${delayedContent ? ' hidden' : ''}>${sections}</div>
		</main>
		${delayedContent ? `<script>
			setTimeout(() => document.getElementById('smoke-sections').removeAttribute('hidden'), 800);
		</script>` : ''}
	</body>
</html>`;
}

async function startSmokeServer(): Promise<{ server: Server; url: string }> {
	const server = createServer((request, response) => {
		const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
		if (requestUrl.pathname === '/favicon.ico') {
			response.writeHead(204);
			response.end();
			return;
		}
		if (requestUrl.pathname !== '/browser-smoke.html') {
			response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
			response.end('Not found');
			return;
		}

		response.writeHead(200, {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		});
		response.end(createSmokePageHtml(requestUrl.searchParams.get('delayed') === '1'));
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address() as AddressInfo;
	return {
		server,
		url: `http://127.0.0.1:${address.port}/browser-smoke.html`,
	};
}

async function stopSmokeServer(server: Server | undefined): Promise<void> {
	if (!server) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		server.close(error => error ? reject(error) : resolve());
	});
}

function createSeedWorkspace(smokeUrl: string, includeDraft = true): object {
	const draftDocument = {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				attrs: { blockId: 'block-smoke-a' },
				content: [{ type: 'text', text: 'Draft smoke content' }],
			},
		],
	};
	return {
		groups: [
			{
				id: 'editor-group-a',
				editors: [
					{
						typeId: 'workbench.editorinputs.browser',
						value: JSON.stringify({
							id: 'browser-a',
							title: 'Smoke Browser',
							url: smokeUrl,
						}),
					},
					...(includeDraft ? [{
						typeId: 'workbench.input.draft',
						value: JSON.stringify({
							id: 'draft-a',
							title: 'Smoke Draft',
							document: draftDocument,
							resource: 'comet-draft:draft-a',
						}),
					}] : []),
				],
				mostRecentlyActiveEditorIndexes: includeDraft ? [0, 1] : [0],
				activeEditorIndex: 0,
			},
		],
		activeGroupId: 'editor-group-a',
	};
}

async function getRendererSnapshot(code: Code): Promise<RendererSnapshot> {
	return code.evaluate<RendererSnapshot>(`(() => ({
		activeTabKind: document.querySelector('.comet-editor-tab.comet-is-active')?.dataset.paneMode ?? null,
		rendererWebviewCount: document.querySelectorAll('webview').length,
		browserContainer: (() => {
			const host = document.querySelector('.browser-root .browser-container');
			const bounds = host?.getBoundingClientRect();
			return host instanceof HTMLElement
				? {
					childCount: host.childElementCount,
					bounds: {
						x: Math.round(bounds?.left ?? 0),
						y: Math.round(bounds?.top ?? 0),
						width: Math.round(bounds?.width ?? 0),
						height: Math.round(bounds?.height ?? 0),
					},
				}
				: null;
		})(),
		hasWorkbench: Boolean(document.querySelector('.comet-sessions-content-grid')),
		settingsOverlayVisible: Boolean(document.querySelector('.comet-settings-overlay:not([hidden])')),
		tabCount: document.querySelectorAll('.comet-editor-tab').length,
	}))()`);
}

async function getSessionsReloadSnapshot(code: Code): Promise<SessionsReloadSnapshot> {
	return code.evaluate<SessionsReloadSnapshot>(`(() => {
		const header = document.querySelector('.comet-session-view.comet-is-active .comet-session-header');
		const stored = window.localStorage.getItem(${JSON.stringify(sessionsViewStateLocalStorageKey)});
		return {
			headerTitle: header instanceof HTMLElement && !header.hidden
				? header.querySelector('.comet-session-header-title')?.textContent ?? null
				: null,
			hasChatInput: Boolean(document.querySelector('.comet-session-view.comet-is-active textarea.comet-chat-composer-input')),
			storedState: stored ? JSON.parse(stored) : null,
		};
	})()`);
}

async function getEditorViewStateStorage(code: Code): Promise<EditorViewStateStorageSnapshot | null> {
	return code.evaluate<EditorViewStateStorageSnapshot | null>(`(() => {
		const stored = window.localStorage.getItem(${JSON.stringify(editorViewStateLocalStorageKey)});
		return stored ? JSON.parse(stored) : null;
	})()`);
}

async function getEditorGroupsStorage(code: Code): Promise<unknown> {
	return code.evaluate(`(() => {
		const stored = window.localStorage.getItem(${JSON.stringify(editorGroupsLocalStorageKey)});
		return stored ? JSON.parse(stored) : null;
	})()`);
}

function hasAlignedBrowserBounds(
	renderer: RendererSnapshot,
	nativeBounds: Awaited<ReturnType<Code['getVisibleWebContentsViewBounds']>>,
) {
	const containerBounds = renderer.browserContainer?.bounds;
	const viewBounds = nativeBounds[0];
	return Boolean(
		containerBounds &&
		viewBounds &&
		nativeBounds.length === 1 &&
		containerBounds.x === viewBounds.x &&
		containerBounds.y === viewBounds.y &&
		containerBounds.width === viewBounds.width &&
		containerBounds.height === viewBounds.height,
	);
}

async function getContentState(
	code: Code,
	targetId: string,
): Promise<WebContentState> {
	return code.evaluate<WebContentState>(`(async () => {
		return window.electronAPI.webContent.getState(${JSON.stringify(targetId)});
	})()`);
}

async function executeTargetScript<T>(
	code: Code,
	targetId: string,
	script: string,
): Promise<T> {
	return code.evaluate<T>(`(async () => {
		return window.electronAPI.webContent.executeJavaScript(
			${JSON.stringify(targetId)},
			${JSON.stringify(script)},
			2000
		);
	})()`);
}

async function getBrowserDomSnapshot(
	code: Code,
	targetId: string,
): Promise<BrowserDomSnapshot> {
	return executeTargetScript<BrowserDomSnapshot>(
		code,
		targetId,
		`(() => {
			const normalize = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
			return {
				href: location.href,
				title: document.title,
				heading: normalize(document.querySelector('h1')?.textContent),
				paragraphCount: document.querySelectorAll('main p').length,
				bodyTextSample: normalize(document.body?.textContent).slice(0, 120),
			};
		})()`,
	);
}

async function captureAndBlockPlaywrightSnapshot(
	code: Code,
	targetId: string,
): Promise<PlaywrightSmokeSnapshot> {
	return code.evaluate<PlaywrightSmokeSnapshot>(`(async () => {
		const ipc = window.electronAPI.ipc;
		if (!ipc) {
			throw new Error('Electron IPC is unavailable.');
		}
		const lifecycleCommandRejected = await ipc.call('playwright', 'shutdown').then(
			() => false,
			() => true,
		);
		const lease = await ipc.call('playwright', 'acquirePageTracking', [${JSON.stringify(targetId)}]);
		const snapshot = await ipc.call('playwright', 'captureSnapshot', [
			'editor-lifecycle-smoke',
			lease,
			{ readiness: { selector: 'main h1', state: 'visible', minimumCount: 1 }, timeoutMs: 5000 },
		]);
		const cancellationId = 'editor-lifecycle-cancelled-snapshot';
		const cancelledSnapshot = ipc.call(
			'playwright',
			'captureSnapshot',
			[
				'editor-lifecycle-smoke',
				lease,
				{ readiness: { selector: '#comet-never-ready', state: 'attached', minimumCount: 1 }, timeoutMs: 60000 },
			],
			cancellationId,
		);
		setTimeout(() => ipc.cancel(cancellationId), 50);
		const cancellationRejected = await cancelledSnapshot.then(
			() => false,
			() => true,
		);
		const deferredFunction = await ipc.call('playwright', 'invokeFunction', [
			'editor-lifecycle-smoke',
			${JSON.stringify(targetId)},
			'async page => page.evaluate(() => new Promise(() => {}))',
			[],
			10,
		]);
		globalThis.__cometBlockedPlaywrightSnapshot = ipc.call(
			'playwright',
			'captureSnapshot',
			[
				'editor-lifecycle-smoke',
				lease,
				{ readiness: { selector: '#comet-never-ready', state: 'attached', minimumCount: 1 }, timeoutMs: 60000 },
			],
			'editor-lifecycle-blocked-snapshot',
		).then(
			() => ({ status: 'fulfilled' }),
			error => ({ status: 'rejected', message: error instanceof Error ? error.message : String(error) }),
		);
		return {
			title: snapshot.title,
			containsHeading: snapshot.html.includes('Editor Lifecycle Smoke'),
			cancellationRejected,
			deferredFunctionStarted: typeof deferredFunction.deferredResultId === 'string',
			lifecycleCommandRejected,
		};
	})()`);
}

async function setBrowserScroll(
	code: Code,
	targetId: string,
	scrollTop: number,
): Promise<number> {
	return executeTargetScript<number>(
		code,
		targetId,
		`(() => {
			window.scrollTo(0, ${scrollTop});
			return Math.round(window.scrollY || document.scrollingElement?.scrollTop || 0);
		})()`,
	);
}

async function getBrowserScroll(
	code: Code,
	targetId: string,
): Promise<number> {
	return executeTargetScript<number>(
		code,
		targetId,
		`(() => Math.round(window.scrollY || document.scrollingElement?.scrollTop || 0))()`,
	);
}

suite('Editor lifecycle smoke', function() {
	this.timeout(120_000);

	let context: SmokeTestContext | undefined;
	let server: Server | undefined;

	teardown(async () => {
		await disposeSmokeTestContext(context);
		context = undefined;
		await stopSmokeServer(server);
		server = undefined;
	});

	test('retains a hidden browser target and restores its scroll position', async () => {
		const smokeServer = await startSmokeServer();
		server = smokeServer.server;
		context = await createSmokeTestContext('editor-lifecycle');

		const application = context.application;
		await application.start();
		await application.reloadWithLocalStorage({
			[editorGroupsLocalStorageKey]: JSON.stringify(
				createSeedWorkspace(smokeServer.url),
			),
		});
		await application.workbench.ensureEditorExpanded();

		const code = application.code;
		await code.waitForCondition(
			'editor workbench bootstrap',
			() => getRendererSnapshot(code),
			snapshot => snapshot.hasWorkbench && snapshot.tabCount >= 2,
		);

		await code.waitForCondition(
			'initial browser target activation',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
				browser: await getBrowserDomSnapshot(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				result.renderer.rendererWebviewCount === 0 &&
				hasAlignedBrowserBounds(result.renderer, result.nativeBounds) &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.ownership === 'active' &&
				result.state.visible &&
				result.state.layoutPhase === 'visible' &&
				result.browser.href === smokeServer.url &&
				result.browser.heading === 'Editor Lifecycle Smoke' &&
				result.browser.paragraphCount === 180,
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		const scrolledTo = await setBrowserScroll(code, 'browser-a', 960);
		assert.ok(scrolledTo >= 900, `Expected browser target to scroll, got ${scrolledTo}.`);

		await code.click('.comet-sidebar-footer-settings-btn');
		await code.waitForCondition(
			'browser target hide while Settings covers the editor',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
				browser: await getBrowserDomSnapshot(code, 'browser-a'),
				scrollTop: await getBrowserScroll(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				result.renderer.settingsOverlayVisible &&
				result.nativeBounds.length === 0 &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.ownership === 'active' &&
				!result.state.visible &&
				result.state.layoutPhase === 'hidden' &&
				result.browser.heading === 'Editor Lifecycle Smoke' &&
				result.scrollTop >= 900,
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		await code.page.locator('.comet-settings-overlay').click({ position: { x: 8, y: 8 } });
		await code.waitForCondition(
			'browser target restoration after closing Settings',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
				browser: await getBrowserDomSnapshot(code, 'browser-a'),
				scrollTop: await getBrowserScroll(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				!result.renderer.settingsOverlayVisible &&
				hasAlignedBrowserBounds(result.renderer, result.nativeBounds) &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.ownership === 'active' &&
				result.state.visible &&
				result.state.layoutPhase === 'visible' &&
				result.browser.href === smokeServer.url &&
				result.browser.heading === 'Editor Lifecycle Smoke' &&
				result.scrollTop >= 900,
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		await code.click(
			'.comet-editor-tab[data-pane-mode="draft"] .comet-editor-tab-main',
		);
		await code.waitForCondition(
			'browser target hide after activating the draft',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
				browser: await getBrowserDomSnapshot(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'draft' &&
				result.renderer.rendererWebviewCount === 0 &&
				result.renderer.browserContainer === null &&
				result.nativeBounds.length === 0 &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.ownership === 'active' &&
				!result.state.visible &&
				result.state.layoutPhase === 'hidden' &&
				result.browser.heading === 'Editor Lifecycle Smoke',
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		await code.click(
			'.comet-editor-tab[data-pane-mode="browser"] .comet-editor-tab-main',
		);
		const restored = await code.waitForCondition(
			'browser target restoration',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
				browser: await getBrowserDomSnapshot(code, 'browser-a'),
				scrollTop: await getBrowserScroll(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				hasAlignedBrowserBounds(result.renderer, result.nativeBounds) &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.ownership === 'active' &&
				result.state.visible &&
				result.state.layoutPhase === 'visible' &&
				result.browser.heading === 'Editor Lifecycle Smoke' &&
				result.browser.paragraphCount === 180 &&
				result.scrollTop >= 900,
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		assert.ok(restored.scrollTop >= 900);

		await code.click('.comet-editor-titlebar-toggle-editor-btn');
		await code.waitForCondition(
			'browser target hide after collapsing the editor',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
			}),
			result =>
				result.renderer.browserContainer?.bounds.width === 0 &&
				result.renderer.browserContainer.bounds.height === 0 &&
				result.nativeBounds.length === 0 &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.ownership === 'active' &&
				!result.state.visible &&
				result.state.layoutPhase === 'hidden',
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		await application.workbench.ensureEditorExpanded();
		await code.waitForCondition(
			'browser target bounds after expanding the editor',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
				scrollTop: await getBrowserScroll(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				hasAlignedBrowserBounds(result.renderer, result.nativeBounds) &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.visible &&
				result.state.layoutPhase === 'visible' &&
				result.scrollTop >= 900,
			{ timeoutMs: 30_000, intervalMs: 150 },
		);
	});

	test('persists the active Session view state before reload teardown', async () => {
		context = await createSmokeTestContext('sessions-reload');
		const application = context.application;
		await application.start();
		const code = application.code;

		await code.page.getByRole('button', { name: 'New chat', exact: true }).click();
		const beforeReload = await code.waitForCondition(
			'active draft Session before reload',
			() => getSessionsReloadSnapshot(code),
			snapshot => Boolean(snapshot.headerTitle) && snapshot.hasChatInput,
		);
		assert.ok(beforeReload.headerTitle);

		await code.reload();
		const afterReload = await code.waitForCondition(
			'active draft Session restored after reload',
			() => getSessionsReloadSnapshot(code),
			snapshot =>
				snapshot.headerTitle === beforeReload.headerTitle
				&& snapshot.hasChatInput
				&& snapshot.storedState?.slots[snapshot.storedState.activeSlotIndex]?.kind === 'session',
		);
		assert.equal(afterReload.headerTitle, beforeReload.headerTitle);
		assert.equal(
			afterReload.storedState?.slots[afterReload.storedState.activeSlotIndex]?.kind,
			'session',
		);
	});

	test('restores active Browser scroll after a cold restart without switching tabs', async () => {
		const smokeServer = await startSmokeServer();
		server = smokeServer.server;
		context = await createSmokeTestContext('editor-browser-cold-restart');
		const application = context.application;
		const delayedBrowserUrl = `${smokeServer.url}?delayed=1`;
		await application.start();
		await application.reloadWithLocalStorage({
			[editorGroupsLocalStorageKey]: JSON.stringify(createSeedWorkspace(delayedBrowserUrl, false)),
				[editorViewStateLocalStorageKey]: JSON.stringify({
					version: 2,
					entries: [{
						key: {
							groupId: 'editor-group-a',
							paneId: 'workbench.editor.browser',
							resourceKey: 'vscode-browser:/browser-a',
						},
						state: { url: delayedBrowserUrl, scrollX: 0, scrollY: 960 },
					}],
				}),
		});
		await application.workbench.ensureEditorExpanded();
		let code = application.code;
		await code.waitForCondition(
			'active Browser before cold restart',
			() => getRendererSnapshot(code),
			snapshot => snapshot.activeTabKind === 'browser' && snapshot.tabCount === 1,
		);
		const delayedRestore = await code.waitForCondition(
			'Browser view state restores after delayed document growth',
			async () => ({
				scrollTop: await getBrowserScroll(code, 'browser-a'),
				storedViewState: await getEditorViewStateStorage(code),
				contentState: await getContentState(code, 'browser-a'),
			}),
			result => result.scrollTop >= 900,
			{ timeoutMs: 30_000, intervalMs: 100 },
		);
		assert.ok(delayedRestore.scrollTop >= 900, `Expected Browser scroll, got ${delayedRestore.scrollTop}.`);
		const scrolledTo = await setBrowserScroll(code, 'browser-a', 1440);
		assert.ok(scrolledTo >= 1400, `Expected browser target to scroll, got ${scrolledTo}.`);
		const editorGroupsBeforeRestart = await getEditorGroupsStorage(code);
		assert.ok(editorGroupsBeforeRestart);
		const playwrightSnapshot = await captureAndBlockPlaywrightSnapshot(code, 'browser-a');
		assert.equal(playwrightSnapshot.title, 'Electron Smoke');
		assert.equal(playwrightSnapshot.containsHeading, true);
		assert.equal(playwrightSnapshot.cancellationRejected, true);
		assert.equal(playwrightSnapshot.deferredFunctionStarted, true);
		assert.equal(playwrightSnapshot.lifecycleCommandRejected, true);
		await code.wait(300);

		await application.stop();
		await application.start();
		await application.workbench.ensureEditorExpanded();
		code = application.code;
		const restored = await code.waitForCondition(
			'active Browser scroll restoration after cold restart',
			async () => ({
				renderer: await getRendererSnapshot(code),
				browser: await getBrowserDomSnapshot(code, 'browser-a'),
				scrollTop: await getBrowserScroll(code, 'browser-a'),
				storedViewState: await getEditorViewStateStorage(code),
				storedEditorGroups: await getEditorGroupsStorage(code),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				result.browser.href === delayedBrowserUrl &&
				result.browser.heading === 'Editor Lifecycle Smoke' &&
				result.scrollTop >= 1400 &&
				result.storedViewState?.version === 2 &&
				result.storedViewState.entries[0]?.key.paneId === 'workbench.editor.browser' &&
				result.storedViewState.entries[0]?.state.scrollY >= 1400,
			{ timeoutMs: 30_000, intervalMs: 150 },
		);
		assert.ok(restored.scrollTop >= 1400);
		assert.equal(restored.storedViewState?.version, 2);
		assert.equal(restored.storedViewState?.entries[0]?.key.paneId, 'workbench.editor.browser');
		assert.ok((restored.storedViewState?.entries[0]?.state.scrollY ?? 0) >= 1400);
	});

	test('closes after the ready shared process exits unexpectedly', async () => {
		const smokeServer = await startSmokeServer();
		server = smokeServer.server;
		context = await createSmokeTestContext('editor-shared-process-exit');
		const application = context.application;
		await application.start();
		await application.reloadWithLocalStorage({
			[editorGroupsLocalStorageKey]: JSON.stringify(createSeedWorkspace(smokeServer.url, false)),
		});
		await application.workbench.ensureEditorExpanded();
		const code = application.code;
		await code.waitForCondition(
			'active Browser before shared process fault injection',
			() => getRendererSnapshot(code),
			snapshot => snapshot.activeTabKind === 'browser' && snapshot.tabCount === 1,
		);
		const playwrightSnapshot = await captureAndBlockPlaywrightSnapshot(code, 'browser-a');
		assert.equal(playwrightSnapshot.containsHeading, true);
		const sharedProcessPid = await code.terminateSharedProcess();
		assert.ok(sharedProcessPid > 0);
		await code.wait(300);

		await application.stop();
	});

	test('releases window automation state before macOS reopens the app', async function() {
		if (process.platform !== 'darwin') {
			this.skip();
		}
		const smokeServer = await startSmokeServer();
		server = smokeServer.server;
		context = await createSmokeTestContext('editor-window-reopen');
		const application = context.application;
		await application.start();
		await application.reloadWithLocalStorage({
			[editorGroupsLocalStorageKey]: JSON.stringify(createSeedWorkspace(smokeServer.url, false)),
		});
		await application.workbench.ensureEditorExpanded();
		let code = application.code;
		await code.waitForCondition(
			'active Browser before closing the macOS window',
			() => getRendererSnapshot(code),
			snapshot => snapshot.activeTabKind === 'browser' && snapshot.tabCount === 1,
		);
		assert.equal((await captureAndBlockPlaywrightSnapshot(code, 'browser-a')).containsHeading, true);

		await code.closeAndReopenMainWindow();
		code = application.code;
		await application.workbench.ensureEditorExpanded();
		await code.waitForCondition(
			'active Browser after macOS reopens the window',
			() => getRendererSnapshot(code),
			snapshot => snapshot.activeTabKind === 'browser' && snapshot.tabCount === 1,
		);
		assert.equal((await captureAndBlockPlaywrightSnapshot(code, 'browser-a')).containsHeading, true);
	});

	test('hides the active browser target after closing its last tab', async () => {
		const smokeServer = await startSmokeServer();
		server = smokeServer.server;
		context = await createSmokeTestContext('editor-close-last-browser-tab');

		const application = context.application;
		await application.start();
		await application.reloadWithLocalStorage({
			[editorGroupsLocalStorageKey]: JSON.stringify(
				createSeedWorkspace(smokeServer.url, false),
			),
		});
		await application.workbench.ensureEditorExpanded();

		const code = application.code;
		await code.waitForCondition(
			'initial browser target activation',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === 'browser' &&
				result.renderer.tabCount === 1 &&
				hasAlignedBrowserBounds(result.renderer, result.nativeBounds) &&
				result.state.activeTargetId === 'browser-a' &&
				result.state.visible &&
				result.state.layoutPhase === 'visible',
			{ timeoutMs: 30_000, intervalMs: 150 },
		);

		const activeTab = code.page.locator('.comet-editor-tab.comet-is-active');
		await activeTab.hover();
		await activeTab.locator('.comet-editor-tab-close-btn').click();

		await code.waitForCondition(
			'browser target release after closing the last tab',
			async () => ({
				renderer: await getRendererSnapshot(code),
				nativeBounds: await code.getVisibleWebContentsViewBounds(),
				state: await getContentState(code, 'browser-a'),
			}),
			result =>
				result.renderer.activeTabKind === null &&
				result.renderer.tabCount === 0 &&
				result.renderer.browserContainer === null &&
				result.nativeBounds.length === 0 &&
				result.state.activeTargetId === null &&
				result.state.ownership === 'inactive' &&
				!result.state.visible &&
				result.state.layoutPhase === 'hidden',
			{ timeoutMs: 30_000, intervalMs: 150 },
		);
	});
});
