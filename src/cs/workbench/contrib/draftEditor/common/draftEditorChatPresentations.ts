/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { WritingEditorStableEditTarget } from 'cs/editor/common/writingEditorDocument';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { createChatPresentationTypeId } from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import {
	DraftEditorInteractionTargetOwner,
	DraftEditorInteractionTargetSchemaVersion,
	DraftEditorInteractionTargetType,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorAgentTools';
import { DraftEditorInputScheme } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';

export const DraftEditorPatchPresentationSchemaVersion = 1;
export const DraftEditorPatchPresentationType = createChatPresentationTypeId(
	'comet.draft-editor.patch',
);

export type DraftEditorPatchOperation =
	| {
		readonly kind: 'text-edit';
		readonly edit: Readonly<WritingEditorStableEditTarget>;
	}
	| {
		readonly kind: 'insert-citation';
		readonly anchorBlockId: string;
		readonly citationIds: readonly string[];
	}
	| {
		readonly kind: 'insert-figure-ref';
		readonly anchorBlockId: string;
		readonly figureId: string;
	};

export interface IDraftEditorPatch {
	readonly label: string;
	readonly summary?: string;
	readonly operations: readonly DraftEditorPatchOperation[];
}

export interface IDraftEditorPatchProposal {
	readonly patch: IDraftEditorPatch;
	readonly accepted: boolean;
	readonly operationsValidated: number;
	readonly failedOperationIndex: number | null;
	readonly requiresCustomExecutor: boolean;
	readonly validationError: string | null;
}

export type DraftEditorPatchApplyState =
	| { readonly kind: 'pending' }
	| { readonly kind: 'applied' }
	| {
		readonly kind: 'applyFailed';
		readonly code: string;
		readonly message: string;
	};

export interface IDraftEditorPatchToolOutput {
	readonly target: IAgentHostInteractionTarget;
	readonly proposal: IDraftEditorPatchProposal;
}

export interface IDraftEditorPatchPresentationValue {
	readonly schemaVersion: typeof DraftEditorPatchPresentationSchemaVersion;
	readonly target: IAgentHostInteractionTarget;
	readonly proposal: IDraftEditorPatchProposal;
	readonly applyState: DraftEditorPatchApplyState;
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): void {
	const allowed = new Set([...required, ...optional]);
	if (Object.keys(record).some(key => !allowed.has(key))
		|| required.some(key => !Object.hasOwn(record, key))) {
		throw new TypeError(`${label} contains unsupported or missing properties.`);
	}
}

function requireString(
	value: unknown,
	label: string,
	maximumLength: number,
	allowEmpty = false,
): string {
	if (typeof value !== 'string'
		|| (!allowEmpty && value.length === 0)
		|| value.length > maximumLength) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(`${label} must be a boolean.`);
	}
	return value;
}

function requireIntegerInRange(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < minimum
		|| value > maximum) {
		throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
	}
	return value;
}

