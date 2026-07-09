/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ErrorListenerCallback {
	(error: unknown): void;
}

export interface ErrorListenerUnbind {
	(): void;
}

export class ErrorHandler {
	private unexpectedErrorHandler: (error: unknown) => void;
	private readonly listeners: ErrorListenerCallback[] = [];

	constructor() {
		this.unexpectedErrorHandler = error => {
			setTimeout(() => {
				if (error instanceof Error && error.stack) {
					if (error.name === 'CodeExpectedError') {
						throw new ErrorNoTelemetry(`${error.message}\n\n${error.stack}`);
					}

					throw new Error(`${error.message}\n\n${error.stack}`);
				}

				throw error;
			}, 0);
		};
	}

	addListener(listener: ErrorListenerCallback): ErrorListenerUnbind {
		this.listeners.push(listener);

		return () => {
			this.removeListener(listener);
		};
	}

	private emit(error: unknown): void {
		for (const listener of this.listeners) {
			listener(error);
		}
	}

	private removeListener(listener: ErrorListenerCallback): void {
		const index = this.listeners.indexOf(listener);
		if (index >= 0) {
			this.listeners.splice(index, 1);
		}
	}

	setUnexpectedErrorHandler(unexpectedErrorHandler: (error: unknown) => void): void {
		this.unexpectedErrorHandler = unexpectedErrorHandler;
	}

	getUnexpectedErrorHandler(): (error: unknown) => void {
		return this.unexpectedErrorHandler;
	}

	onUnexpectedError(error: unknown): void {
		this.unexpectedErrorHandler(error);
		this.emit(error);
	}

	onUnexpectedExternalError(error: unknown): void {
		this.unexpectedErrorHandler(error);
	}
}

export const errorHandler = new ErrorHandler();

/** @skipMangle */
export function setUnexpectedErrorHandler(unexpectedErrorHandler: (error: unknown) => void): void {
	errorHandler.setUnexpectedErrorHandler(unexpectedErrorHandler);
}

export function isSigPipeError(error: unknown): error is Error {
	if (!error || typeof error !== 'object') {
		return false;
	}

	const candidate = error as Record<string, string | undefined>;
	return candidate.code === 'EPIPE' && candidate.syscall?.toUpperCase() === 'WRITE';
}

export function onBugIndicatingError(error: unknown): undefined {
	errorHandler.onUnexpectedError(error);
	return undefined;
}

export function onUnexpectedError(error: unknown): undefined {
	if (!isCancellationError(error)) {
		errorHandler.onUnexpectedError(error);
	}
	return undefined;
}

export function onUnexpectedExternalError(error: unknown): undefined {
	if (!isCancellationError(error)) {
		errorHandler.onUnexpectedExternalError(error);
	}
	return undefined;
}

export interface SerializedError {
	readonly $isError: true;
	readonly name: string;
	readonly message: string;
	readonly stack: string;
	readonly noTelemetry: boolean;
	readonly code?: string;
	readonly cause?: SerializedError;
}

type ErrorWithCode = Error & {
	code: string | undefined;
};

export function transformErrorForSerialization(error: Error): SerializedError;
export function transformErrorForSerialization<T>(error: T): T | SerializedError;
export function transformErrorForSerialization(error: unknown): unknown {
	if (error instanceof Error) {
		const { name, message, cause } = error;
		const stack = error.stack ?? '';
		return {
			$isError: true,
			name,
			message,
			stack,
			noTelemetry: ErrorNoTelemetry.isErrorNoTelemetry(error),
			cause: cause ? transformErrorForSerialization(cause) as SerializedError : undefined,
			code: (error as ErrorWithCode).code
		};
	}

	return error;
}

export function transformErrorFromSerialization(data: SerializedError): Error {
	let error: Error;
	if (data.noTelemetry) {
		error = new ErrorNoTelemetry();
	} else {
		error = new Error();
		error.name = data.name;
	}
	error.message = data.message;
	error.stack = data.stack;
	if (data.code) {
		(error as ErrorWithCode).code = data.code;
	}
	if (data.cause) {
		error.cause = transformErrorFromSerialization(data.cause);
	}
	return error;
}

export interface V8CallSite {
	getThis(): unknown;
	getTypeName(): string | null;
	getFunction(): Function | undefined;
	getFunctionName(): string | null;
	getMethodName(): string | null;
	getFileName(): string | null;
	getLineNumber(): number | null;
	getColumnNumber(): number | null;
	getEvalOrigin(): string | undefined;
	isToplevel(): boolean;
	isEval(): boolean;
	isNative(): boolean;
	isConstructor(): boolean;
	toString(): string;
}

export const canceledName = 'Canceled';

export function isCancellationError(error: unknown): error is CancellationError {
	if (error instanceof CancellationError) {
		return true;
	}
	return error instanceof Error && error.name === canceledName && error.message === canceledName;
}

export class CancellationError extends Error {
	constructor() {
		super(canceledName);
		this.name = this.message;
	}
}

export class PendingMigrationError extends Error {
	private static readonly _name = 'PendingMigrationError';

	static is(error: unknown): error is PendingMigrationError {
		return error instanceof PendingMigrationError || (error instanceof Error && error.name === PendingMigrationError._name);
	}

	constructor(message: string) {
		super(message);
		this.name = PendingMigrationError._name;
	}
}

/**
 * @deprecated use {@link CancellationError `new CancellationError()`} instead
 */
export function canceled(): Error {
	const error = new Error(canceledName);
	error.name = error.message;
	return error;
}

export function illegalArgument(name?: string): Error {
	if (name) {
		return new Error(`Illegal argument: ${name}`);
	}
	return new Error('Illegal argument');
}

export function illegalState(name?: string): Error {
	if (name) {
		return new Error(`Illegal state: ${name}`);
	}
	return new Error('Illegal state');
}

export class ReadonlyError extends TypeError {
	constructor(name?: string) {
		super(name ? `${name} is read-only and cannot be changed` : 'Cannot change read-only property');
	}
}

export function getErrorMessage(error: unknown): string {
	if (!error) {
		return 'Error';
	}

	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
		return error.message;
	}

	if (typeof error === 'object' && 'stack' in error && typeof error.stack === 'string') {
		return error.stack.split('\n')[0];
	}

	return String(error);
}

export class NotImplementedError extends Error {
	constructor(message?: string) {
		super('NotImplemented');
		if (message) {
			this.message = message;
		}
	}
}

export class NotSupportedError extends Error {
	constructor(message?: string) {
		super('NotSupported');
		if (message) {
			this.message = message;
		}
	}
}

export class ExpectedError extends Error {
	readonly isExpected = true;
}

export class ErrorNoTelemetry extends Error {
	override readonly name: string;

	constructor(message?: string) {
		super(message);
		this.name = 'CodeExpectedError';
	}

	static fromError(error: Error): ErrorNoTelemetry {
		if (error instanceof ErrorNoTelemetry) {
			return error;
		}

		const result = new ErrorNoTelemetry();
		result.message = error.message;
		result.stack = error.stack;
		return result;
	}

	static isErrorNoTelemetry(error: Error): error is ErrorNoTelemetry {
		return error.name === 'CodeExpectedError';
	}
}

export class BugIndicatingError extends Error {
	constructor(message?: string) {
		super(message ?? 'An unexpected bug occurred.');
		Object.setPrototypeOf(this, BugIndicatingError.prototype);
	}
}
