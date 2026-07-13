/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { $ } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import { URI } from 'cs/base/common/uri';
import {
	applyWritingEditorEdit,
	applyWritingEditorEdits,
	collectWritingEditorTextUnits,
	createWritingEditorTextModel,
	findWritingEditorNodeByBlockId,
	getWritingEditorTextUnitByBlockId,
	isWritingEditorPlainTextEditableNode,
	type WritingEditorSelection,
} from 'cs/editor/common/writingEditorDocument';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	type AgentHostClientConnectionId,
	type AgentToolCallId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	parseCometToolSchema,
	validateAndFreezeAgentToolRegistration,
	validateCometToolValue,
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	type IAgentToolRegistration,
	type IAgentToolSchema,
} from 'cs/platform/agentHost/common/tools';
import { IClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import {
	IChatBrowserPresentationService,
	type IChatBrowserPresentationRenderContext,
	type IChatBrowserPresentationRenderer,
} from 'cs/workbench/contrib/chat/browser/chatBrowserPresentations';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type {
	IChatHostPresentationProjection,
	IChatHostPresentationProjectionContext,
	IChatHostPresentationProvider,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import { DraftEditorInputScheme } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';
import {
	IDraftEditorService,
	type IDraftEditorTargetSnapshot,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import {
	createDraftEditorInteractionTarget,
	DraftEditorGetSelectionContextToolId,
	DraftEditorInteractionTargetOwner,
	DraftEditorInteractionTargetSchemaVersion,
	DraftEditorInteractionTargetType,
	DraftEditorListTextUnitsToolId,
	DraftEditorProposeEditorPatchToolId,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorAgentTools';
import {
	createDraftEditorPatchPresentationValue,
	DraftEditorPatchPresentationType,
	parseDraftEditorPatch,
	parseDraftEditorPatchPresentationValue,
	parseDraftEditorPatchToolOutput,
	type DraftEditorPatchApplyState,
	type IDraftEditorPatchPresentationValue,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorChatPresentations';

const DraftEditorToolContributor = createAgentToolContributorId('comet.draft-editor');
const DraftEditorToolDescriptorRevision = createAgentToolDescriptorRevision('1');
const DraftEditorToolRegistrationRevision = createAgentToolRegistrationRevision('1');
const maximumTextUnitPageLimit = 50;

type DraftEditorToolKind = 'getSelectionContext' | 'listTextUnits' | 'proposeEditorPatch';

export interface IDraftEditorToolDefinition {
	readonly kind: DraftEditorToolKind;
	readonly registration: IAgentToolRegistration;
}

function toolSchema(value: AgentHostProtocolValue): IAgentToolSchema {
	return Object.freeze({ profile: COMET_TOOL_SCHEMA_PROFILE, value });
}

function protocolValue(value: object): AgentHostProtocolValue {
	assertAgentHostProtocolValue(value);
	return value as AgentHostProtocolValue;
}

const nullableStringSchema = Object.freeze({
	type: 'oneOf',
	variants: Object.freeze([
		Object.freeze({ type: 'null' }),
		Object.freeze({ type: 'string', maximumLength: 4 * 1024 * 1024 }),
	]),
}) satisfies AgentHostProtocolValue;

const targetSchema = Object.freeze({
	type: 'object',
	properties: Object.freeze({
		id: Object.freeze({ type: 'string', maximumLength: 128 }),
		owner: Object.freeze({ type: 'literal', value: DraftEditorInteractionTargetOwner }),
		type: Object.freeze({ type: 'literal', value: DraftEditorInteractionTargetType }),
		schemaVersion: Object.freeze({ type: 'literal', value: DraftEditorInteractionTargetSchemaVersion }),
		resource: Object.freeze({ type: 'string', maximumLength: 4_096 }),
		resourceVersion: Object.freeze({ type: 'string', maximumLength: 256 }),
		revision: Object.freeze({ type: 'string', maximumLength: 128 }),
		authority: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				kind: Object.freeze({ type: 'literal', value: 'client' }),
				connection: Object.freeze({ type: 'string', maximumLength: 128 }),
			}),
			required: Object.freeze(['kind', 'connection']),
			additionalProperties: false,
		}),
		availability: Object.freeze({ type: 'literal', value: 'connection' }),
		display: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				label: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
				description: Object.freeze({ type: 'string', maximumLength: 2_048 }),
			}),
			required: Object.freeze(['label']),
			additionalProperties: false,
		}),
	}),
	required: Object.freeze([
		'id', 'owner', 'type', 'schemaVersion', 'resource', 'resourceVersion', 'revision',
		'authority', 'availability', 'display',
	]),
	additionalProperties: false,
}) satisfies AgentHostProtocolValue;

const textUnitKindSchema = Object.freeze({
	type: 'string',
	enum: Object.freeze([
		'paragraph', 'heading1', 'heading2', 'heading3', 'blockquote', 'figcaption',
	]),
}) satisfies AgentHostProtocolValue;