function parseStableEdit(value: unknown, label: string): Readonly<WritingEditorStableEditTarget> {
	const edit = requireRecord(value, label);
	const commonRequired = ['blockId', 'kind', 'text'] as const;
	const blockId = requireString(edit.blockId, `${label}.blockId`, 512);
	const expectedText = !Object.hasOwn(edit, 'expectedText') || edit.expectedText === null
		? undefined
		: requireString(edit.expectedText, `${label}.expectedText`, 4 * 1024 * 1024, true);
	const text = requireString(edit.text, `${label}.text`, 4 * 1024 * 1024, true);
	const common = {
		blockId,
		...(expectedText === undefined ? {} : { expectedText }),
		text,
	};
	switch (edit.kind) {
		case 'replaceBlock':
			requireExactKeys(edit, commonRequired, ['expectedText'], label);
			return Object.freeze({ ...common, kind: 'replaceBlock' });
		case 'replaceRange': {
			requireExactKeys(edit, [...commonRequired, 'from', 'to'], ['expectedText'], label);
			const from = requireIntegerInRange(edit.from, `${label}.from`, 0, Number.MAX_SAFE_INTEGER);
			const to = requireIntegerInRange(edit.to, `${label}.to`, 0, Number.MAX_SAFE_INTEGER);
			if (to < from) {
				throw new TypeError(`${label} has a reversed range.`);
			}
			return Object.freeze({
				...common,
				kind: 'replaceRange',
				from,
				to,
			});
		}
		case 'replaceLine':
			requireExactKeys(edit, [...commonRequired, 'line'], ['expectedText'], label);
			return Object.freeze({
				...common,
				kind: 'replaceLine',
				line: requireIntegerInRange(edit.line, `${label}.line`, 1, Number.MAX_SAFE_INTEGER),
			});
		case 'replaceLineRange': {
			requireExactKeys(
				edit,
				[...commonRequired, 'line', 'fromColumn', 'toColumn'],
				['expectedText'],
				label,
			);
			const fromColumn = requireIntegerInRange(
				edit.fromColumn,
				`${label}.fromColumn`,
				1,
				Number.MAX_SAFE_INTEGER,
			);
			const toColumn = requireIntegerInRange(
				edit.toColumn,
				`${label}.toColumn`,
				1,
				Number.MAX_SAFE_INTEGER,
			);
			if (toColumn < fromColumn) {
				throw new TypeError(`${label} has reversed columns.`);
			}
			return Object.freeze({
				...common,
				kind: 'replaceLineRange',
				line: requireIntegerInRange(edit.line, `${label}.line`, 1, Number.MAX_SAFE_INTEGER),
				fromColumn,
				toColumn,
			});
		}
		case 'replaceMatch':
			requireExactKeys(
				edit,
				[...commonRequired, 'match', 'occurrence'],
				['expectedText'],
				label,
			);
			return Object.freeze({
				...common,
				kind: 'replaceMatch',
				match: requireString(edit.match, `${label}.match`, 4 * 1024 * 1024),
				occurrence: requireIntegerInRange(
					edit.occurrence,
					`${label}.occurrence`,
					1,
					Number.MAX_SAFE_INTEGER,
				),
			});
		default:
			throw new TypeError(`${label}.kind is unsupported.`);
	}
}

function parsePatchOperation(value: unknown, index: number): DraftEditorPatchOperation {
	const label = `Draft Editor patch operation ${index}`;
	const operation = requireRecord(value, label);
	switch (operation.kind) {
		case 'text-edit':
			requireExactKeys(operation, ['kind', 'edit'], [], label);
			return Object.freeze({
				kind: 'text-edit',
				edit: parseStableEdit(operation.edit, `${label}.edit`),
			});
		case 'insert-citation': {
			requireExactKeys(operation, ['kind', 'anchorBlockId', 'citationIds'], [], label);
			if (!Array.isArray(operation.citationIds)
				|| operation.citationIds.length === 0
				|| operation.citationIds.length > 1_000) {
				throw new TypeError(`${label}.citationIds must be a bounded non-empty array.`);
			}
			const citationIds = operation.citationIds.map((id, citationIndex) =>
				requireString(id, `${label}.citationIds.${citationIndex}`, 512));
			if (new Set(citationIds).size !== citationIds.length) {
				throw new TypeError(`${label}.citationIds contains duplicates.`);
			}
			return Object.freeze({
				kind: 'insert-citation',
				anchorBlockId: requireString(operation.anchorBlockId, `${label}.anchorBlockId`, 512),
				citationIds: Object.freeze(citationIds),
			});
		}
		case 'insert-figure-ref':
			requireExactKeys(operation, ['kind', 'anchorBlockId', 'figureId'], [], label);
			return Object.freeze({
				kind: 'insert-figure-ref',
				anchorBlockId: requireString(operation.anchorBlockId, `${label}.anchorBlockId`, 512),
				figureId: requireString(operation.figureId, `${label}.figureId`, 512),
			});
		default:
			throw new TypeError(`${label}.kind is unsupported.`);
	}
}

