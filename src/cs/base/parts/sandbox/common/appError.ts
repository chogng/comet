/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const APP_ERROR_PREFIX = '__APP_ERROR__:';

export type AppErrorCode = string;

export interface AppErrorPayload {
	code: AppErrorCode;
	details?: Record<string, unknown>;
}

export interface AppErrorData {
	code?: AppErrorCode;
	message: string;
	details?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export class AppError extends Error {
	readonly code: AppErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(code: AppErrorCode, details?: Record<string, unknown>) {
		super(code);
		this.name = 'AppError';
		this.code = code;
		this.details = details;
	}
}

export function appError(code: AppErrorCode, details?: Record<string, unknown>): AppError {
	return new AppError(code, details);
}

export function isAppError(error: unknown): error is AppError {
	return error instanceof AppError || (isRecord(error) && error.name === 'AppError' && typeof error.code === 'string' && (error.details === undefined || isRecord(error.details)));
}

export function parseAppErrorData(error: unknown): AppErrorData {
	if (isRecord(error)) {
		const code = typeof error.code === 'string' ? error.code : undefined;
		const message = typeof error.message === 'string' ? error.message : String(error);
		const details = isRecord(error.details) ? error.details : undefined;

		return { code, message, details };
	}

	return {
		message: error instanceof Error ? error.message : String(error),
	};
}

export function serializeAppError(error: unknown): string {
	if (isAppError(error)) {
		const payload: AppErrorPayload = {
			code: error.code,
			details: error.details,
		};
		return `${APP_ERROR_PREFIX}${JSON.stringify(payload)}`;
	}

	const payload: AppErrorPayload = {
		code: 'UNKNOWN_ERROR',
		details: {
			message: error instanceof Error ? error.message : String(error),
		},
	};
	return `${APP_ERROR_PREFIX}${JSON.stringify(payload)}`;
}

export function parseSerializedAppError(message: string): AppErrorPayload | null {
	const markerIndex = message.lastIndexOf(APP_ERROR_PREFIX);
	if (markerIndex < 0) {
		return null;
	}

	const raw = message.slice(markerIndex + APP_ERROR_PREFIX.length).trim();
	if (!raw) {
		return null;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || typeof parsed.code !== 'string') {
			return null;
		}

		const details = parsed.details;
		if (details !== undefined && !isRecord(details)) {
			return null;
		}

		return {
			code: parsed.code,
			details: details as Record<string, unknown> | undefined,
		};
	} catch {
		return null;
	}
}
