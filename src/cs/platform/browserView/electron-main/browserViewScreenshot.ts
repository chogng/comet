/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Buffer } from 'node:buffer';
import type { WebContentsView } from 'electron';
import { VSBuffer } from 'cs/base/common/buffer';
import type { IBrowserViewCaptureScreenshotOptions, IBrowserViewRect } from 'cs/platform/browserView/common/browserView';
import type { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';
import type { BrowserViewInspector } from 'cs/platform/browserView/electron-main/browserViewInspector';

const MAX_FULL_PAGE_SCREENSHOT_DIMENSION = 2576;
const NEXT_PAINT_TIMEOUT_MS = 100;

/** Captures viewport, page-area, and full-document images for one BrowserView target. */
export class BrowserViewScreenshot {
	constructor(
		private readonly view: WebContentsView,
		private readonly debuggerTransport: BrowserViewDebugger,
		private readonly inspector: BrowserViewInspector,
	) {
	}

	async capture(
		options: IBrowserViewCaptureScreenshotOptions,
		emulationScaleFactor: number,
		devicePixelRatio: number,
	): Promise<VSBuffer> {
		this.ensureRenderingPipeline();
		const format = options.format ?? 'jpeg';
		const quality = validateQuality(options.quality ?? 80);
		if (options.fullPage && !options.screenRect && !options.pageRect) {
			return this.captureFullPage(format, quality, devicePixelRatio);
		}

		let screenRect = options.screenRect;
		if (options.pageRect) {
			const visualViewportScale = await this.inspector.getVisualViewportScale();
			const zoomFactor = validateScale(this.view.webContents.getZoomFactor(), 'Browser zoom factor');
			const pageToScreenScale = visualViewportScale * zoomFactor * validateScale(emulationScaleFactor, 'Browser emulation scale factor');
			screenRect = scaleRect(options.pageRect, pageToScreenScale);
		}
		const captureRect = screenRect ? normalizeRect(screenRect) : undefined;
		if (options.awaitNextPaint) {
			await this.waitForNextPaint();
		}

		const image = await this.view.webContents.capturePage(captureRect, { stayHidden: true });
		if (image.isEmpty()) {
			throw new Error('Browser screenshot capture returned an empty image.');
		}
		return VSBuffer.wrap(format === 'png' ? image.toPNG() : image.toJPEG(quality));
	}

	private ensureRenderingPipeline(): void {
		if (this.view.getVisible()) {
			return;
		}
		try {
			this.view.setVisible(true);
		} finally {
			this.view.setVisible(false);
		}
	}

	private async captureFullPage(
		format: 'jpeg' | 'png',
		quality: number,
		devicePixelRatio: number,
	): Promise<VSBuffer> {
		const metrics = await this.debuggerTransport.sendCommand('Page.getLayoutMetrics') as {
			cssContentSize?: { width: number; height: number };
		};
		const contentSize = metrics.cssContentSize;
		if (!contentSize || !isPositiveFinite(contentSize.width) || !isPositiveFinite(contentSize.height)) {
			throw new Error('Page.getLayoutMetrics returned an invalid cssContentSize.');
		}
		const zoomFactor = validateScale(this.view.webContents.getZoomFactor(), 'Browser zoom factor');
		const pixelRatio = validateScale(devicePixelRatio, 'Display device pixel ratio');
		const clipWidth = contentSize.width * zoomFactor;
		const clipHeight = contentSize.height * zoomFactor;
		const maxClipDimension = MAX_FULL_PAGE_SCREENSHOT_DIMENSION / pixelRatio;
		const scale = Math.min(1, maxClipDimension / Math.max(clipWidth, clipHeight));

		let result: { data: string } | undefined;
		let captureError: unknown;
		try {
			result = await this.debuggerTransport.sendCommand('Page.captureScreenshot', {
				format,
				...(format === 'jpeg' ? { quality } : {}),
				captureBeyondViewport: true,
				clip: { x: 0, y: 0, width: clipWidth, height: clipHeight, scale },
			}) as { data: string };
		} catch (error) {
			captureError = error;
		}

		let restoreError: unknown;
		try {
			await this.view.webContents.setVisualZoomLevelLimits(1, 3);
		} catch (error) {
			restoreError = error;
		}
		if (captureError !== undefined && restoreError !== undefined) {
			throw new AggregateError([captureError, restoreError], 'Browser screenshot capture and visual zoom restoration both failed.');
		}
		if (captureError !== undefined) {
			throw captureError;
		}
		if (restoreError !== undefined) {
			throw restoreError;
		}
		if (!result || typeof result.data !== 'string' || result.data.length === 0) {
			throw new Error('Page.captureScreenshot returned no image data.');
		}
		const bytes = Buffer.from(result.data, 'base64');
		if (bytes.byteLength === 0) {
			throw new Error('Page.captureScreenshot returned invalid image data.');
		}
		return VSBuffer.wrap(bytes);
	}

	private async waitForNextPaint(): Promise<void> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.debuggerTransport.sendCommand('Runtime.evaluate', {
					expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
					awaitPromise: true,
				}),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for the next browser paint.')), NEXT_PAINT_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timeout !== undefined) {
				clearTimeout(timeout);
			}
		}
	}
}

function validateQuality(quality: number): number {
	if (!Number.isInteger(quality) || quality < 0 || quality > 100) {
		throw new Error('Browser screenshot JPEG quality must be an integer from 0 to 100.');
	}
	return quality;
}

function validateScale(scale: number, name: string): number {
	if (!isPositiveFinite(scale)) {
		throw new Error(`${name} must be a positive finite number.`);
	}
	return scale;
}

function isPositiveFinite(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function scaleRect(rect: IBrowserViewRect, scale: number): IBrowserViewRect {
	const normalized = validateRect(rect);
	return {
		x: normalized.x * scale,
		y: normalized.y * scale,
		width: normalized.width * scale,
		height: normalized.height * scale,
	};
}

function normalizeRect(rect: IBrowserViewRect): IBrowserViewRect {
	const validated = validateRect(rect);
	return {
		x: Math.round(validated.x),
		y: Math.round(validated.y),
		width: Math.max(1, Math.round(validated.width)),
		height: Math.max(1, Math.round(validated.height)),
	};
}

function validateRect(rect: IBrowserViewRect): IBrowserViewRect {
	if (
		!Number.isFinite(rect.x) || rect.x < 0 ||
		!Number.isFinite(rect.y) || rect.y < 0 ||
		!isPositiveFinite(rect.width) ||
		!isPositiveFinite(rect.height)
	) {
		throw new Error('Browser screenshot rectangle must contain non-negative finite coordinates and positive finite dimensions.');
	}
	return rect;
}