/** Strictly parses one Draft patch independent of Agent or Chat implementation state. */
export function parseDraftEditorPatch(value: unknown): IDraftEditorPatch {
	const patch = requireRecord(value, 'Draft Editor patch');
	requireExactKeys(patch, ['label', 'operations'], ['summary'], 'Draft Editor patch');
	if (!Array.isArray(patch.operations)
		|| patch.operations.length === 0
		|| patch.operations.length > 1_000) {
		throw new TypeError('Draft Editor patch operations must be a bounded non-empty array.');
	}
	const summary = !Object.hasOwn(patch, 'summary') || patch.summary === null
		? undefined
		: requireString(patch.summary, 'Draft Editor patch summary', 65_536, true);
	return Object.freeze({
		label: requireString(patch.label, 'Draft Editor patch label', 512),
		...(summary === undefined ? {} : { summary }),
		operations: Object.freeze(patch.operations.map(parsePatchOperation)),
	});
}

/** Strictly parses a fully validated Draft patch proposal. */
export function parseDraftEditorPatchProposal(value: unknown): IDraftEditorPatchProposal {
	const proposal = requireRecord(value, 'Draft Editor patch proposal');
	requireExactKeys(proposal, [
		'patch',
		'accepted',
		'operationsValidated',
		'failedOperationIndex',
		'requiresCustomExecutor',
		'validationError',
	], [], 'Draft Editor patch proposal');
	const patch = parseDraftEditorPatch(proposal.patch);
	const accepted = requireBoolean(proposal.accepted, 'Draft Editor patch accepted');
	const operationsValidated = requireIntegerInRange(
		proposal.operationsValidated,
		'Draft Editor patch operationsValidated',
		0,
		patch.operations.length,
	);
	const failedOperationIndex = proposal.failedOperationIndex === null
		? null
		: requireIntegerInRange(
			proposal.failedOperationIndex,
			'Draft Editor patch failedOperationIndex',
			0,
			patch.operations.length - 1,
		);
	const requiresCustomExecutor = requireBoolean(
		proposal.requiresCustomExecutor,
		'Draft Editor patch requiresCustomExecutor',
	);
	const validationError = proposal.validationError === null
		? null
		: requireString(proposal.validationError, 'Draft Editor patch validation error', 8_192);

	if (accepted) {
		if (operationsValidated !== patch.operations.length
			|| failedOperationIndex !== null
			|| requiresCustomExecutor
			|| validationError !== null
			|| patch.operations.some(operation => operation.kind !== 'text-edit')) {
			throw new TypeError('Accepted Draft Editor patch proposal state is inconsistent.');
		}
	} else if (failedOperationIndex === null
		|| failedOperationIndex !== operationsValidated
		|| validationError === null
		|| (patch.operations[failedOperationIndex].kind !== 'text-edit') !== requiresCustomExecutor) {
		throw new TypeError('Rejected Draft Editor patch proposal state is inconsistent.');
	}

	return Object.freeze({
		patch,
		accepted,
		operationsValidated,
		failedOperationIndex,
		requiresCustomExecutor,
		validationError,
	});
}

function captureDraftEditorTarget(value: unknown): IAgentHostInteractionTarget {
	assertAgentHostInteractionTarget(value);
	if (value.owner !== DraftEditorInteractionTargetOwner
		|| value.type !== DraftEditorInteractionTargetType
		|| value.schemaVersion !== DraftEditorInteractionTargetSchemaVersion) {
		throw new TypeError('Draft Editor patch target metadata is incompatible.');
	}
	let resource: URI;
	try {
		resource = URI.parse(value.resource);
	} catch {
		throw new TypeError('Draft Editor patch target resource is invalid.');
	}
	if (resource.scheme !== DraftEditorInputScheme || resource.toString(true) !== value.resource) {
		throw new TypeError('Draft Editor patch target resource is not canonical.');
	}
	return Object.freeze({
		...value,
		authority: Object.freeze({ ...value.authority }),
		display: Object.freeze({ ...value.display }),
	});
}

