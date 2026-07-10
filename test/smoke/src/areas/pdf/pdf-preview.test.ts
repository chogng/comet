/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert = require('node:assert/strict');
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Code } from '../../../../automation';
import {
	createSmokeTestContext,
	disposeSmokeTestContext,
	type SmokeTestContext,
} from '../../fixtures';

type PdfRenderDiagnostics = {
	readonly pageRenderCount: number;
	readonly textCacheMisses: number;
};

type PdfDiagnostics = {
	readonly activeTabKind: string | null;
	readonly pageCount: number;
	readonly canvasCount: number;
	readonly selectionHighlightCount: number;
	readonly annotationHighlightCount: number;
	readonly renderDiagnostics: PdfRenderDiagnostics | null;
	readonly editor: {
		readonly state: string | null;
		readonly status: string | null;
		readonly detail: string | null;
		readonly textChars: number;
		readonly selectionText: string | null;
		readonly selectionPages: string | null;
	} | null;
	readonly floatingStatus: {
		readonly text: string | null;
		readonly detail: string | null;
		readonly title: string | null;
	} | null;
	readonly statusbar: {
		readonly value: string | null;
		readonly title: string | null;
		readonly text: string | null;
		readonly className: string;
	} | null;
};

type PdfScrollDiagnostics = {
	readonly renderDiagnostics: PdfRenderDiagnostics | null;
	readonly pages: readonly {
		readonly page: number;
		readonly visible: boolean;
		readonly hasCanvas: boolean;
		readonly canvasTransform: string | null;
	}[];
	readonly visiblePages: readonly {
		readonly page: number;
		readonly visible: boolean;
		readonly hasCanvas: boolean;
		readonly canvasTransform: string | null;
	}[];
	readonly scrollTop: number | null;
	readonly canvasCount: number;
};

function createSimplePdfBuffer(): Buffer {
	const encoder = new TextEncoder();
	const chunks = ['%PDF-1.7\n'];
	const offsets: number[] = [0];

	const addObject = (id: number, body: string) => {
		offsets[id] = encoder.encode(chunks.join('')).byteLength;
		chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
	};

	addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
	addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
	addObject(
		3,
		[
			'<< /Type /Page /Parent 2 0 R',
			'/MediaBox [0 0 300 200]',
			'/Resources << /Font << /F1 5 0 R >> >>',
			'/Contents 4 0 R >>',
		].join(' '),
	);
	const stream = 'BT /F1 16 Tf 48 112 Td (Comet Studio PDF smoke) Tj ET';
	addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

	const xrefOffset = encoder.encode(chunks.join('')).byteLength;
	chunks.push('xref\n0 6\n0000000000 65535 f \n');
	for (let id = 1; id <= 5; id += 1) {
		chunks.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
	}
	chunks.push(
		'trailer\n',
		'<< /Size 6 /Root 1 0 R >>\n',
		'startxref\n',
		`${xrefOffset}\n`,
		'%%EOF\n',
	);

	return Buffer.from(chunks.join(''), 'utf8');
}