const stableEditCommonProperties = Object.freeze({
	blockId: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
	expectedText: nullableStringSchema,
	text: Object.freeze({ type: 'string', maximumLength: 4 * 1024 * 1024 }),
});

function stableEditVariant(
	kind: string,
	properties: Readonly<Record<string, AgentHostProtocolValue>>,
	required: readonly string[],
): AgentHostProtocolValue {
	return Object.freeze({
		type: 'object',
		properties: Object.freeze({
			...stableEditCommonProperties,
			kind: Object.freeze({ type: 'literal', value: kind }),
			...properties,
		}),
		required: Object.freeze(['blockId', 'expectedText', 'kind', 'text', ...required]),
		additionalProperties: false,
	});
}

const stableEditSchema = Object.freeze({
	type: 'oneOf',
	variants: Object.freeze([
		stableEditVariant('replaceBlock', {}, []),
		stableEditVariant('replaceRange', {
			from: Object.freeze({ type: 'integer', minimum: 0 }),
			to: Object.freeze({ type: 'integer', minimum: 0 }),
		}, ['from', 'to']),
		stableEditVariant('replaceLine', {
			line: Object.freeze({ type: 'integer', minimum: 1 }),
		}, ['line']),
		stableEditVariant('replaceLineRange', {
			line: Object.freeze({ type: 'integer', minimum: 1 }),
			fromColumn: Object.freeze({ type: 'integer', minimum: 1 }),
			toColumn: Object.freeze({ type: 'integer', minimum: 1 }),
		}, ['line', 'fromColumn', 'toColumn']),
		stableEditVariant('replaceMatch', {
			match: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 4 * 1024 * 1024 }),
			occurrence: Object.freeze({ type: 'integer', minimum: 1 }),
		}, ['match', 'occurrence']),
	]),
}) satisfies AgentHostProtocolValue;

const patchOperationSchema = Object.freeze({
	type: 'oneOf',
	variants: Object.freeze([
		Object.freeze({
			type: 'object',
			properties: Object.freeze({
				kind: Object.freeze({ type: 'literal', value: 'text-edit' }),
				edit: stableEditSchema,
			}),
			required: Object.freeze(['kind', 'edit']),
			additionalProperties: false,
		}),
		Object.freeze({
			type: 'object',
			properties: Object.freeze({
				kind: Object.freeze({ type: 'literal', value: 'insert-citation' }),
				anchorBlockId: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
				citationIds: Object.freeze({
					type: 'array',
					items: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
					minimumItems: 1,
					maximumItems: 1_000,
				}),
			}),
			required: Object.freeze(['kind', 'anchorBlockId', 'citationIds']),
			additionalProperties: false,
		}),
		Object.freeze({
			type: 'object',
			properties: Object.freeze({
				kind: Object.freeze({ type: 'literal', value: 'insert-figure-ref' }),
				anchorBlockId: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
				figureId: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
			}),
			required: Object.freeze(['kind', 'anchorBlockId', 'figureId']),
			additionalProperties: false,
		}),
	]),
}) satisfies AgentHostProtocolValue;

const patchSchema = Object.freeze({
	type: 'object',
	properties: Object.freeze({
		label: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 512 }),
		summary: nullableStringSchema,
		operations: Object.freeze({
			type: 'array',
			items: patchOperationSchema,
			minimumItems: 1,
			maximumItems: 1_000,
		}),
	}),
	required: Object.freeze(['label', 'summary', 'operations']),
	additionalProperties: false,
}) satisfies AgentHostProtocolValue;

const proposalSchema = Object.freeze({
	type: 'object',
	properties: Object.freeze({
		patch: patchSchema,
		accepted: Object.freeze({ type: 'boolean' }),
		operationsValidated: Object.freeze({ type: 'integer', minimum: 0, maximum: 1_000 }),
		failedOperationIndex: Object.freeze({
			type: 'oneOf',
			variants: Object.freeze([
				Object.freeze({ type: 'null' }),
				Object.freeze({ type: 'integer', minimum: 0, maximum: 999 }),
			]),
		}),
		requiresCustomExecutor: Object.freeze({ type: 'boolean' }),
		validationError: Object.freeze({
			type: 'oneOf',
			variants: Object.freeze([
				Object.freeze({ type: 'null' }),
				Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 8_192 }),
			]),
		}),
	}),
	required: Object.freeze([
		'patch', 'accepted', 'operationsValidated', 'failedOperationIndex',
		'requiresCustomExecutor', 'validationError',
	]),
	additionalProperties: false,
}) satisfies AgentHostProtocolValue;

const targetedProposalOutputSchema = toolSchema(Object.freeze({
	type: 'object',
	properties: Object.freeze({ target: targetSchema, proposal: proposalSchema }),
	required: Object.freeze(['target', 'proposal']),
	additionalProperties: false,
}));

