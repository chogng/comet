/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode } from './errors.js';
import { RemoteAgentHostProtocolCommand } from './remoteProtocol.js';

export const remoteAgentHostTunnelProtocolRevision = 3;
export const remoteAgentHostTunnelMaximumFrameBytes = 16 * 1024 * 1024;

export type RemoteAgentHostTunnelTarget = 'host' | 'clientContent' | 'clientTools';

export type RemoteAgentHostTunnelMessage =
	| {
		readonly kind: 'request';
		readonly id: number;
		readonly target: RemoteAgentHostTunnelTarget;
		readonly command: string;
		readonly argument?: string;
	}
	| {
		readonly kind: 'cancel';
		readonly id: number;
	}
	| {
		readonly kind: 'response';
		readonly id: number;
		readonly payload: string;
	}
	| {
		readonly kind: 'event';
		readonly target: 'host' | 'clientTools';
		readonly name: string;
		readonly payload: string;
	};

type WireRecord = Readonly<Record<string, unknown>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const targets = new Set<RemoteAgentHostTunnelTarget>(['host', 'clientContent', 'clientTools']);
const commands = new Set<string>(Object.values(RemoteAgentHostProtocolCommand));

function describeInvalidValue(value: unknown): string {
	if (typeof value === 'string') {
		return `type=string;utf8ByteLength=${encoder.encode(value).byteLength}`;
	}
	if (value === null) {
		return 'type=null';
	}
	if (Array.isArray(value)) {
		return 'type=array';
	}
	if (value instanceof Uint8Array) {
		return `type=Uint8Array;byteLength=${value.byteLength}`;
	}
	return `type=${typeof value}`;
}

function invalid(field: string, value: unknown): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Remote Tunnel Agent Host frame',
		{
			field,
			value: describeInvalidValue(value),
		},
	);
}

function invalidByteLength(field: string, byteLength: number): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Remote Tunnel Agent Host frame',
		{ field, value: byteLength },
	);
}

function requireRecord(value: unknown): WireRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalid('frame', value);
	}
	return value as WireRecord;
}

function requireExactKeys(record: WireRecord, required: readonly string[], optional: readonly string[]): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalid('frame.key', key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalid(`frame.${key}`, undefined);
		}
	}
}

function requireId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		return invalid('frame.id', value);
	}
	return value;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		return invalid(field, value);
	}
	const byteLength = encoder.encode(value).byteLength;
	if (byteLength === 0 || byteLength > remoteAgentHostTunnelMaximumFrameBytes) {
		return invalid(field, value);
	}
	return value;
}

/** Encodes one bounded Agent Host tunnel frame. */
export function encodeRemoteAgentHostTunnelMessage(message: RemoteAgentHostTunnelMessage): Uint8Array {
	const frame = encoder.encode(JSON.stringify(message));
	if (frame.byteLength > remoteAgentHostTunnelMaximumFrameBytes) {
		invalidByteLength('frame.byteLength', frame.byteLength);
	}
	return frame;
}

/** Decodes and validates one bounded Agent Host tunnel frame. */
export function decodeRemoteAgentHostTunnelMessage(frame: Uint8Array): RemoteAgentHostTunnelMessage {
	if (!(frame instanceof Uint8Array)) {
		return invalid('frame', frame);
	}
	if (frame.byteLength > remoteAgentHostTunnelMaximumFrameBytes) {
		return invalidByteLength('frame.byteLength', frame.byteLength);
	}
	let value: unknown;
	try {
		value = JSON.parse(decoder.decode(frame));
	} catch {
		return invalidByteLength('frame.encoding', frame.byteLength);
	}
	const record = requireRecord(value);
	const kind = requireString(record.kind, 'frame.kind');
	switch (kind) {
		case 'request': {
			requireExactKeys(record, ['kind', 'id', 'target', 'command'], ['argument']);
			const target = requireString(record.target, 'frame.target') as RemoteAgentHostTunnelTarget;
			if (!targets.has(target)) {
				invalid('frame.target', target);
			}
			return Object.freeze({
				kind,
				id: requireId(record.id),
				target,
				command: requireString(record.command, 'frame.command'),
				...(record.argument === undefined
					? {}
					: { argument: requireString(record.argument, 'frame.argument') }),
			});
		}
		case 'cancel':
			requireExactKeys(record, ['kind', 'id'], []);
			return Object.freeze({ kind, id: requireId(record.id) });
		case 'response':
			requireExactKeys(record, ['kind', 'id', 'payload'], []);
			return Object.freeze({
				kind,
				id: requireId(record.id),
				payload: requireString(record.payload, 'frame.payload'),
			});
		case 'event': {
			requireExactKeys(record, ['kind', 'target', 'name', 'payload'], []);
			const target = requireString(record.target, 'frame.target');
			if (target !== 'host' && target !== 'clientTools') {
				invalid('frame.target', target);
			}
			return Object.freeze({
				kind,
				target,
				name: requireString(record.name, 'frame.name'),
				payload: requireString(record.payload, 'frame.payload'),
			});
		}
		default:
			return invalid('frame.kind', kind);
	}
}

export function isRemoteAgentHostProtocolCommand(value: string): value is RemoteAgentHostProtocolCommand {
	return commands.has(value);
}
