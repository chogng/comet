import { EventEmitter } from 'cs/base/common/event';
import type {
	LibraryDocumentSummary,
	LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { INativeHostService } from 'cs/platform/native/common/native';

export type LibraryModelSnapshot = {
	librarySnapshot: LibraryDocumentsResult;
	isLibraryLoading: boolean;
};

export const EMPTY_LIBRARY_DOCUMENTS_RESULT: LibraryDocumentsResult = {
	items: [],
	totalCount: 0,
	fileCount: 0,
	queuedJobCount: 0,
	libraryDbFile: '',
	defaultManagedDirectory: '',
	ragCacheDir: '',
};

const DEFAULT_LIBRARY_MODEL_SNAPSHOT: LibraryModelSnapshot = {
	librarySnapshot: EMPTY_LIBRARY_DOCUMENTS_RESULT,
	isLibraryLoading: false,
};

export class LibraryModel {
	declare readonly _serviceBrand: undefined;

	private snapshot: LibraryModelSnapshot = DEFAULT_LIBRARY_MODEL_SNAPSHOT;
	private readonly onDidChangeEmitter = new EventEmitter<void>();
	private refreshSequence = 0;
	private disposed = false;
	// Holds real document summaries returned by metadata upsert until the next
	// library refresh brings the same rows back from storage.
	private readonly upsertedDocuments = new Map<string, LibraryDocumentSummary>();

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		void this.refresh();
	}

	readonly subscribe = (listener: () => void) => {
		return this.onDidChangeEmitter.event(listener);
	};

	readonly getSnapshot = () => this.snapshot;

	readonly refresh = async () => {
		const sequence = ++this.refreshSequence;

		if (!this.nativeHostService.canInvoke()) {
			this.setSnapshot({
				librarySnapshot: EMPTY_LIBRARY_DOCUMENTS_RESULT,
				isLibraryLoading: false,
			});
			return;
		}

		this.setSnapshot({
			librarySnapshot: this.snapshot.librarySnapshot,
			isLibraryLoading: true,
		});

		try {
			const nextSnapshot = await this.nativeHostService.invoke<LibraryDocumentsResult>(
				'list_library_documents',
				{
					limit: 8,
				},
			);

			if (!this.shouldApplySnapshot(sequence)) {
				return;
			}

			this.setSnapshot({
				librarySnapshot: this.mergeLibrarySnapshot(nextSnapshot, true),
				isLibraryLoading: false,
			});
		} catch (error) {
			if (!this.shouldApplySnapshot(sequence)) {
				return;
			}

			console.error('Failed to load library overview.', error);
			this.setSnapshot({
				librarySnapshot: this.snapshot.librarySnapshot,
				isLibraryLoading: false,
			});
		}
	};

	readonly upsertDocumentSummary = (document: LibraryDocumentSummary) => {
		this.upsertedDocuments.set(document.documentId, document);
		this.publishMergedSnapshot();
	};

	readonly removeDocumentSummary = (documentId: string) => {
		this.upsertedDocuments.delete(documentId);
		this.setSnapshot({
			librarySnapshot: {
				...this.snapshot.librarySnapshot,
				items: this.snapshot.librarySnapshot.items.filter(
					(item) => item.documentId !== documentId,
				),
				totalCount: Math.max(
					0,
					this.snapshot.librarySnapshot.totalCount - 1,
				),
			},
			isLibraryLoading: this.snapshot.isLibraryLoading,
		});
	};

	readonly dispose = () => {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.onDidChangeEmitter.dispose();
	};

	private emitChange() {
		this.onDidChangeEmitter.fire();
	}

	private shouldApplySnapshot(sequence: number) {
		return !this.disposed && sequence === this.refreshSequence;
	}

	private publishMergedSnapshot() {
		this.setSnapshot({
			librarySnapshot: this.mergeLibrarySnapshot(this.snapshot.librarySnapshot),
			isLibraryLoading: this.snapshot.isLibraryLoading,
		});
	}

	private mergeLibrarySnapshot(
		baseSnapshot: LibraryDocumentsResult,
		pruneMatchedUpsertedDocuments: boolean = false,
	) {
		if (this.upsertedDocuments.size === 0) {
			return baseSnapshot;
		}

		const mergedItems = [...baseSnapshot.items];
		for (const upsertedDocument of this.upsertedDocuments.values()) {
			const index = mergedItems.findIndex(
				(item) => item.documentId === upsertedDocument.documentId,
			);
			if (index >= 0) {
				mergedItems[index] = upsertedDocument;
			} else {
				mergedItems.unshift(upsertedDocument);
			}
		}

		if (pruneMatchedUpsertedDocuments) {
			for (const item of baseSnapshot.items) {
				this.upsertedDocuments.delete(item.documentId);
			}
		}

		const uniqueItems = mergedItems.filter(
			(item, index, items) =>
				items.findIndex((candidate) => candidate.documentId === item.documentId) ===
				index,
		);

		return {
			...baseSnapshot,
			items: uniqueItems.slice(0, 8),
			totalCount: Math.max(baseSnapshot.totalCount, uniqueItems.length),
			fileCount: uniqueItems.reduce((count, item) => count + item.fileCount, 0),
			queuedJobCount: uniqueItems.filter(
				(item) =>
					item.ingestStatus === 'queued' ||
					item.latestJobStatus === 'queued' ||
					item.latestJobStatus === 'running',
			).length,
		};
	}

	private setSnapshot(nextSnapshot: LibraryModelSnapshot) {
		if (
			this.snapshot.librarySnapshot === nextSnapshot.librarySnapshot &&
			this.snapshot.isLibraryLoading === nextSnapshot.isLibraryLoading
		) {
			return;
		}

		this.snapshot = nextSnapshot;
		this.emitChange();
	}
}

export const ILibraryModel = createDecorator<LibraryModel>('libraryModel');

registerSingleton(ILibraryModel, LibraryModel, InstantiationType.Delayed);