function createRegistration(
	connection: AgentHostClientConnectionId,
	kind: DraftEditorToolKind,
	options: {
		readonly id: typeof DraftEditorProposeEditorPatchToolId;
		readonly functionName: string;
		readonly displayName: string;
		readonly description: string;
		readonly inputSchema: IAgentToolSchema;
		readonly outputSchema: IAgentToolSchema;
		readonly safety: 'read' | 'write';
		readonly confirmation: 'never' | 'always';
		readonly allowsEditedInput: boolean;
		readonly maximumInputBytes: number;
		readonly maximumConcurrency: number;
	},
): IDraftEditorToolDefinition {
	const registration = validateAndFreezeAgentToolRegistration({
		id: createAgentToolRegistrationId(`${options.id}.registration`),
		revision: DraftEditorToolRegistrationRevision,
		descriptor: {
			id: options.id,
			revision: DraftEditorToolDescriptorRevision,
			contributor: DraftEditorToolContributor,
			functionName: options.functionName,
			displayName: options.displayName,
			description: options.description,
			inputSchema: options.inputSchema,
			outputSchema: options.outputSchema,
			safety: options.safety,
			confirmation: options.confirmation,
			allowsEditedInput: options.allowsEditedInput,
			targetTypes: Object.freeze([DraftEditorInteractionTargetType]),
			limits: Object.freeze({
				maximumInputBytes: options.maximumInputBytes,
				maximumOutputBytes: 8 * 1024 * 1024,
				maximumContentBytes: 8 * 1024 * 1024,
				timeoutMilliseconds: 30_000,
				maximumConcurrency: options.maximumConcurrency,
			}),
		},
		executor: {
			kind: 'client',
			connection,
			executor: createAgentToolExecutorId(`${options.id}.executor`),
		},
	});
	return Object.freeze({ kind, registration });
}

export function createDraftEditorAgentToolDefinitions(
	connection: AgentHostClientConnectionId,
): readonly IDraftEditorToolDefinition[] {
	const targetedSelectionOutput = toolSchema(Object.freeze({
		type: 'object',
		properties: Object.freeze({
			target: targetSchema,
			selection: Object.freeze({
				type: 'oneOf',
				variants: Object.freeze([
					Object.freeze({ type: 'null' }),
					Object.freeze({
						type: 'object',
						properties: Object.freeze({
							blockId: Object.freeze({ type: 'string', maximumLength: 512 }),
							kind: textUnitKindSchema,
							startOffset: Object.freeze({ type: 'integer', minimum: 0 }),
							endOffset: Object.freeze({ type: 'integer', minimum: 0 }),
							selectedText: Object.freeze({ type: 'string', maximumLength: 4 * 1024 * 1024 }),
							isCollapsed: Object.freeze({ type: 'boolean' }),
							isPlainTextEditable: Object.freeze({ type: 'boolean' }),
							range: Object.freeze({
								type: 'object',
								properties: Object.freeze({
									startLineNumber: Object.freeze({ type: 'integer', minimum: 1 }),
									startColumn: Object.freeze({ type: 'integer', minimum: 1 }),
									endLineNumber: Object.freeze({ type: 'integer', minimum: 1 }),
									endColumn: Object.freeze({ type: 'integer', minimum: 1 }),
								}),
								required: Object.freeze([
									'startLineNumber', 'startColumn', 'endLineNumber', 'endColumn',
								]),
								additionalProperties: false,
							}),
						}),
						required: Object.freeze([
							'blockId', 'kind', 'startOffset', 'endOffset', 'selectedText',
							'isCollapsed', 'isPlainTextEditable', 'range',
						]),
						additionalProperties: false,
					}),
				]),
			}),
		}),
		required: Object.freeze(['target', 'selection']),
		additionalProperties: false,
	}));
	const lineSchema = Object.freeze({
		type: 'object',
		properties: Object.freeze({
			lineNumber: Object.freeze({ type: 'integer', minimum: 1 }),
			startOffset: Object.freeze({ type: 'integer', minimum: 0 }),
			endOffset: Object.freeze({ type: 'integer', minimum: 0 }),
			text: Object.freeze({ type: 'string', maximumLength: 4 * 1024 * 1024 }),
		}),
		required: Object.freeze(['lineNumber', 'startOffset', 'endOffset', 'text']),
		additionalProperties: false,
	});
	const targetedUnitsOutput = toolSchema(Object.freeze({
		type: 'object',
		properties: Object.freeze({
			target: targetSchema,
			units: Object.freeze({
				type: 'array',
				items: Object.freeze({
					type: 'object',
					properties: Object.freeze({
						blockId: Object.freeze({ type: 'string', maximumLength: 512 }),
						kind: textUnitKindSchema,
						text: Object.freeze({ type: 'string', maximumLength: 4 * 1024 * 1024 }),
						lines: Object.freeze({ type: 'array', items: lineSchema, maximumItems: 8_192 }),
					}),
					required: Object.freeze(['blockId', 'kind', 'text', 'lines']),
					additionalProperties: false,
				}),
				maximumItems: maximumTextUnitPageLimit,
			}),
			nextCursor: Object.freeze({
				type: 'oneOf',
				variants: Object.freeze([
					Object.freeze({ type: 'null' }),
					Object.freeze({ type: 'integer', minimum: 0 }),
				]),
			}),
			total: Object.freeze({ type: 'integer', minimum: 0 }),
		}),
		required: Object.freeze(['target', 'units', 'nextCursor', 'total']),
		additionalProperties: false,
	}));
	return Object.freeze([
		createRegistration(connection, 'getSelectionContext', {
			id: DraftEditorGetSelectionContextToolId,
			functionName: 'get_selection_context',
			displayName: 'Get Selection Context',
			description: 'Read the stable selection from one exact versioned Draft document target.',
			inputSchema: toolSchema(Object.freeze({
				type: 'object', properties: Object.freeze({}), required: Object.freeze([]), additionalProperties: false,
			})),
			outputSchema: targetedSelectionOutput,
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			maximumInputBytes: 64 * 1024,
			maximumConcurrency: 4,
		}),
		createRegistration(connection, 'listTextUnits', {
			id: DraftEditorListTextUnitsToolId,
			functionName: 'list_text_units',
			displayName: 'List Text Units',
			description: 'List stable block-addressable text units from one exact Draft document target.',
			inputSchema: toolSchema(Object.freeze({
				type: 'object',
				properties: Object.freeze({
					kinds: Object.freeze({
						type: 'array', items: textUnitKindSchema, maximumItems: 6,
					}),
					cursor: Object.freeze({ type: 'integer', minimum: 0 }),
					limit: Object.freeze({ type: 'integer', minimum: 1, maximum: maximumTextUnitPageLimit }),
				}),
				required: Object.freeze(['kinds', 'cursor', 'limit']),
				additionalProperties: false,
			})),
			outputSchema: targetedUnitsOutput,
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			maximumInputBytes: 64 * 1024,
			maximumConcurrency: 4,
		}),
		createRegistration(connection, 'proposeEditorPatch', {
			id: DraftEditorProposeEditorPatchToolId,
			functionName: 'propose_editor_patch',
			displayName: 'Propose Editor Patch',
			description: 'Validate and present a reviewable patch for one exact Draft document target.',
			inputSchema: toolSchema(patchSchema),
			outputSchema: targetedProposalOutputSchema,
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			maximumInputBytes: 8 * 1024 * 1024,
			maximumConcurrency: 1,
		}),
	]);
}

