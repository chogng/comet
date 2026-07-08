/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { LinkedList } from 'cs/base/common/linkedList';
import { type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { parse } from 'cs/base/common/marshalling';
import { matchesScheme, matchesSomeScheme, Schemas } from 'cs/base/common/network';
import { URI } from 'cs/base/common/uri';
import { type CommandService, commandService } from 'cs/platform/commands/common/commands';
import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
	type IExternalOpener,
	type IExternalUriResolver,
	type IOpener,
	IOpenerService,
	type IResolvedExternalUri,
	type IValidator,
	type OpenOptions,
	type ResolveExternalUriOptions,
} from 'cs/platform/opener/common/opener';

class CommandOpener implements IOpener {
	constructor(private readonly commandService: CommandService) {}

	async open(target: URI | string, options?: OpenOptions): Promise<boolean> {
		if (!matchesScheme(target, Schemas.command)) {
			return false;
		}

		if (!options?.allowCommands) {
			return true;
		}

		const commandUri = typeof target === 'string' ? URI.parse(target) : target;
		if (Array.isArray(options.allowCommands) && !options.allowCommands.includes(commandUri.path)) {
			return true;
		}

		const args = parseCommandArguments(commandUri.query);
		await Promise.resolve(this.commandService.executeCommand(commandUri.path, ...args));
		return true;
	}
}

function parseCommandArguments(query: string): unknown[] {
	if (!query) {
		return [];
	}

	const parsed: unknown = parse(decodeURIComponent(query));
	return Array.isArray(parsed) ? parsed : [parsed];
}

function externalUriKey(uri: URI): string {
	return uri.with({ fragment: '', query: '' }).toString();
}

export class OpenerService implements IOpenerService {
	declare readonly _serviceBrand: undefined;

	private readonly openers = new LinkedList<IOpener>();
	private readonly validators = new LinkedList<IValidator>();
	private readonly resolvers = new LinkedList<IExternalUriResolver>();
	private readonly externalOpeners = new LinkedList<IExternalOpener>();
	private readonly resolvedUriTargets = new Map<string, URI>();
	private defaultExternalOpener: IExternalOpener | undefined;

	constructor(commandService: CommandService) {
		this.openers.push({
			open: async (target, options) => {
				if (options?.openExternal || matchesSomeScheme(target, Schemas.mailto, Schemas.http, Schemas.https)) {
					return this.openExternal(target, options);
				}
				return false;
			},
		});
		this.openers.push(new CommandOpener(commandService));
	}

	registerOpener(opener: IOpener): IDisposable {
		return toDisposable(this.openers.unshift(opener));
	}

	registerValidator(validator: IValidator): IDisposable {
		return toDisposable(this.validators.push(validator));
	}

	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable {
		return toDisposable(this.resolvers.push(resolver));
	}

	setDefaultExternalOpener(opener: IExternalOpener): void {
		this.defaultExternalOpener = opener;
	}

	registerExternalOpener(opener: IExternalOpener): IDisposable {
		return toDisposable(this.externalOpeners.push(opener));
	}

	async open(target: URI | string, options?: OpenOptions): Promise<boolean> {
		const targetUri = typeof target === 'string' ? URI.parse(target) : target;
		if (targetUri.scheme === Schemas.internal) {
			return false;
		}

		if (!options?.skipValidation) {
			const validationTarget = this.resolvedUriTargets.get(externalUriKey(targetUri)) ?? target;
			for (const validator of this.validators) {
				if (!(await validator.shouldOpen(validationTarget, options))) {
					return false;
				}
			}
		}

		for (const opener of this.openers) {
			if (await opener.open(target, options)) {
				return true;
			}
		}

		return false;
	}

	async resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri> {
		for (const resolver of this.resolvers) {
			const result = await resolver.resolveExternalUri(resource, options);
			if (result) {
				this.resolvedUriTargets.set(externalUriKey(result.resolved), resource);
				return result;
			}
		}

		throw new Error(`Could not resolve external URI: ${resource.toString()}`);
	}

	dispose(): void {
		this.validators.clear();
		this.openers.clear();
		this.resolvers.clear();
		this.externalOpeners.clear();
		this.resolvedUriTargets.clear();
		this.defaultExternalOpener?.dispose?.();
		this.defaultExternalOpener = undefined;
	}

	private async openExternal(resource: URI | string, options: OpenOptions | undefined): Promise<boolean> {
		const uri = typeof resource === 'string' ? URI.parse(resource) : resource;
		const externalUri = await this.resolveExternalResource(uri, options);
		const href = typeof resource === 'string' && uri.toString() === externalUri.toString()
			? resource
			: encodeURI(externalUri.toString(true));

		if (options?.allowContributedOpeners) {
			const preferredOpenerId = typeof options.allowContributedOpeners === 'string'
				? options.allowContributedOpeners
				: undefined;
			for (const opener of this.externalOpeners) {
				if (await opener.openExternal(href, { sourceUri: uri, preferredOpenerId }, CancellationTokenNone)) {
					return true;
				}
			}
		}

		if (!this.defaultExternalOpener) {
			return false;
		}

		return this.defaultExternalOpener.openExternal(href, { sourceUri: uri }, CancellationTokenNone);
	}

	private async resolveExternalResource(resource: URI, options: OpenOptions | undefined): Promise<URI> {
		if (this.resolvers.isEmpty()) {
			return resource;
		}

		return (await this.resolveExternalUri(resource, options)).resolved;
	}
}

registerSingleton(
	IOpenerService,
	new SyncDescriptor(OpenerService, [commandService], true),
);
