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

function createSmokePageHtml(): string {
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
			${sections}
		</main>
	</body>
</html>`;
}

async function startSmokeServer(): Promise<{ server: Server; url: string }> {
	const html = createSmokePageHtml();
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
		response.end(html);
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
	return {
		groups: [
			{
				groupId: 'editor-group-a',
				inputs: [
					{
						id: 'browser-a',
						kind: 'browser',
						title: 'Smoke Browser',
						url: smokeUrl,
					},
					...(includeDraft ? [{
						id: 'draft-a',
						kind: 'draft',
						title: 'Smoke Draft',
						viewMode: 'draft',
					}] : []),
				],
				activeTabId: 'browser-a',
				mruTabIds: includeDraft ? ['browser-a', 'draft-a'] : ['browser-a'],
			},
		],
		activeGroupId: 'editor-group-a',
		draftStateByInputId: {
			'draft-a': {
				title: 'Smoke Draft',
				viewMode: 'draft',
				document: {
					type: 'doc',
					content: [
						{
							type: 'paragraph',
							attrs: { blockId: 'block-smoke-a' },
							content: [{ type: 'text', text: 'Draft smoke content' }],
						},
					],
				},
			},
		},
		viewStateEntries: [],
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
		hasWorkbench: Boolean(document.querySelector('.comet-session-workbench-content-grid')),
		tabCount: document.querySelectorAll('.comet-editor-tab').length,
	}))()`);
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
			'cs.writingWorkspace.state': JSON.stringify(
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
				result.state.activeTargetId === null &&
				result.state.ownership === 'inactive' &&
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
				result.renderer.browserContainer === null &&
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

	test('hides the active browser target after closing its last tab', async () => {
		const smokeServer = await startSmokeServer();
		server = smokeServer.server;
		context = await createSmokeTestContext('editor-close-last-browser-tab');

		const application = context.application;
		await application.start();
		await application.reloadWithLocalStorage({
			'cs.writingWorkspace.state': JSON.stringify(
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

		await code.evaluate(`(() => {
			const closeButton = document.querySelector(
				'.comet-editor-tab[data-tab-id="browser-a"] .comet-editor-tab-close-btn'
			);
			if (!(closeButton instanceof HTMLButtonElement)) {
				throw new Error('Browser tab close button was not found.');
			}
			closeButton.click();
		})()`);

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