type DraftEditorTargetResolution =
	| { readonly ok: true; readonly snapshot: IDraftEditorTargetSnapshot }
	| { readonly ok: false; readonly code: 'invalidInput' | 'unavailable'; readonly message: string };

async function resolveDraftEditorTarget(
	target: IAgentHostInteractionTarget | undefined,
	connection: AgentHostClientConnectionId,
	draftEditorService: IDraftEditorService,
): Promise<DraftEditorTargetResolution> {
	if (!target) {
		return { ok: false, code: 'invalidInput', message: 'Draft Editor Tool call requires an exact target.' };
	}
	try {
		assertAgentHostInteractionTarget(target);
	} catch {
		return { ok: false, code: 'invalidInput', message: 'Draft Editor Tool target is malformed.' };
	}
	if (target.owner !== DraftEditorInteractionTargetOwner
		|| target.type !== DraftEditorInteractionTargetType
		|| target.schemaVersion !== DraftEditorInteractionTargetSchemaVersion
		|| target.authority.kind !== 'client'
		|| target.authority.connection !== connection
		|| target.availability !== 'connection'
		|| target.expiresAt !== undefined) {
		return { ok: false, code: 'invalidInput', message: 'Draft Editor Tool target metadata is incompatible.' };
	}
	let resource: URI;
	try {
		resource = URI.parse(target.resource);
	} catch {
		return { ok: false, code: 'invalidInput', message: 'Draft Editor Tool target resource is invalid.' };
	}
	if (resource.scheme !== DraftEditorInputScheme || resource.toString(true) !== target.resource) {
		return { ok: false, code: 'invalidInput', message: 'Draft Editor Tool target resource is not canonical.' };
	}
	const snapshot = draftEditorService.getTargetSnapshot(resource);
	if (!snapshot) {
		return { ok: false, code: 'unavailable', message: 'The exact Draft document target is unavailable.' };
	}
	const currentTarget = await createDraftEditorInteractionTarget(snapshot, connection);
	if (currentTarget.id !== target.id
		|| currentTarget.resource !== target.resource
		|| currentTarget.resourceVersion !== target.resourceVersion
		|| currentTarget.revision !== target.revision) {
		return { ok: false, code: 'unavailable', message: 'The Draft document changed after the target was bound.' };
	}
	const confirmedSnapshot = draftEditorService.getTargetSnapshot(resource);
	if (!confirmedSnapshot
		|| confirmedSnapshot.resource.toString(true) !== snapshot.resource.toString(true)
		|| confirmedSnapshot.name !== snapshot.name
		|| encodeAgentHostProtocolValue(confirmedSnapshot.document)
			!== encodeAgentHostProtocolValue(snapshot.document)) {
		return { ok: false, code: 'unavailable', message: 'The Draft document changed while its target was resolved.' };
	}
	return { ok: true, snapshot: confirmedSnapshot };
}

