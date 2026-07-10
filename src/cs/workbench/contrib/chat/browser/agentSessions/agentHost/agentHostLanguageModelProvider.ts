/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
	type IChatMessage,
	type ILanguageModelChatMetadataAndIdentifier,
	type ILanguageModelChatProvider,
	type ILanguageModelChatRequestOptions,
	type ILanguageModelChatResponse,
	type ILanguageModelConfigurationSchema,
} from 'cs/workbench/contrib/chat/common/languageModels';

export interface AgentHostSessionModelConfigurationProperty {
	readonly type?: string;
	readonly title?: string;
	readonly description?: string;
	readonly default?: unknown;
	readonly enum?: readonly (string | number | boolean | null)[];
}

export interface AgentHostSessionModelConfigurationSchema {
	readonly type?: string;
	readonly required?: readonly string[];
	readonly properties: Record<string, AgentHostSessionModelConfigurationProperty>;
}

export interface AgentHostSessionModelInfo {
	readonly id: string;
	readonly name: string;
	readonly maxPromptTokens?: number;
	readonly maxOutputTokens?: number;
	readonly supportsVision?: boolean;
	readonly policyState?: 'enabled' | 'disabled';
	readonly configSchema?: AgentHostSessionModelConfigurationSchema;
}

export class AgentHostLanguageModelProvider extends Disposable implements ILanguageModelChatProvider {
	private readonly onDidChangeEmitter = this._register(new EventEmitter<void>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	private models: readonly AgentHostSessionModelInfo[] = [];

	constructor(
		private readonly sessionType: string,
		private readonly vendor: string,
	) {
		super();
	}

	updateModels(models: readonly AgentHostSessionModelInfo[]): void {
		this.models = models;
		this.onDidChangeEmitter.fire();
	}

	async provideLanguageModelChatInfo(): Promise<readonly ILanguageModelChatMetadataAndIdentifier[]> {
		return this.models
			.filter(model => model.policyState !== 'disabled')
			.map(model => ({
				identifier: `${this.vendor}:${model.id}`,
				metadata: {
					name: model.name,
					id: model.id,
					vendor: this.vendor,
					version: '1.0',
					family: model.id,
					maxInputTokens: model.maxPromptTokens,
					maxOutputTokens: model.maxOutputTokens,
					isUserSelectable: true,
					targetChatSessionType: this.sessionType,
					capabilities: {
						vision: model.supportsVision === true,
						toolCalling: true,
						agentMode: true,
					},
					configurationSchema: this.toLanguageModelConfigurationSchema(model.configSchema),
				},
			}));
	}

	async sendChatRequest(_modelId: string, _messages: readonly IChatMessage[], _from: string | undefined, _options: ILanguageModelChatRequestOptions, _token: CancellationToken): Promise<ILanguageModelChatResponse> {
		throw new Error('Agent-host language models do not support direct chat requests.');
	}

	async provideTokenCount(): Promise<number> {
		return 0;
	}

	private toLanguageModelConfigurationSchema(schema: AgentHostSessionModelConfigurationSchema | undefined): ILanguageModelConfigurationSchema | undefined {
		if (!schema) {
			return undefined;
		}

		const properties: Record<string, ILanguageModelConfigurationSchema> = {};
		for (const [key, property] of Object.entries(schema.properties)) {
			properties[key] = {
				type: property.type,
				title: property.title,
				description: property.description,
				default: property.default,
				enum: property.enum,
			};
		}

		return {
			type: schema.type,
			required: schema.required,
			properties,
		};
	}
}
