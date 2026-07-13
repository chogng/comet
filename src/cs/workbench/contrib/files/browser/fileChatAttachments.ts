/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import {
	assertAgentHostContentReference,
	type IAgentHostAttachment,
	type IAgentHostContentReference,
} from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	type AgentAttachmentId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	IClientContentResourceService,
	type IClientContentPublication,
	type IClientContentTreeFile,
} from 'cs/platform/agentHost/browser/clientContentResources';
import { IChatComposerSourceService } from 'cs/workbench/contrib/chat/browser/composer/chatComposerSources';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type {
	IChatAttachmentProducer,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';

export const FileAttachmentProducerType = createAgentAttachmentProducerTypeId('files.file');
export const DirectoryAttachmentProducerType = createAgentAttachmentProducerTypeId('files.directory');

const FileRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.file.v1');
const DirectoryRepresentationSchema = createAgentAttachmentRepresentationSchemaId('comet.directory.v1');
const ClientFileAttachmentStateVersion = 1;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

interface IClientFileAttachmentState {
	readonly name: string;
	readonly mediaType: string | null;
	readonly content: IAgentHostContentReference;
}

interface IClientDirectoryAttachmentState {
	readonly name: string;
	readonly content: IAgentHostContentReference;
}

interface IOwnedPublication {
	readonly attachment: IPendingChatAttachment;
	readonly publication: IClientContentPublication;
}

function requireRecord(
	value: AgentHostProtocolValue,
	label: string,
): Readonly<Record<string, AgentHostProtocolValue>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a protocol record.`);
	}
	return value as Readonly<Record<string, AgentHostProtocolValue>>;
}

function requireExactKeys(
	value: Readonly<Record<string, AgentHostProtocolValue>>,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
		throw new TypeError(`${label} contains unsupported properties.`);
	}
}

function requireName(value: unknown, label: string): string {
	if (
		typeof value !== 'string'
		|| value.length === 0
		|| value.length > 512
		|| /[\\/\0]/.test(value)
	) {
		throw new TypeError(`${label} must be a bounded base name.`);
	}
	return value;
}

function requireMediaType(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== 'string' || value.length > 127 || !mediaTypePattern.test(value)) {
		throw new TypeError('File attachment media type must be null or an exact media type.');
	}
	return value;
}

function requireContent(
	value: AgentHostProtocolValue,
	shape: IAgentHostContentReference['shape'],
	contentService: IClientContentResourceService,
): IAgentHostContentReference {
	assertAgentHostContentReference(value);
	if (
		value.shape !== shape
		|| value.owner.kind !== 'client'
		|| value.owner.connection !== contentService.connection
	) {
		throw new Error(`Chat attachment content must be a ${shape} owned by this exact client connection.`);
	}
	return value;
}

function requireFileState(
	value: AgentHostProtocolValue,
	contentService: IClientContentResourceService,
): IClientFileAttachmentState {
	const state = requireRecord(value, 'File attachment state');
	requireExactKeys(state, ['name', 'mediaType', 'content'], 'File attachment state');
	return {
		name: requireName(state.name, 'File attachment name'),
		mediaType: requireMediaType(state.mediaType),
		content: requireContent(state.content, 'blob', contentService),
	};
}

function requireDirectoryState(
	value: AgentHostProtocolValue,
	contentService: IClientContentResourceService,
): IClientDirectoryAttachmentState {
	const state = requireRecord(value, 'Directory attachment state');
	requireExactKeys(state, ['name', 'content'], 'Directory attachment state');
	return {
		name: requireName(state.name, 'Directory attachment name'),
		content: requireContent(state.content, 'tree', contentService),
	};
}

function assertOwnedState(
	attachment: IPendingChatAttachment,
	owned: IOwnedPublication | undefined,
	content: IAgentHostContentReference,
): IOwnedPublication {
	if (
		owned === undefined
		|| encodeAgentHostProtocolValue(owned.attachment.state)
			!== encodeAgentHostProtocolValue(attachment.state)
		|| encodeAgentHostProtocolValue(owned.publication.content)
			!== encodeAgentHostProtocolValue(content)
	) {
		throw new Error(`Client content publication for Chat attachment '${attachment.id}' is unavailable.`);
	}
	return owned;
}

function normalizedMediaType(file: File): string | null {
	return file.type === '' ? null : requireMediaType(file.type);
}

function contentProtocolValue(content: IAgentHostContentReference): AgentHostProtocolValue {
	assertAgentHostProtocolValue(content);
	return content;
}

async function readFileBytes(file: File): Promise<Uint8Array> {
	return new Uint8Array(await file.arrayBuffer());
}

function pickFiles(directory: boolean): Promise<readonly File[]> {
	return new Promise((resolve, reject) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		if (directory) {
			input.setAttribute('webkitdirectory', '');
		}
		const finish = (files: readonly File[]) => {
			input.removeEventListener('change', onChange);
			input.removeEventListener('cancel', onCancel);
			resolve(files);
		};
		const onChange = () => finish(input.files ? [...input.files] : []);
		const onCancel = () => finish([]);
		input.addEventListener('change', onChange, { once: true });
		input.addEventListener('cancel', onCancel, { once: true });
		try {
			input.click();
		} catch (error) {
			input.removeEventListener('change', onChange);
			input.removeEventListener('cancel', onCancel);
			reject(error);
		}
	});
}

class ClientFileAttachmentProducer implements IChatAttachmentProducer {
	readonly type = FileAttachmentProducerType;
	readonly stateVersion = ClientFileAttachmentStateVersion;
	private readonly publications = new Map<AgentAttachmentId, IOwnedPublication>();

	constructor(private readonly contentService: IClientContentResourceService) {}

	validateState(state: AgentHostProtocolValue): void {
		requireFileState(state, this.contentService);
	}

	discard(attachment: IPendingChatAttachment): void {
		const state = requireFileState(attachment.state, this.contentService);
		const owned = assertOwnedState(attachment, this.publications.get(attachment.id), state.content);
		owned.publication.release();
		this.publications.delete(attachment.id);
	}

	async resolve({ attachment }: Parameters<IChatAttachmentProducer['resolve']>[0]) {
		const state = requireFileState(attachment.state, this.contentService);
		assertOwnedState(attachment, this.publications.get(attachment.id), state.content);
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: FileRepresentationSchema,
				mediaType: 'application/vnd.comet.file+json',
				value: { name: state.name, mediaType: state.mediaType },
			},
			content: state.content,
			metadata: [],
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	}

	async stage(file: File): Promise<IPendingChatAttachment> {
		const name = requireName(file.name, 'File name');
		const mediaType = normalizedMediaType(file);
		const publication = await this.contentService.publishBlob({
			mediaType,
			bytes: await readFileBytes(file),
		});
		const attachment: IPendingChatAttachment = {
			id: createAgentAttachmentId(generateUuid()),
			producerType: this.type,
			producerStateVersion: this.stateVersion,
			display: { label: name },
			state: { name, mediaType, content: contentProtocolValue(publication.content) },
		};
		this.publications.set(attachment.id, { attachment, publication });
		return attachment;
	}
}

class ClientDirectoryAttachmentProducer implements IChatAttachmentProducer {
	readonly type = DirectoryAttachmentProducerType;
	readonly stateVersion = ClientFileAttachmentStateVersion;
	private readonly publications = new Map<AgentAttachmentId, IOwnedPublication>();

	constructor(private readonly contentService: IClientContentResourceService) {}

	validateState(state: AgentHostProtocolValue): void {
		requireDirectoryState(state, this.contentService);
	}

	discard(attachment: IPendingChatAttachment): void {
		const state = requireDirectoryState(attachment.state, this.contentService);
		const owned = assertOwnedState(attachment, this.publications.get(attachment.id), state.content);
		owned.publication.release();
		this.publications.delete(attachment.id);
	}

	async resolve({ attachment }: Parameters<IChatAttachmentProducer['resolve']>[0]) {
		const state = requireDirectoryState(attachment.state, this.contentService);
		assertOwnedState(attachment, this.publications.get(attachment.id), state.content);
		const result: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: attachment.id,
			producerType: attachment.producerType,
			display: attachment.display,
			representation: {
				schema: DirectoryRepresentationSchema,
				mediaType: 'application/vnd.comet.directory+json',
				value: { name: state.name },
			},
			content: state.content,
			metadata: [],
		};
		return Object.freeze({ attachment: result, release: async () => {} });
	}

	async stage(files: readonly File[]): Promise<IPendingChatAttachment> {
		if (files.length === 0) {
			throw new Error('A Directory attachment requires explicit file entries.');
		}
		let root: string | undefined;
		const entries: IClientContentTreeFile[] = [];
		for (const file of files) {
			const relativePath = file.webkitRelativePath;
			const segments = relativePath.split('/');
			if (segments.length < 2 || segments.some(segment => segment.length === 0)) {
				throw new TypeError('A Directory attachment requires browser-enumerated relative file paths.');
			}
			const fileRoot = requireName(segments[0], 'Directory name');
			root ??= fileRoot;
			if (root !== fileRoot) {
				throw new Error('A Directory attachment cannot combine multiple selected roots.');
			}
			entries.push({
				path: segments.slice(1).join('/'),
				mediaType: normalizedMediaType(file),
				bytes: await readFileBytes(file),
			});
		}
		const publication = await this.contentService.publishTree(entries);
		const attachment: IPendingChatAttachment = {
			id: createAgentAttachmentId(generateUuid()),
			producerType: this.type,
			producerStateVersion: this.stateVersion,
			display: { label: root! },
			state: { name: root!, content: contentProtocolValue(publication.content) },
		};
		this.publications.set(attachment.id, { attachment, publication });
		return attachment;
	}
}

/** Registers immutable File and Directory publications over the common Chat attachment API. */
export class FileChatAttachmentsContribution extends Disposable {
	private readonly fileProducer: ClientFileAttachmentProducer;
	private readonly directoryProducer: ClientDirectoryAttachmentProducer;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IClientContentResourceService contentService: IClientContentResourceService,
		@IChatComposerSourceService composerSourceService: IChatComposerSourceService,
	) {
		super();
		this.fileProducer = new ClientFileAttachmentProducer(contentService);
		this.directoryProducer = new ClientDirectoryAttachmentProducer(contentService);
		this._register(chatService.registerAttachmentProducer(this.fileProducer));
		this._register(chatService.registerAttachmentProducer(this.directoryProducer));
		this._register(composerSourceService.registerSource({
			id: 'files.file',
			order: 200,
			icon: 'file',
			getLabel: ui => ui.chatInputAddFile,
			addToComposer: async chatResource => this.attachFiles(chatResource, await pickFiles(false)),
		}));
		this._register(composerSourceService.registerSource({
			id: 'files.directory',
			order: 210,
			icon: 'folder',
			getLabel: ui => ui.chatInputAddDirectory,
			addToComposer: async chatResource => this.attachDirectory(chatResource, await pickFiles(true)),
		}));
	}

	async attachFiles(chatResource: URI, files: readonly File[]): Promise<void> {
		if (files.length === 0) {
			return;
		}
		const staged: IPendingChatAttachment[] = [];
		try {
			for (const file of files) {
				staged.push(await this.fileProducer.stage(file));
			}
			this.chatService.addPendingAttachments(chatResource, staged);
		} catch (error) {
			const cleanup = staged.map(attachment => {
				try {
					this.fileProducer.discard(attachment);
					return undefined;
				} catch (discardError) {
					return discardError;
				}
			}).filter(discardError => discardError !== undefined);
			throw cleanup.length === 0
				? error
				: new AggregateError([error, ...cleanup], 'Failed to stage File attachments.');
		}
	}

	async attachDirectory(chatResource: URI, files: readonly File[]): Promise<void> {
		if (files.length === 0) {
			return;
		}
		const attachment = await this.directoryProducer.stage(files);
		try {
			this.chatService.addPendingAttachments(chatResource, [attachment]);
		} catch (error) {
			try {
				this.directoryProducer.discard(attachment);
			} catch (discardError) {
				throw new AggregateError([error, discardError], 'Failed to stage a Directory attachment.');
			}
			throw error;
		}
	}
}