function parseApplyState(value: unknown): DraftEditorPatchApplyState {
	const state = requireRecord(value, 'Draft Editor patch apply state');
	switch (state.kind) {
		case 'pending':
		case 'applied':
			requireExactKeys(state, ['kind'], [], 'Draft Editor patch apply state');
			return Object.freeze({ kind: state.kind });
		case 'applyFailed':
			requireExactKeys(
				state,
				['kind', 'code', 'message'],
				[],
				'Draft Editor patch apply state',
			);
			return Object.freeze({
				kind: 'applyFailed',
				code: requireString(state.code, 'Draft Editor patch apply failure code', 128),
				message: requireString(state.message, 'Draft Editor patch apply failure message', 8_192),
			});
		default:
			throw new TypeError('Draft Editor patch apply state kind is unsupported.');
	}
}

/** Strictly parses the exact completed proposal Tool output. */
export function parseDraftEditorPatchToolOutput(
	value: unknown,
	expectedPatchInput: AgentHostProtocolValue,
): IDraftEditorPatchToolOutput {
	const output = requireRecord(value, 'Draft Editor patch Tool output');
	requireExactKeys(output, ['target', 'proposal'], [], 'Draft Editor patch Tool output');
	const proposal = requireRecord(output.proposal, 'Draft Editor patch proposal');
	assertAgentHostProtocolValue(proposal.patch);
	if (encodeAgentHostProtocolValue(proposal.patch)
		!== encodeAgentHostProtocolValue(expectedPatchInput)) {
		throw new TypeError('Draft Editor patch Tool output does not preserve its exact input.');
	}
	return Object.freeze({
		target: captureDraftEditorTarget(output.target),
		proposal: parseDraftEditorPatchProposal(proposal),
	});
}

/** Strictly parses one persistent Feature-owned Draft patch presentation value. */
export function parseDraftEditorPatchPresentationValue(
	value: unknown,
): IDraftEditorPatchPresentationValue & AgentHostProtocolValue {
	const presentation = requireRecord(value, 'Draft Editor patch presentation');
	requireExactKeys(
		presentation,
		['schemaVersion', 'target', 'proposal', 'applyState'],
		[],
		'Draft Editor patch presentation',
	);
	if (presentation.schemaVersion !== DraftEditorPatchPresentationSchemaVersion) {
		throw new TypeError('Draft Editor patch presentation schema version is unsupported.');
	}
	const result: IDraftEditorPatchPresentationValue = Object.freeze({
		schemaVersion: DraftEditorPatchPresentationSchemaVersion,
		target: captureDraftEditorTarget(presentation.target),
		proposal: parseDraftEditorPatchProposal(presentation.proposal),
		applyState: parseApplyState(presentation.applyState),
	});
	if (result.applyState.kind === 'applied' && !result.proposal.accepted) {
		throw new TypeError('An inapplicable Draft Editor patch cannot be applied.');
	}
	assertAgentHostProtocolValue(result);
	return result;
}

/** Creates the normalized persistent value used by the generic Chat presentation envelope. */
export function createDraftEditorPatchPresentationValue(
	target: IAgentHostInteractionTarget,
	proposal: IDraftEditorPatchProposal,
	applyState: DraftEditorPatchApplyState,
): IDraftEditorPatchPresentationValue & AgentHostProtocolValue {
	return parseDraftEditorPatchPresentationValue({
		schemaVersion: DraftEditorPatchPresentationSchemaVersion,
		target,
		proposal,
		applyState,
	});
}
