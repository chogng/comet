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

export abstract class EditorInput extends Disposable {
	protected readonly _onDidChangeLabel = this._register(new Emitter<void>());
	private readonly _onWillDispose = this._register(new Emitter<void>());

	readonly onDidChangeLabel = this._onDidChangeLabel.event;
	readonly onWillDispose = this._onWillDispose.event;

	abstract get typeId(): string;
	abstract get resource(): URI | undefined;

	get editorId(): string | undefined {
		return undefined;
	}

	get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
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

	override dispose(): void {
		this._onWillDispose.fire();
		super.dispose();
	}
}

export type { IEditorOptions };
