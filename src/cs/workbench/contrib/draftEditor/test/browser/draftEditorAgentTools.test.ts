/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { getComparisonKey } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import {
	collectWritingEditorTextUnits,
	createWritingEditorDocumentFromPlainText,
	writingEditorDocumentToPlainText,
	type WritingEditorDocument,
	type WritingEditorSelection,
} from 'cs/editor/common/writingEditorDocument';
import {
	createAgentChatId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { createAgentHostClientConnectionId } from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentToolCall } from 'cs/platform/agentHost/common/tools';
import {
	createDraftEditorAgentToolDefinitions,
	DraftEditorAgentToolEndpoint,
	DraftEditorPatchPresentationProvider,
	DraftEditorPatchPresentationRenderer,
	type IDraftEditorToolDefinition,
} from 'cs/workbench/contrib/draftEditor/browser/draftEditorAgentTools';
import {
	createDraftEditorInteractionTarget,
	DraftEditorGetSelectionContextToolId,
	DraftEditorInteractionTargetOwner,
	DraftEditorInteractionTargetType,
	DraftEditorListTextUnitsToolId,
	DraftEditorProposeEditorPatchToolId,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorAgentTools';
import {
	createDraftEditorPatchPresentationValue,
	DraftEditorPatchPresentationType,
	parseDraftEditorPatchPresentationValue,
	parseDraftEditorPatchProposal,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorChatPresentations';
import type {
	IDraftEditorService,
	IDraftEditorTargetSnapshot,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import type { IChatBrowserPresentationRenderContext } from 'cs/workbench/contrib/chat/browser/chatBrowserPresentations';
import type {
	IChatHostPresentationUpdate,
	IChatModel,
	IChatModelReference,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	ChatHostPresentationSchemaVersion,
	type IChatHostPresentation,
	type IChatHostPresentationIdentity,
	type IChatHostPresentationProjectionContext,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import { locales } from 'language/locales';

const connection = createAgentHostClientConnectionId('draft-tools-test-client');
let cleanupDomEnvironment: (() => void) | undefined;

test.before(() => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

class TestDraftEditorService implements IDraftEditorService {
	declare readonly _serviceBrand: undefined;
	readonly activeInput = undefined;
	private readonly documents = new Map<string, {
		readonly resource: URI;
		readonly name: string;
		document: WritingEditorDocument;
		selection: WritingEditorSelection | null | undefined;
	}>();
	private replaceAfterNextSnapshot: { readonly resource: URI; readonly document: WritingEditorDocument } | undefined;
	readonly writes: URI[] = [];

	canSaveActive(): boolean { return false; }
	getDocument(resource: URI): WritingEditorDocument | null {
		return this.documents.get(getComparisonKey(resource))?.document ?? null;
	}
	getTargetSnapshot(resource: URI): IDraftEditorTargetSnapshot | null {
		const document = this.documents.get(getComparisonKey(resource));
		if (!document) {
			return null;
		}
		const snapshot: IDraftEditorTargetSnapshot = {
			resource: document.resource,
			name: document.name,
			document: document.document,
			selection: document.selection,
		};
		if (this.replaceAfterNextSnapshot
			&& getComparisonKey(this.replaceAfterNextSnapshot.resource) === getComparisonKey(resource)) {
			document.document = this.replaceAfterNextSnapshot.document;
			this.replaceAfterNextSnapshot = undefined;
		}
		return snapshot;
	}
	saveActive(): boolean { return false; }
	setDocument(resource: URI, value: WritingEditorDocument): void {
		const document = this.documents.get(getComparisonKey(resource));
		if (!document) {
			throw new Error(`Unknown test Draft '${resource.toString()}'.`);
		}
		document.document = value;
		this.writes.push(resource);
	}

	add(
		resource: URI,
		text: string,
		selection: WritingEditorSelection | null | undefined = null,
	): IDraftEditorTargetSnapshot {
		this.documents.set(getComparisonKey(resource), {
			resource,
			name: resource.path.slice(1),
			document: createWritingEditorDocumentFromPlainText(text),
			selection,
		});
		return this.getTargetSnapshot(resource)!;
	}

	setSelection(resource: URI, selection: WritingEditorSelection | null | undefined): void {
		const document = this.documents.get(getComparisonKey(resource));
		if (!document) {
			throw new Error(`Unknown test Draft '${resource.toString()}'.`);
		}
		document.selection = selection;
	}

	replaceDocumentAfterNextSnapshot(resource: URI, text: string): void {
		this.replaceAfterNextSnapshot = {
			resource,
			document: createWritingEditorDocumentFromPlainText(text),
		};
	}
}

function samePresentationIdentity(
	left: IChatHostPresentationIdentity,
	right: IChatHostPresentationIdentity,
): boolean {
	return left.session === right.session
		&& left.chat === right.chat
		&& left.turn === right.turn
		&& left.responsePartIndex === right.responsePartIndex;
}

class TestChatModelReference extends Disposable implements IChatModelReference {
	readonly object: IChatModel;

	constructor(
		resource: URI,
		getPresentation: () => IChatHostPresentation,
	) {
		super();
		this.object = {
			resource,
			onDidChange: Event.None,
			getSnapshot: () => ({
				hostState: undefined,
				hostPresentations: Object.freeze([getPresentation()]),
				input: '',
				composerRevision: 0,
				pendingAttachments: Object.freeze([]),
				interactionTargets: Object.freeze([]),
				preparingSubmission: undefined,
				errorMessage: undefined,
			}),
			getHostPresentation: identity => {
				const presentation = getPresentation();
				return samePresentationIdentity(identity, presentation) ? presentation : undefined;
			},
		};
	}
}

class TestPatchChatService {
	private currentPresentation: IChatHostPresentation;
	readonly updates: IChatHostPresentationUpdate[] = [];
	onAcquire: (() => void) | undefined;
	onUpdate: (() => void) | undefined;

	constructor(
		private readonly resource: URI,
		presentation: IChatHostPresentation,
	) {
		this.currentPresentation = presentation;
	}

	acquireModel(resource: URI): IChatModelReference {
		assert.equal(getComparisonKey(resource), getComparisonKey(this.resource));
		this.onAcquire?.();
		return new TestChatModelReference(resource, () => this.currentPresentation);
	}

	updateHostPresentation(resource: URI, update: IChatHostPresentationUpdate): void {
		assert.equal(getComparisonKey(resource), getComparisonKey(this.resource));
		assert.equal(samePresentationIdentity(update.identity, this.currentPresentation), true);
		assert.equal(update.type, this.currentPresentation.type);
		assert.equal(
			encodeAgentHostProtocolValue(update.expectedValue),
			encodeAgentHostProtocolValue(this.currentPresentation.value),
		);
		this.updates.push(update);
		this.currentPresentation = Object.freeze({
			...this.currentPresentation,
			value: update.value,
		});
		this.onUpdate?.();
	}

	get presentation(): IChatHostPresentation {
		return this.currentPresentation;
	}

	replacePresentation(value: AgentHostProtocolValue): void {
		this.currentPresentation = Object.freeze({
			...this.currentPresentation,
			value,
		});
	}
}

function definition(
	definitions: readonly IDraftEditorToolDefinition[],
	tool: typeof DraftEditorProposeEditorPatchToolId,
): IDraftEditorToolDefinition {
	const value = definitions.find(candidate => candidate.registration.descriptor.id === tool);
	assert(value);
	return value;
}

function createCall(
	tool: IDraftEditorToolDefinition,
	id: string,
	input: AgentHostProtocolValue,
	target: Awaited<ReturnType<typeof createDraftEditorInteractionTarget>>,
): IAgentToolCall {
	return {
		id: createAgentToolCallId(id),
		agent: createAgentId('test.agent'),
		registration: createAgentRuntimeRegistrationRevision('runtime-1'),
		session: createAgentSessionId('session-1'),
		chat: createAgentChatId('chat-1'),
		turn: createAgentTurnId(`turn-${id}`),
		toolSet: createAgentToolSetRevision('tool-set-1'),
		tool: tool.registration.descriptor.id,
		descriptor: tool.registration.descriptor.revision,
		registrationId: tool.registration.id,
		registrationRevision: tool.registration.revision,
		input,
		target: target.id,
		effect: { kind: 'read' },
		deadline: 1,
	};
}

async function execute(
	endpoint: DraftEditorAgentToolEndpoint,
	call: IAgentToolCall,
	target: Awaited<ReturnType<typeof createDraftEditorInteractionTarget>> | undefined,
) {
	return endpoint.execute(call, target, () => {}, CancellationTokenNone);
}

type DraftEditorTestTarget = Awaited<ReturnType<typeof createDraftEditorInteractionTarget>>;

function createPatchInput(
	blockId: string,
	expectedText: string,
	text: string,
): AgentHostProtocolValue {
	return {
		label: 'Replace paragraph',
		summary: null,
		operations: [{
			kind: 'text-edit',
			edit: {
				blockId,
				expectedText,
				kind: 'replaceBlock',
				text,
			},
		}],
	};
}

function createAcceptedProposal(input: AgentHostProtocolValue): AgentHostProtocolValue {
	return {
		patch: input,
		accepted: true,
		operationsValidated: 1,
		failedOperationIndex: null,
		requiresCustomExecutor: false,
		validationError: null,
	};
}

function createProjectionContext(
	target: DraftEditorTestTarget,
	input: AgentHostProtocolValue,
	proposal: AgentHostProtocolValue = createAcceptedProposal(input),
): IChatHostPresentationProjectionContext {
	const session = createAgentSessionId('session-1');
	const chat = createAgentChatId('chat-1');
	const turnId = createAgentTurnId('turn-presentation');
	const callId = createAgentToolCallId('call-presentation');
	const call = Object.freeze({
		kind: 'toolCall' as const,
		call: callId,
		tool: DraftEditorProposeEditorPatchToolId,
		input,
	});
	const output = Object.freeze({ target, proposal });
	assertAgentHostProtocolValue(output);
	const result = Object.freeze({
		kind: 'toolResult' as const,
		call: callId,
		status: 'completed' as const,
		output,
	});
	return Object.freeze({
		session,
		chat,
		turn: Object.freeze({
			id: turnId,
			submission: createAgentSubmissionId('submission-presentation'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`),
			state: 'completed' as const,
			user: Object.freeze({
				text: 'Update the Draft',
				attachments: Object.freeze([]),
				interactionTargets: Object.freeze([target]),
			}),
			response: Object.freeze([call, result]),
		}),
		responsePartIndex: 1,
		call,
		result,
	});
}

function createHostPresentation(
	context: IChatHostPresentationProjectionContext,
	value: AgentHostProtocolValue,
): IChatHostPresentation {
	return Object.freeze({
		schemaVersion: ChatHostPresentationSchemaVersion,
		session: context.session,
		chat: context.chat,
		turn: context.turn.id,
		responsePartIndex: context.responsePartIndex,
		type: DraftEditorPatchPresentationType,
		value,
	});
}

function createRenderContext(
	chatResource: URI,
	presentation: IChatHostPresentation,
	disposables: DisposableStore,
): IChatBrowserPresentationRenderContext {
	return {
		chatResource,
		presentation: {
			type: presentation.type,
			value: presentation.value,
			origin: {
				kind: 'host',
				identity: presentation,
			},
		},
		ui: locales.en,
		disposables,
	};
}

test('Draft Editor publishes only canonical target-backed Tool registrations', () => {
	const definitions = createDraftEditorAgentToolDefinitions(connection);
	assert.deepEqual(definitions.map(item => ({
		id: item.registration.descriptor.id,
		functionName: item.registration.descriptor.functionName,
		safety: item.registration.descriptor.safety,
		confirmation: item.registration.descriptor.confirmation,
		targetTypes: item.registration.descriptor.targetTypes,
	})), [
		{
			id: DraftEditorGetSelectionContextToolId,
			functionName: 'get_selection_context',
			safety: 'read',
			confirmation: 'never',
			targetTypes: [DraftEditorInteractionTargetType],
		},
		{
			id: DraftEditorListTextUnitsToolId,
			functionName: 'list_text_units',
			safety: 'read',
			confirmation: 'never',
			targetTypes: [DraftEditorInteractionTargetType],
		},
		{
			id: DraftEditorProposeEditorPatchToolId,
			functionName: 'propose_editor_patch',
			safety: 'read',
			confirmation: 'never',
			targetTypes: [DraftEditorInteractionTargetType],
		},
	]);
	assert.equal(definitions.every(item =>
		String(item.registration.descriptor.contributor) === String(DraftEditorInteractionTargetOwner),
	), true);
});

test('Draft Editor read Tools resolve only the exact target version and selection', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/read-target');
	const snapshot = service.add(resource, 'alpha beta\ngamma');
	const unit = collectWritingEditorTextUnits(snapshot.document)[0]!;
	service.setSelection(resource, { blockId: unit.blockId, startOffset: 0, endOffset: 5 });
	const target = await createDraftEditorInteractionTarget(service.getTargetSnapshot(resource)!, connection);
	const definitions = createDraftEditorAgentToolDefinitions(connection);

	const selectionDefinition = definition(definitions, DraftEditorGetSelectionContextToolId);
	const selectionResult = await execute(
		new DraftEditorAgentToolEndpoint(selectionDefinition, connection, service),
		createCall(selectionDefinition, 'selection', {}, target),
		target,
	);
	assert.equal(selectionResult.status, 'completed', JSON.stringify(selectionResult));
	assert.deepEqual(selectionResult.status === 'completed'
		? (selectionResult.output as { selection: { selectedText: string } }).selection.selectedText
		: undefined, 'alpha');

	const listDefinition = definition(definitions, DraftEditorListTextUnitsToolId);
	const listResult = await execute(
		new DraftEditorAgentToolEndpoint(listDefinition, connection, service),
		createCall(listDefinition, 'list', { kinds: [], cursor: 0, limit: 1 }, target),
		target,
	);
	assert.equal(listResult.status, 'completed');
	assert.deepEqual(listResult.status === 'completed'
		? {
			unitCount: (listResult.output as { units: unknown[] }).units.length,
			total: (listResult.output as { total: number }).total,
		}
		: undefined, { unitCount: 1, total: 1 });

	const missingTargetResult = await execute(
		new DraftEditorAgentToolEndpoint(listDefinition, connection, service),
		createCall(listDefinition, 'missing-target', { kinds: [], cursor: 0, limit: 1 }, target),
		undefined,
	);
	assert.equal(missingTargetResult.status, 'failed');
	assert.equal(missingTargetResult.status === 'failed' ? missingTargetResult.failure.code : undefined, 'invalidInput');
});

test('Draft Editor Tool execution rejects stale targets without substituting another Draft', async () => {
	const service = new TestDraftEditorService();
	const targetResource = URI.parse('comet-draft:/stale-target');
	const otherResource = URI.parse('comet-draft:/other-active-target');
	const snapshot = service.add(targetResource, 'target before');
	service.add(otherResource, 'unrelated active document');
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	service.setDocument(targetResource, createWritingEditorDocumentFromPlainText('target changed'));
	const listDefinition = definition(
		createDraftEditorAgentToolDefinitions(connection),
		DraftEditorListTextUnitsToolId,
	);
	const result = await execute(
		new DraftEditorAgentToolEndpoint(listDefinition, connection, service),
		createCall(listDefinition, 'stale', { kinds: [], cursor: 0, limit: 10 }, target),
		target,
	);
	assert.equal(result.status, 'failed', JSON.stringify(result));
	assert.equal(result.status === 'failed' ? result.failure.code : undefined, 'unavailable');
	assert.equal(writingEditorDocumentToPlainText(service.getDocument(otherResource)!), 'unrelated active document');
});

test('Draft Editor Tool execution rejects a document changed while target hashing is pending', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/target-race');
	const snapshot = service.add(resource, 'captured document');
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	service.replaceDocumentAfterNextSnapshot(resource, 'newer document');
	const listDefinition = definition(
		createDraftEditorAgentToolDefinitions(connection),
		DraftEditorListTextUnitsToolId,
	);
	const result = await execute(
		new DraftEditorAgentToolEndpoint(listDefinition, connection, service),
		createCall(listDefinition, 'target-race', { kinds: [], cursor: 0, limit: 10 }, target),
		target,
	);
	assert.equal(result.status, 'failed', JSON.stringify(result));
	assert.equal(result.status === 'failed' ? result.failure.code : undefined, 'unavailable');
	assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'newer document');
});

test('propose_editor_patch validates a review proposal without mutating the Draft', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/patch-target');
	const snapshot = service.add(resource, 'before patch');
	const blockId = collectWritingEditorTextUnits(snapshot.document)[0]!.blockId;
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	const proposalDefinition = definition(
		createDraftEditorAgentToolDefinitions(connection),
		DraftEditorProposeEditorPatchToolId,
	);
	const input = {
		label: 'Replace paragraph',
		summary: null,
		operations: [{
			kind: 'text-edit',
			edit: {
				blockId,
				expectedText: 'before patch',
				kind: 'replaceBlock',
				text: 'after patch',
			},
		}],
	} satisfies AgentHostProtocolValue;
	const call = createCall(proposalDefinition, 'patch-proposal', input, target);
	const endpoint = new DraftEditorAgentToolEndpoint(proposalDefinition, connection, service);
	const result = await execute(endpoint, call, target);
	assert.equal(result.status, 'completed', JSON.stringify(result));
	assert.deepEqual(result.status === 'completed'
		? (result.output as { proposal: { accepted: boolean; operationsValidated: number } }).proposal
		: undefined, {
		patch: input,
		accepted: true,
		operationsValidated: 1,
		failedOperationIndex: null,
		requiresCustomExecutor: false,
		validationError: null,
	});
	assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'before patch');
	assert.equal(service.writes.length, 0);
	assert.deepEqual(await endpoint.reconcile(call), { kind: 'terminal', result });

	const reversedRangeResult = await execute(
		endpoint,
		createCall(proposalDefinition, 'reversed-range', {
			label: 'Invalid range',
			summary: null,
			operations: [{
				kind: 'text-edit',
				edit: {
					blockId,
					expectedText: 'before patch',
					kind: 'replaceRange',
					from: 5,
					to: 2,
					text: 'invalid',
				},
			}],
		}, target),
		target,
	);
	assert.equal(reversedRangeResult.status, 'failed');
	assert.equal(
		reversedRangeResult.status === 'failed' ? reversedRangeResult.failure.code : undefined,
		'invalidInput',
	);
	assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'before patch');
	assert.equal(service.writes.length, 0);
});

test('Draft patch provider preserves exact Tool input, accepted target, and persistent apply state', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/provider-target');
	const snapshot = service.add(resource, 'provider before');
	const blockId = collectWritingEditorTextUnits(snapshot.document)[0]!.blockId;
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	const input = createPatchInput(blockId, 'provider before', 'provider after');
	const context = createProjectionContext(target, input);
	const provider = new DraftEditorPatchPresentationProvider(connection);

	const projected = provider.project(context, undefined);
	assert.equal(projected.type, DraftEditorPatchPresentationType);
	assert.deepEqual(parseDraftEditorPatchPresentationValue(projected.value).applyState, {
		kind: 'pending',
	});

	const proposal = parseDraftEditorPatchProposal(createAcceptedProposal(input));
	const appliedValue = createDraftEditorPatchPresentationValue(
		target,
		proposal,
		Object.freeze({ kind: 'applied' }),
	);
	const restored = provider.project(context, appliedValue);
	assert.deepEqual(parseDraftEditorPatchPresentationValue(restored.value).applyState, {
		kind: 'applied',
	});

	assert.throws(() => provider.project(Object.freeze({
		...context,
		call: Object.freeze({
			...context.call,
			input: createPatchInput(blockId, 'provider before', 'tampered input'),
		}),
	}), undefined), /does not preserve its exact input/u);
	const parsedProjected = parseDraftEditorPatchPresentationValue(projected.value);
	assert.throws(() => parseDraftEditorPatchPresentationValue({
		schemaVersion: parsedProjected.schemaVersion,
		target: parsedProjected.target,
		proposal: parsedProjected.proposal,
		applyState: parsedProjected.applyState,
		unexpected: true,
	}), /unsupported or missing properties/u);
});

test('Draft patch renderer applies the exact target only after click and persists CAS state', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/renderer-target');
	const snapshot = service.add(resource, 'renderer before');
	const blockId = collectWritingEditorTextUnits(snapshot.document)[0]!.blockId;
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	const input = createPatchInput(blockId, 'renderer before', 'renderer after');
	const projectionContext = createProjectionContext(target, input);
	const projected = new DraftEditorPatchPresentationProvider(connection).project(
		projectionContext,
		undefined,
	);
	const chatResource = URI.parse('comet-agent-host-chat:/renderer-chat');
	const presentation = createHostPresentation(projectionContext, projected.value);
	const chatService = new TestPatchChatService(chatResource, presentation);
	const renderer = new DraftEditorPatchPresentationRenderer(
		connection,
		service,
		chatService,
	);
	const disposables = new DisposableStore();
	try {
		const element = renderer.render(createRenderContext(chatResource, presentation, disposables));
		assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'renderer before');
		assert.equal(service.writes.length, 0);
		assert.equal(
			element.querySelector('.comet-draft-editor-patch-label')?.textContent,
			'Replace paragraph',
		);
		const button = element.querySelector<HTMLButtonElement>('.comet-draft-editor-patch-button');
		assert(button);
		assert.equal(button.textContent, locales.en.assistantSidebarPatchApply);
		const zhElement = renderer.render({
			...createRenderContext(chatResource, presentation, disposables),
			ui: locales.zh,
		});
		assert.equal(
			zhElement.querySelector('.comet-draft-editor-patch-button')?.textContent,
			locales.zh.assistantSidebarPatchApply,
		);
		const updated = new Promise<void>(resolve => {
			chatService.onUpdate = resolve;
		});
		button.click();
		await updated;

		assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'renderer after');
		assert.equal(service.writes.length, 1);
		assert.equal(chatService.updates.length, 1);
		assert.equal(chatService.updates[0]?.expectedValue, presentation.value);
		assert.deepEqual(
			parseDraftEditorPatchPresentationValue(chatService.presentation.value).applyState,
			{ kind: 'applied' },
		);
	} finally {
		disposables.dispose();
	}
});

test('Draft patch renderer does not write when persistent CAS state changed before apply', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/renderer-cas-race');
	const snapshot = service.add(resource, 'CAS before');
	const blockId = collectWritingEditorTextUnits(snapshot.document)[0]!.blockId;
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	const input = createPatchInput(blockId, 'CAS before', 'CAS after');
	const projectionContext = createProjectionContext(target, input);
	const projected = new DraftEditorPatchPresentationProvider(connection).project(
		projectionContext,
		undefined,
	);
	const chatResource = URI.parse('comet-agent-host-chat:/renderer-cas-race');
	const presentation = createHostPresentation(projectionContext, projected.value);
	const chatService = new TestPatchChatService(chatResource, presentation);
	const pending = parseDraftEditorPatchPresentationValue(projected.value);
	chatService.replacePresentation(createDraftEditorPatchPresentationValue(
		pending.target,
		pending.proposal,
		Object.freeze({ kind: 'applied' }),
	));
	const renderer = new DraftEditorPatchPresentationRenderer(
		connection,
		service,
		chatService,
	);
	const disposables = new DisposableStore();
	try {
		const element = renderer.render(createRenderContext(chatResource, presentation, disposables));
		const button = element.querySelector<HTMLButtonElement>('.comet-draft-editor-patch-button');
		assert(button);
		const acquired = new Promise<void>(resolve => {
			chatService.onAcquire = resolve;
		});
		button.click();
		await acquired;

		assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'CAS before');
		assert.equal(service.writes.length, 0);
		assert.equal(chatService.updates.length, 0);
		assert.deepEqual(
			parseDraftEditorPatchPresentationValue(chatService.presentation.value).applyState,
			{ kind: 'applied' },
		);
	} finally {
		disposables.dispose();
	}
});

test('Draft patch renderer persists unavailable without writing when target changes during hashing', async () => {
	const service = new TestDraftEditorService();
	const resource = URI.parse('comet-draft:/renderer-target-race');
	const snapshot = service.add(resource, 'renderer captured');
	const blockId = collectWritingEditorTextUnits(snapshot.document)[0]!.blockId;
	const target = await createDraftEditorInteractionTarget(snapshot, connection);
	const input = createPatchInput(blockId, 'renderer captured', 'renderer proposed');
	const projectionContext = createProjectionContext(target, input);
	const projected = new DraftEditorPatchPresentationProvider(connection).project(
		projectionContext,
		undefined,
	);
	const chatResource = URI.parse('comet-agent-host-chat:/renderer-target-race');
	const presentation = createHostPresentation(projectionContext, projected.value);
	const chatService = new TestPatchChatService(chatResource, presentation);
	const renderer = new DraftEditorPatchPresentationRenderer(
		connection,
		service,
		chatService,
	);
	const disposables = new DisposableStore();
	try {
		const element = renderer.render(createRenderContext(chatResource, presentation, disposables));
		const button = element.querySelector<HTMLButtonElement>('.comet-draft-editor-patch-button');
		assert(button);
		service.replaceDocumentAfterNextSnapshot(resource, 'renderer newer');
		const updated = new Promise<void>(resolve => {
			chatService.onUpdate = resolve;
		});
		button.click();
		await updated;

		assert.equal(writingEditorDocumentToPlainText(service.getDocument(resource)!), 'renderer newer');
		assert.equal(service.writes.length, 0);
		assert.equal(chatService.updates.length, 1);
		assert.deepEqual(
			parseDraftEditorPatchPresentationValue(chatService.presentation.value).applyState,
			{
				kind: 'applyFailed',
				code: 'unavailable',
				message: 'The Draft document changed while its target was resolved.',
			},
		);
	} finally {
		disposables.dispose();
	}
});