function createMultiPagePdfBuffer(pageCount = 12): Buffer {
	const encoder = new TextEncoder();
	const chunks = ['%PDF-1.7\n'];
	const offsets: number[] = [0];
	const pageObjectIds: number[] = [];
	const contentObjectIds: number[] = [];
	let nextObjectId = 3;

	for (let page = 1; page <= pageCount; page += 1) {
		pageObjectIds.push(nextObjectId++);
		contentObjectIds.push(nextObjectId++);
	}
	const fontObjectId = nextObjectId;

	const addObject = (id: number, body: string) => {
		offsets[id] = encoder.encode(chunks.join('')).byteLength;
		chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
	};

	addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
	addObject(
		2,
		`<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
	);

	for (let index = 0; index < pageCount; index += 1) {
		const page = index + 1;
		addObject(
			pageObjectIds[index]!,
			[
				'<< /Type /Page /Parent 2 0 R',
				'/MediaBox [0 0 612 792]',
				`/Resources << /Font << /F1 ${fontObjectId} 0 R >> >>`,
				`/Contents ${contentObjectIds[index]} 0 R >>`,
			].join(' '),
		);
		const stream = `BT /F1 24 Tf 72 680 Td (Page ${page} scroll latency probe) Tj ET`;
		addObject(
			contentObjectIds[index]!,
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		);
	}

	addObject(
		fontObjectId,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	);
	const xrefOffset = encoder.encode(chunks.join('')).byteLength;
	chunks.push(`xref\n0 ${fontObjectId + 1}\n0000000000 65535 f \n`);
	for (let id = 1; id <= fontObjectId; id += 1) {
		chunks.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
	}
	chunks.push(
		'trailer\n',
		`<< /Size ${fontObjectId + 1} /Root 1 0 R >>\n`,
		'startxref\n',
		`${xrefOffset}\n`,
		'%%EOF\n',
	);

	return Buffer.from(chunks.join(''), 'utf8');
}

function createSeedWorkspace(pdfUrl: string): object {
	return {
		groups: [
			{
				groupId: 'editor-group-a',
				inputs: [
					{
						id: 'pdf-smoke-a',
						kind: 'pdf',
						title: 'PDF Smoke',
						url: pdfUrl,
					},
				],
				activeTabId: 'pdf-smoke-a',
				mruTabIds: ['pdf-smoke-a'],
			},
		],
		activeGroupId: 'editor-group-a',
		draftStateByInputId: {},
		viewStateEntries: [],
	};
}

async function reloadPdfWorkspace(
	context: SmokeTestContext,
	pdfPath: string,
): Promise<void> {
	await context.application.reloadWithLocalStorage({
		'cs.writingWorkspace.state': JSON.stringify(
			createSeedWorkspace(pathToFileURL(pdfPath).toString()),
		),
	});
	await context.application.workbench.ensureEditorExpanded();
}

async function getPdfDiagnostics(code: Code): Promise<PdfDiagnostics> {
	return code.evaluate<PdfDiagnostics>(`(() => {
		const editor = document.querySelector('.comet-pdf-document-reader');
		const status = document.querySelector('[data-statusbar-item-id="pdf-status"]');
		const readerStatus = document.querySelector('.comet-pdf-reader-status');
		let renderDiagnostics = null;
		if (editor instanceof HTMLElement && editor.dataset.pdfReaderRenderDiagnostics) {
			renderDiagnostics = JSON.parse(editor.dataset.pdfReaderRenderDiagnostics);
		}
		return {
			activeTabKind: document.querySelector('.comet-editor-tab.comet-is-active')?.dataset.paneMode ?? null,
			pageCount: document.querySelectorAll('.comet-pdf-reader-page').length,
			canvasCount: document.querySelectorAll('.comet-pdf-reader-page canvas').length,
			selectionHighlightCount: document.querySelectorAll('.comet-pdf-reader-highlight.comet-is-selection').length,
			annotationHighlightCount: document.querySelectorAll('.comet-pdf-reader-highlight.comet-is-annotation').length,
			renderDiagnostics,
			editor: editor instanceof HTMLElement
				? {
					state: editor.dataset.pdfReaderState ?? null,
					status: editor.dataset.pdfReaderStatus ?? null,
					detail: editor.dataset.pdfReaderErrorDetail ?? null,
					textChars: Number(editor.dataset.pdfReaderTextChars ?? 0),
					selectionText: editor.dataset.pdfReaderSelectionText ?? null,
					selectionPages: editor.dataset.pdfReaderSelectionPages ?? null,
				}
				: null,
			floatingStatus: readerStatus instanceof HTMLElement
				? {
					text: readerStatus.textContent,
					detail: readerStatus.dataset.pdfReaderErrorDetail ?? null,
					title: readerStatus.getAttribute('title'),
				}
				: null,
			statusbar: status instanceof HTMLElement
				? {
					value: status.dataset.statusbarItemValue ?? null,
					title: status.dataset.statusbarItemTitle ?? null,
					text: status.textContent,
					className: status.className,
				}
				: null,
		};
	})()`);
}

async function dragSelectGeneratedPdfText(code: Code): Promise<void> {
	const selected = await code.evaluate<boolean>(`(() => {
		const wrap = document.querySelector('.comet-pdf-reader-page-canvas-wrap');
		const canvas = document.querySelector('.comet-pdf-reader-page canvas');
		if (!(wrap instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
			return false;
		}

		const rect = canvas.getBoundingClientRect();
		const scale = rect.width / 300;
		const start = {
			x: rect.left + 48 * scale,
			y: rect.top + (200 - 112 - 16) * scale,
		};
		const end = { x: rect.left + 270 * scale, y: start.y };
		const createEvent = (type, point) => new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX: point.x,
			clientY: point.y,
			pointerId: 10,
			pointerType: 'mouse',
		});

		wrap.dispatchEvent(createEvent('pointerdown', start));
		wrap.dispatchEvent(createEvent('pointermove', end));
		wrap.dispatchEvent(createEvent('pointerup', end));
		return true;
	})()`);
	assert.equal(selected, true, 'Expected the PDF selection surface to be available.');
}

async function getPdfScrollDiagnostics(
	code: Code,
): Promise<PdfScrollDiagnostics> {
	return code.evaluate<PdfScrollDiagnostics>(`(() => {
		const editor = document.querySelector('.comet-pdf-document-reader');
		const pagesElement = document.querySelector('.comet-pdf-reader-pages');
		const renderDiagnostics = editor instanceof HTMLElement && editor.dataset.pdfReaderRenderDiagnostics
			? JSON.parse(editor.dataset.pdfReaderRenderDiagnostics)
			: null;
		if (!(pagesElement instanceof HTMLElement)) {
			return {
				renderDiagnostics,
				pages: [],
				visiblePages: [],
				scrollTop: null,
				canvasCount: 0,
			};
		}

		const viewport = pagesElement.getBoundingClientRect();
		const pages = [...document.querySelectorAll('.comet-pdf-reader-page')].map(pageElement => {
			const rect = pageElement.getBoundingClientRect();
			const canvas = pageElement.querySelector('canvas');
			return {
				page: Number(pageElement.dataset.pdfPage),
				visible: rect.bottom >= viewport.top && rect.top <= viewport.bottom,
				hasCanvas: canvas instanceof HTMLCanvasElement,
				canvasTransform: canvas instanceof HTMLElement ? canvas.style.transform : null,
			};
		});
		return {
			renderDiagnostics,
			pages,
			visiblePages: pages.filter(page => page.visible),
			scrollTop: pagesElement.scrollTop,
			canvasCount: document.querySelectorAll('.comet-pdf-reader-page canvas').length,
		};
	})()`);
}

async function scrollPdfPageIntoView(
	code: Code,
	pageNumber: number,
): Promise<void> {
	const scrolled = await code.evaluate<boolean>(`(() => {
		const pagesElement = document.querySelector('.comet-pdf-reader-pages');
		const target = document.querySelector('.comet-pdf-reader-page[data-pdf-page="${pageNumber}"]');
		if (!(pagesElement instanceof HTMLElement) || !(target instanceof HTMLElement)) {
			return false;
		}
		pagesElement.scrollTop = Math.max(0, target.offsetTop - 12);
		pagesElement.dispatchEvent(new Event('scroll', { bubbles: true }));
		return true;
	})()`);
	assert.equal(scrolled, true, `Expected to scroll PDF page ${pageNumber} into view.`);
}

suite('PDF preview smoke', function() {
	this.timeout(120_000);

	let context: SmokeTestContext | undefined;

	teardown(async () => {
		await disposeSmokeTestContext(context);
		context = undefined;
	});

	test('renders, selects, and rapidly scrolls generated PDFs', async () => {
		context = await createSmokeTestContext('pdf-preview');
		const simplePdfPath = path.join(context.tempRoot, 'PDF Preview Smoke.pdf');
		await writeFile(simplePdfPath, createSimplePdfBuffer());

		await context.application.start();
		await reloadPdfWorkspace(context, simplePdfPath);
		const code = context.application.code;

		const diagnostics = await code.waitForCondition(
			'PDF preview ready state',
			() => getPdfDiagnostics(code),
			result => result.editor?.state === 'ready' || result.editor?.state === 'error',
			{ timeoutMs: 30_000, intervalMs: 150 },
		);
		assert.equal(
			diagnostics.editor?.state,
			'ready',
			`Expected PDF preview to render. Diagnostics: ${JSON.stringify(diagnostics)}`,
		);
		assert.ok(diagnostics.canvasCount >= 1);
		assert.ok((diagnostics.editor?.textChars ?? 0) >= 1);

		await dragSelectGeneratedPdfText(code);
		const selectionDiagnostics = await code.waitForCondition(
			'PDF text selection',
			() => getPdfDiagnostics(code),
			result =>
				result.selectionHighlightCount >= 1 &&
				Boolean(result.editor?.selectionText),
			{ timeoutMs: 5_000 },
		);
		assert.match(
			selectionDiagnostics.editor?.selectionText ?? '',
			/Comet.+PDF/,
		);

		const multiPagePdfPath = path.join(context.tempRoot, 'PDF Scroll Smoke.pdf');
		await writeFile(multiPagePdfPath, createMultiPagePdfBuffer());
		await reloadPdfWorkspace(context, multiPagePdfPath);

		const multiPageDiagnostics = await code.waitForCondition(
			'multi-page PDF ready state',
			() => getPdfDiagnostics(code),
			result =>
				(result.editor?.state === 'ready' &&
					result.pageCount === 12 &&
					result.canvasCount >= 2) ||
				result.editor?.state === 'error',
			{ timeoutMs: 30_000, intervalMs: 150 },
		);
		assert.equal(
			multiPageDiagnostics.editor?.state,
			'ready',
			`Expected multi-page PDF preview to render. Diagnostics: ${JSON.stringify(multiPageDiagnostics)}`,
		);
		assert.equal(multiPageDiagnostics.pageCount, 12);
		assert.ok(multiPageDiagnostics.canvasCount >= 2);
		assert.ok((multiPageDiagnostics.renderDiagnostics?.pageRenderCount ?? 0) >= 2);

		const scrollStartedAt = performance.now();
		for (const pageNumber of [4, 8, 12]) {
			await scrollPdfPageIntoView(code, pageNumber);
			await code.wait(30);
		}

		const scrollDiagnostics = await code.waitForCondition(
			'page 12 render after rapid scrolling',
			() => getPdfScrollDiagnostics(code),
			result => {
				const target = result.pages.find(page => page.page === 12);
				return Boolean(
					result.visiblePages.some(page => page.page === 12) &&
					target?.hasCanvas,
				);
			},
			{ timeoutMs: 5_000, intervalMs: 50 },
		);
		assert.ok(performance.now() - scrollStartedAt < 5_000);
		assert.ok((scrollDiagnostics.renderDiagnostics?.pageRenderCount ?? 0) >= 2);
		assert.ok((scrollDiagnostics.renderDiagnostics?.textCacheMisses ?? 0) >= 1);
	});
});
