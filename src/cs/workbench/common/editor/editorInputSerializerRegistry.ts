/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { IEditorSerializer } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export interface SerializedEditorInput {
	readonly typeId: string;
	readonly value: string;
}

export class EditorInputSerializerRegistry {
	private readonly serializers = new Map<string, IEditorSerializer>();

	register(typeId: string, serializer: IEditorSerializer): IDisposable {
		if (this.serializers.has(typeId)) {
			throw new Error(`Editor input serializer '${typeId}' is already registered.`);
		}
		this.serializers.set(typeId, serializer);
		return toDisposable(() => this.serializers.delete(typeId));
	}

	serialize(input: EditorInput): SerializedEditorInput {
		const serializer = this.serializers.get(input.typeId);
		if (!serializer || !serializer.canSerialize(input)) {
			throw new Error(`No serializer is registered for editor input '${input.typeId}'.`);
		}
		const value = serializer.serialize(input);
		if (value === undefined) {
			throw new Error(`Editor input '${input.typeId}' could not be serialized.`);
		}
		return { typeId: input.typeId, value };
	}

	deserialize(
		serialized: SerializedEditorInput,
		instantiationService: IInstantiationService,
	): EditorInput {
		const serializer = this.serializers.get(serialized.typeId);
		if (!serializer) {
			throw new Error(`No serializer is registered for editor input '${serialized.typeId}'.`);
		}
		const input = serializer.deserialize(instantiationService, serialized.value);
		if (!input) {
			throw new Error(`Editor input '${serialized.typeId}' could not be deserialized.`);
		}
		return input;
	}
}

export const editorInputSerializerRegistry = new EditorInputSerializerRegistry();