function toolFailure(
	call: AgentToolCallId,
	code: 'cancelled' | 'unavailable' | 'invalidInput' | 'invalidOutput' | 'failed',
	message: string,
): AgentToolResult {
	return Object.freeze({
		call,
		status: code === 'cancelled' ? 'cancelled' : 'failed',
		failure: Object.freeze({ code, message, reconciliation: 'terminal' }),
	});
}

function selectionContext(
	snapshot: IDraftEditorTargetSnapshot,
	selection: WritingEditorSelection | null | undefined,
): AgentHostProtocolValue {
	if (!selection) {
		return null;
	}
	const unit = getWritingEditorTextUnitByBlockId(snapshot.document, selection.blockId);
	if (!unit || selection.startOffset > selection.endOffset || selection.endOffset > unit.text.length) {
		throw new Error('Draft Editor selection is outside its exact document version.');
	}
	const model = createWritingEditorTextModel(snapshot.document, selection.blockId);
	const start = model.getPositionAt(selection.startOffset);
	const end = model.getPositionAt(selection.endOffset);
	const node = findWritingEditorNodeByBlockId(snapshot.document, selection.blockId);
	return {
		blockId: selection.blockId,
		kind: unit.kind,
		range: {
			startLineNumber: start.lineNumber,
			startColumn: start.column,
			endLineNumber: end.lineNumber,
			endColumn: end.column,
		},
		startOffset: selection.startOffset,
		endOffset: selection.endOffset,
		selectedText: unit.text.slice(selection.startOffset, selection.endOffset),
		isCollapsed: selection.startOffset === selection.endOffset,
		isPlainTextEditable: node !== null && isWritingEditorPlainTextEditableNode(node),
	};
}

interface IDraftEditorEndpointCallRecord {
	readonly canonicalCall: string;
	state: 'pending' | 'terminal';
	result?: AgentToolResult;
}

export class DraftEditorAgentToolEndpoint implements IAgentToolExecutorEndpoint {
	private readonly calls = new Map<AgentToolCallId, IDraftEditorEndpointCallRecord>();
	private readonly cancelled = new Set<AgentToolCallId>();

