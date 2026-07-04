/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from './charCode.js';
import { memoize } from './decorators.js';
import * as paths from './path.js';
import { extUri as defaultExtUri, IExtUri } from './resources.js';
import { URI } from './uri.js';

export interface IResourceNode<T, C = void> {
	readonly uri: URI;
	readonly relativePath: string;
	readonly name: string;
	readonly element: T | undefined;
	readonly children: Iterable<IResourceNode<T, C>>;
	readonly childrenCount: number;
	readonly parent: IResourceNode<T, C> | undefined;
	readonly context: C;
	get(childName: string): IResourceNode<T, C> | undefined;
}

class Node<T, C> implements IResourceNode<T, C> {

	private _children = new Map<string, Node<T, C>>();

	get childrenCount(): number {
		return this._children.size;
	}

	get children(): Iterable<Node<T, C>> {
		return this._children.values();
	}

	@memoize
	get name(): string {
		return paths.posix.basename(this.relativePath);
	}

	constructor(
		readonly uri: URI,
		readonly relativePath: string,
		readonly context: C,
		public element: T | undefined = undefined,
		readonly parent: IResourceNode<T, C> | undefined = undefined,
	) { }

	get(path: string): Node<T, C> | undefined {
		return this._children.get(path);
	}

	set(path: string, child: Node<T, C>): void {
		this._children.set(path, child);
	}

	delete(path: string): void {
		this._children.delete(path);
	}

	clear(): void {
		this._children.clear();
	}
}

class PathIterator {

	private _value = '';
	private _valueLen = 0;
	private _from = 0;
	private _to = 0;

	constructor(private readonly _splitOnBackslash = true) { }

	reset(key: string): this {
		this._from = 0;
		this._to = 0;
		this._value = key;
		this._valueLen = key.length;
		for (let pos = key.length - 1; pos >= 0; pos--, this._valueLen--) {
			const ch = this._value.charCodeAt(pos);
			if (!(ch === CharCode.Slash || this._splitOnBackslash && ch === CharCode.Backslash)) {
				break;
			}
		}

		return this.next();
	}

	hasNext(): boolean {
		return this._to < this._valueLen;
	}

	next(): this {
		this._from = this._to;
		let justSeps = true;
		for (; this._to < this._valueLen; this._to++) {
			const ch = this._value.charCodeAt(this._to);
			if (ch === CharCode.Slash || this._splitOnBackslash && ch === CharCode.Backslash) {
				if (justSeps) {
					this._from++;
				} else {
					break;
				}
			} else {
				justSeps = false;
			}
		}
		return this;
	}

	value(): string {
		return this._value.substring(this._from, this._to);
	}
}

function collect<T, C>(node: IResourceNode<T, C>, result: T[]): T[] {
	if (typeof node.element !== 'undefined') {
		result.push(node.element);
	}

	for (const child of node.children) {
		collect(child, result);
	}

	return result;
}

export class ResourceTree<T extends NonNullable<unknown>, C> {

	readonly root: Node<T, C>;

	static getRoot<T, C>(node: IResourceNode<T, C>): IResourceNode<T, C> {
		while (node.parent) {
			node = node.parent;
		}

		return node;
	}

	static collect<T, C>(node: IResourceNode<T, C>): T[] {
		return collect(node, []);
	}

	static isResourceNode<T, C>(obj: unknown): obj is IResourceNode<T, C> {
		return obj instanceof Node;
	}

	constructor(context: C, rootURI: URI = URI.file('/'), private extUri: IExtUri = defaultExtUri) {
		this.root = new Node(rootURI, '', context);
	}

	add(uri: URI, element: T): void {
		const key = this.extUri.relativePath(this.root.uri, uri) || uri.path;
		const iterator = new PathIterator().reset(key);
		let node = this.root;
		let path = '';

		while (true) {
			const name = iterator.value();
			path = path + '/' + name;

			let child = node.get(name);

			if (!child) {
				child = new Node(
					this.extUri.joinPath(this.root.uri, path),
					path,
					this.root.context,
					iterator.hasNext() ? undefined : element,
					node,
				);

				node.set(name, child);
			} else if (!iterator.hasNext()) {
				child.element = element;
			}

			node = child;

			if (!iterator.hasNext()) {
				return;
			}

			iterator.next();
		}
	}

	delete(uri: URI): T | undefined {
		const key = this.extUri.relativePath(this.root.uri, uri) || uri.path;
		const iterator = new PathIterator().reset(key);
		return this._delete(this.root, iterator);
	}

	private _delete(node: Node<T, C>, iterator: PathIterator): T | undefined {
		const name = iterator.value();
		const child = node.get(name);

		if (!child) {
			return undefined;
		}

		if (iterator.hasNext()) {
			const result = this._delete(child, iterator.next());

			if (typeof result !== 'undefined' && child.childrenCount === 0) {
				node.delete(name);
			}

			return result;
		}

		node.delete(name);
		return child.element;
	}

	clear(): void {
		this.root.clear();
	}

	getNode(uri: URI): IResourceNode<T, C> | undefined {
		const key = this.extUri.relativePath(this.root.uri, uri) || uri.path;
		const iterator = new PathIterator().reset(key);
		let node = this.root;

		while (true) {
			const name = iterator.value();
			const child = node.get(name);

			if (!child || !iterator.hasNext()) {
				return child;
			}

			node = child;
			iterator.next();
		}
	}
}
