/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'cs/base/common/event';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import { isEqual } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import type { ThemeIcon } from 'cs/base/common/themables';
import {
	EditorInputCapabilities,
	EditorResourceAccessor,
	type IEditorOptions,
	type IUntypedEditorInput,
	Verbosity,
} from 'cs/workbench/common/editor';

export interface IEditorCloseHandler {
	confirmClose(): Promise<boolean>;
}

export abstract class EditorInput extends Disposable {
	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	protected readonly _onDidChangeLabel = this._register(new Emitter<void>());
	protected readonly _onDidChangeCapabilities = this._register(new Emitter<void>());
	private readonly _onWillDispose = this._register(new Emitter<void>());

	readonly onDidChangeDirty = this._onDidChangeDirty.event;
	readonly onDidChangeLabel = this._onDidChangeLabel.event;
	readonly onDidChangeCapabilities = this._onDidChangeCapabilities.event;
	readonly onWillDispose = this._onWillDispose.event;
	readonly closeHandler?: IEditorCloseHandler;

	abstract get typeId(): string;
	abstract get resource(): URI | undefined;

	get editorId(): string | undefined {
		return undefined;
	}

	get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	hasCapability(capability: EditorInputCapabilities): boolean {
		if (capability === EditorInputCapabilities.None) {
			return this.capabilities === EditorInputCapabilities.None;
		}

		return (this.capabilities & capability) !== 0;
	}

	getName(): string {
		return `Editor ${this.typeId}`;
	}

	getDescription(_verbosity?: Verbosity): string | undefined {
		return undefined;
	}

	getTitle(_verbosity = Verbosity.MEDIUM): string {
		return this.getName();
	}

	getIcon(): ThemeIcon | URI | undefined {
		return undefined;
	}

	prefersPrimaryInputFocus(): boolean {
		return false;
	}

	isDirty(): boolean {
		return false;
	}

	rename(_name: string): boolean {
		return false;
	}

	async save(): Promise<boolean> {
		return true;
	}

	async revert(): Promise<void> {}

	async resolve(): Promise<IDisposable | null> {
		return null;
	}

	copy(): EditorInput {
		return this;
	}

	canReopen(): boolean {
		return true;
	}

	matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (otherInput instanceof EditorInput) {
			return this === otherInput;
		}

		const otherOverride = otherInput.options?.override;
		if (
			this.editorId !== otherOverride &&
			otherOverride !== undefined &&
			this.editorId !== undefined
		) {
			return false;
		}

		return isEqual(this.resource, EditorResourceAccessor.getCanonicalUri(otherInput));
	}

	toUntyped(_options?: unknown): IUntypedEditorInput | undefined {
		return undefined;
	}

	isDisposed(): boolean {
		return this._store.isDisposed;
	}

	override dispose(): void {
		if (!this.isDisposed()) {
			this._onWillDispose.fire();
		}
		super.dispose();
	}
}

export type { IEditorOptions };