	constructor(
		private readonly definition: IDraftEditorToolDefinition,
		private readonly connection: AgentHostClientConnectionId,
		private readonly draftEditorService: IDraftEditorService,
	) {}

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		_reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		this.assertExactCall(call);
		const canonicalCall = encodeAgentHostProtocolValue(call);
		const existing = this.calls.get(call.id);
		if (existing) {
			if (existing.canonicalCall !== canonicalCall || !existing.result) {
				throw new Error(`Draft Editor Tool call '${call.id}' conflicts with endpoint state.`);
			}
			return existing.result;
		}
		const record: IDraftEditorEndpointCallRecord = { canonicalCall, state: 'pending' };
		this.calls.set(call.id, record);
		let result: AgentToolResult;
		if (this.cancelled.has(call.id) || cancellation.isCancellationRequested) {
			result = toolFailure(call.id, 'cancelled', 'Draft Editor Tool call was cancelled.');
		} else {
			result = await this.executeUncached(call, target, cancellation);
		}
		record.state = 'terminal';
		record.result = result;
		return result;
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		this.assertExactCall(call);
		const record = this.calls.get(call.id);
		if (!record || record.canonicalCall !== encodeAgentHostProtocolValue(call)) {
			throw new Error(`Draft Editor Tool call '${call.id}' is unavailable for cancellation.`);
		}
		if (record.state === 'pending') {
			this.cancelled.add(call.id);
		}
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		this.assertExactCall(call);
		const record = this.calls.get(call.id);
		if (!record) {
			return Object.freeze({ kind: 'unknown' });
		}
		if (record.canonicalCall !== encodeAgentHostProtocolValue(call)) {
			throw new Error(`Draft Editor Tool call '${call.id}' conflicts with endpoint state.`);
		}
		return record.state === 'pending'
			? Object.freeze({ kind: 'pending' })
			: Object.freeze({ kind: 'terminal', result: record.result! });
	}

	private assertExactCall(call: IAgentToolCall): void {
		const registration = this.definition.registration;
		if (call.registrationId !== registration.id
			|| call.registrationRevision !== registration.revision
			|| call.tool !== registration.descriptor.id
			|| call.descriptor !== registration.descriptor.revision
			|| call.target === undefined
			|| call.effect.kind !== 'read') {
			throw new Error(`Draft Editor Tool call '${call.id}' does not match its exact registration.`);
		}
	}

	private async executeUncached(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		let input: AgentHostProtocolValue;
		try {
			input = validateCometToolValue(
				parseCometToolSchema(this.definition.registration.descriptor.inputSchema),
				call.input,
				`Draft Editor Tool '${call.tool}' input`,
			);
		} catch {
			return toolFailure(call.id, 'invalidInput', 'Draft Editor Tool input does not match its schema.');
		}
		const resolution = await resolveDraftEditorTarget(target, this.connection, this.draftEditorService);
		if (!resolution.ok) {
			return toolFailure(call.id, resolution.code, resolution.message);
		}
		if (target!.id !== call.target) {
			return toolFailure(call.id, 'invalidInput', 'Draft Editor Tool call target identity is not exact.');
		}
		if (this.cancelled.has(call.id) || cancellation.isCancellationRequested) {
			return toolFailure(call.id, 'cancelled', 'Draft Editor Tool call was cancelled.');
		}

		let output: AgentHostProtocolValue;
		try {
			switch (this.definition.kind) {
				case 'getSelectionContext':
					output = protocolValue({
						target: target!,
						selection: selectionContext(resolution.snapshot, resolution.snapshot.selection),
					});
					break;
				case 'listTextUnits': {
					const request = input as { readonly kinds: readonly string[]; readonly cursor: number; readonly limit: number };
					const requestedKinds = new Set(request.kinds);
					const allUnits = collectWritingEditorTextUnits(resolution.snapshot.document);
					const matchingUnits = requestedKinds.size === 0
						? allUnits
						: allUnits.filter(unit => requestedKinds.has(unit.kind));
					const units = matchingUnits.slice(request.cursor, request.cursor + request.limit);
					output = protocolValue({
						target: target!,
						units,
						nextCursor: request.cursor + units.length < matchingUnits.length
							? request.cursor + units.length
							: null,
						total: matchingUnits.length,
					});
					break;
				}
				case 'proposeEditorPatch': {
					let patch: ReturnType<typeof parseDraftEditorPatch>;
					try {
						patch = parseDraftEditorPatch(input);
					} catch {
						return toolFailure(
							call.id,
							'invalidInput',
							'Draft Editor patch input is semantically invalid.',
						);
					}
					let document = resolution.snapshot.document;
					let operationsValidated = 0;
					let accepted = true;
					let failedOperationIndex: number | null = null;
					let requiresCustomExecutor = false;
					let validationError: string | null = null;
					for (const [index, operation] of patch.operations.entries()) {
						if (operation.kind !== 'text-edit') {
							accepted = false;
							failedOperationIndex = index;
							requiresCustomExecutor = true;
							validationError = 'Patch contains structured operations that require a custom executor.';
							break;
						}
						const editResult = applyWritingEditorEdit(document, operation.edit);
						if (!editResult.ok) {
							accepted = false;
							failedOperationIndex = index;
							validationError = editResult.message;
							break;
						}
						document = editResult.document;
						operationsValidated += 1;
					}
					output = protocolValue({
						target: target!,
						proposal: {
							patch: input,
							accepted,
							operationsValidated,
							failedOperationIndex,
							requiresCustomExecutor,
							validationError,
						},
					});
					break;
				}
			}
			output = validateCometToolValue(
				parseCometToolSchema(this.definition.registration.descriptor.outputSchema),
				output,
				`Draft Editor Tool '${call.tool}' output`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return toolFailure(call.id, 'invalidOutput', message.slice(0, 8_192));
		}
		return Object.freeze({ call: call.id, status: 'completed', output });
	}
}

function assertDraftEditorTargetConnection(
	target: IAgentHostInteractionTarget,
	connection: AgentHostClientConnectionId,
): void {
	if (target.authority.kind !== 'client'
		|| target.authority.connection !== connection
		|| target.availability !== 'connection'
		|| target.expiresAt !== undefined) {
		throw new TypeError('Draft Editor patch target authority is incompatible.');
	}
}

function equalProtocolValues(left: AgentHostProtocolValue | object, right: AgentHostProtocolValue | object): boolean {
	return encodeAgentHostProtocolValue(left) === encodeAgentHostProtocolValue(right);
}

/** Projects exact proposal Tool output into Feature-owned persistent presentation state. */
export class DraftEditorPatchPresentationProvider implements IChatHostPresentationProvider {
	readonly tool = DraftEditorProposeEditorPatchToolId;

	constructor(private readonly connection: AgentHostClientConnectionId) {}

	project(
		context: IChatHostPresentationProjectionContext,
		persistedValue: AgentHostProtocolValue | undefined,
	): IChatHostPresentationProjection {
		const output = parseDraftEditorPatchToolOutput(context.result.output, context.call.input);
		assertDraftEditorTargetConnection(output.target, this.connection);
		const acceptedTarget = context.turn.user.interactionTargets.find(
			target => target.id === output.target.id,
		);
		if (!acceptedTarget || !equalProtocolValues(acceptedTarget, output.target)) {
			throw new TypeError(
				`Draft Editor patch Tool result '${context.call.call}' does not preserve an exact accepted target.`,
			);
		}

		let applyState: DraftEditorPatchApplyState = Object.freeze({ kind: 'pending' });
		if (persistedValue !== undefined) {
			const persisted = parseDraftEditorPatchPresentationValue(persistedValue);
			if (!equalProtocolValues(persisted.target, output.target)
				|| !equalProtocolValues(persisted.proposal, output.proposal)) {
				throw new TypeError(
					`Draft Editor patch Tool result '${context.call.call}' conflicts with persistent state.`,
				);
			}
			applyState = persisted.applyState;
		}

		return Object.freeze({
			type: DraftEditorPatchPresentationType,
			value: createDraftEditorPatchPresentationValue(
				output.target,
				output.proposal,
				applyState,
			),
		});
	}
}

function isApplicablePatch(value: IDraftEditorPatchPresentationValue): boolean {
	return value.applyState.kind === 'pending'
		&& value.proposal.accepted
		&& !value.proposal.requiresCustomExecutor
		&& value.proposal.validationError === null
		&& value.proposal.patch.operations.every(operation => operation.kind === 'text-edit');
}

/** Renders and applies one exact Draft patch only from explicit user interaction. */
export class DraftEditorPatchPresentationRenderer implements IChatBrowserPresentationRenderer {
	readonly type = DraftEditorPatchPresentationType;

	constructor(
		private readonly connection: AgentHostClientConnectionId,
		private readonly draftEditorService: IDraftEditorService,
		private readonly chatService: Pick<IChatService, 'acquireModel' | 'updateHostPresentation'>,
	) {}

	render(context: IChatBrowserPresentationRenderContext): HTMLElement {
		const value = parseDraftEditorPatchPresentationValue(context.presentation.value);
		const card = $<HTMLElementTagNameMap['div']>('div.comet-draft-editor-patch-card');
		const header = $<HTMLElementTagNameMap['div']>('div.comet-draft-editor-patch-header');
		const label = $<HTMLElementTagNameMap['strong']>('strong.comet-draft-editor-patch-label');
		label.textContent = value.proposal.patch.label;
		header.append(label);
		if (value.applyState.kind === 'applied') {
			const applied = $<HTMLElementTagNameMap['span']>('span.comet-draft-editor-patch-status');
			applied.textContent = context.ui.assistantSidebarPatchApplied;
			header.append(applied);
		}
		card.append(header);

		if (value.proposal.patch.summary !== undefined) {
			const summary = $<HTMLElementTagNameMap['p']>('p.comet-draft-editor-patch-summary');
			summary.textContent = value.proposal.patch.summary;
			card.append(summary);
		}

		const errorMessage = this.getErrorMessage(context, value);
		if (errorMessage !== undefined) {
			const error = $<HTMLElementTagNameMap['p']>('p.comet-draft-editor-patch-error');
			error.textContent = errorMessage;
			card.append(error);
		}

		if (context.presentation.origin.kind === 'host' && isApplicablePatch(value)) {
			const footer = $<HTMLElementTagNameMap['div']>('div.comet-draft-editor-patch-footer');
			const label = context.ui.assistantSidebarPatchApply;
			let applying = false;
			const button = context.disposables.add(new ButtonView({
				className: 'comet-draft-editor-patch-button',
				variant: 'primary',
				size: 'sm',
				content: label,
				ariaLabel: label,
				onClick: () => {
					if (applying) {
						return;
					}
					applying = true;
					button.setProps({
						className: 'comet-draft-editor-patch-button',
						variant: 'primary',
						size: 'sm',
						content: label,
						ariaLabel: label,
						isLoading: true,
						disabled: true,
					});
					void this.apply(context, value).catch(onUnexpectedError);
				},
			}));
			footer.append(button.getElement());
			card.append(footer);
		}
		return card;
	}

	private getErrorMessage(
		context: IChatBrowserPresentationRenderContext,
		value: IDraftEditorPatchPresentationValue,
	): string | undefined {
		if (value.applyState.kind === 'applyFailed') {
			if (value.applyState.code === 'unavailable'
				|| value.applyState.code === 'invalidProposal') {
				return context.ui.assistantSidebarPatchUnavailable;
			}
			return value.applyState.message;
		}
		if (value.proposal.requiresCustomExecutor) {
			return context.ui.assistantSidebarPatchRequiresExecutor;
		}
		if (value.proposal.validationError !== null) {
			return value.proposal.validationError;
		}
		if (!value.proposal.accepted) {
			return context.ui.assistantSidebarPatchUnavailable;
		}
		return undefined;
	}

	private async apply(
		context: IChatBrowserPresentationRenderContext,
		value: IDraftEditorPatchPresentationValue,
	): Promise<void> {
		if (context.presentation.origin.kind !== 'host') {
			throw new TypeError('Only a canonical Host presentation can apply a Draft Editor patch.');
		}
		if (!isApplicablePatch(value)) {
			this.updateApplyState(context, value, Object.freeze({
				kind: 'applyFailed',
				code: 'invalidProposal',
				message: context.ui.assistantSidebarPatchUnavailable,
			}));
			return;
		}

		const resolution = await resolveDraftEditorTarget(
			value.target,
			this.connection,
			this.draftEditorService,
		);
		if (!resolution.ok) {
			this.updateApplyState(context, value, Object.freeze({
				kind: 'applyFailed',
				code: resolution.code,
				message: resolution.message,
			}));
			return;
		}

		const edits = value.proposal.patch.operations.flatMap(operation =>
			operation.kind === 'text-edit' ? [operation.edit] : [],
		);
		if (edits.length !== value.proposal.patch.operations.length) {
			throw new TypeError('Applicable Draft Editor patch contains a structured operation.');
		}
		const result = applyWritingEditorEdits(resolution.snapshot.document, edits);
		if (!result.ok) {
			this.updateApplyState(context, value, Object.freeze({
				kind: 'applyFailed',
				code: result.reason,
				message: result.message,
			}));
			return;
		}

		this.commitAppliedPresentation(
			context,
			value,
			resolution.snapshot.resource,
			result.document,
		);
	}

	private commitAppliedPresentation(
		context: IChatBrowserPresentationRenderContext,
		value: IDraftEditorPatchPresentationValue,
		resource: URI,
		document: Parameters<IDraftEditorService['setDocument']>[1],
	): boolean {
		if (context.presentation.origin.kind !== 'host') {
			throw new TypeError('Only a canonical Host presentation can apply a Draft Editor patch.');
		}
		const modelReference = this.chatService.acquireModel(context.chatResource);
		try {
			const current = modelReference.object.getHostPresentation(
				context.presentation.origin.identity,
			);
			if (!current
				|| current.type !== DraftEditorPatchPresentationType
				|| !equalProtocolValues(current.value, context.presentation.value)) {
				return false;
			}
			try {
				this.draftEditorService.setDocument(resource, document);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.updateApplyState(context, value, Object.freeze({
					kind: 'applyFailed',
					code: 'writeFailed',
					message: message.slice(0, 8_192),
				}));
				return true;
			}
			this.updateApplyState(context, value, Object.freeze({ kind: 'applied' }));
			return true;
		} finally {
			modelReference.dispose();
		}
	}

	private updateApplyState(
		context: IChatBrowserPresentationRenderContext,
		value: IDraftEditorPatchPresentationValue,
		applyState: DraftEditorPatchApplyState,
	): void {
		if (context.presentation.origin.kind !== 'host') {
			throw new TypeError('Only a canonical Host presentation has persistent apply state.');
		}
		this.chatService.updateHostPresentation(context.chatResource, {
			identity: context.presentation.origin.identity,
			type: DraftEditorPatchPresentationType,
			expectedValue: context.presentation.value,
			value: createDraftEditorPatchPresentationValue(
				value.target,
				value.proposal,
				applyState,
			),
		});
	}
}

/** Publishes the canonical Draft Tool set and its Feature-owned Chat presentation behavior. */
export class DraftEditorAgentToolsContribution extends Disposable {
	constructor(
		@IClientAgentToolService clientToolService: IClientAgentToolService,
		@IDraftEditorService draftEditorService: IDraftEditorService,
		@IChatService chatService: IChatService,
		@IChatBrowserPresentationService presentationService: IChatBrowserPresentationService,
	) {
		super();
		for (const definition of createDraftEditorAgentToolDefinitions(clientToolService.connection)) {
			this._register(clientToolService.publish(
				definition.registration,
				new DraftEditorAgentToolEndpoint(
					definition,
					clientToolService.connection,
					draftEditorService,
				),
			));
		}
		this._register(chatService.registerHostPresentationProvider(
			new DraftEditorPatchPresentationProvider(clientToolService.connection),
		));
		this._register(presentationService.registerRenderer(
			new DraftEditorPatchPresentationRenderer(
				clientToolService.connection,
				draftEditorService,
				chatService,
			),
		));
	}
}
