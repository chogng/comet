/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

class Node<E> {
	static readonly Undefined = new Node<unknown>(undefined);

	element: E;
	next: Node<E> | typeof Node.Undefined;
	prev: Node<E> | typeof Node.Undefined;

	constructor(element: E) {
		this.element = element;
		this.next = Node.Undefined;
		this.prev = Node.Undefined;
	}
}

export class LinkedList<E> {
	private first: Node<E> | typeof Node.Undefined = Node.Undefined;
	private last: Node<E> | typeof Node.Undefined = Node.Undefined;
	private listSize = 0;

	get size(): number {
		return this.listSize;
	}

	isEmpty(): boolean {
		return this.first === Node.Undefined;
	}

	clear(): void {
		let node = this.first;
		while (node !== Node.Undefined) {
			const next = node.next;
			node.prev = Node.Undefined;
			node.next = Node.Undefined;
			node = next;
		}

		this.first = Node.Undefined;
		this.last = Node.Undefined;
		this.listSize = 0;
	}

	unshift(element: E): () => void {
		return this.insert(element, false);
	}

	push(element: E): () => void {
		return this.insert(element, true);
	}

	private insert(element: E, atTheEnd: boolean): () => void {
		const newNode = new Node(element);
		if (this.first === Node.Undefined) {
			this.first = newNode;
			this.last = newNode;
		} else if (atTheEnd) {
			const oldLast = this.last;
			this.last = newNode;
			newNode.prev = oldLast;
			oldLast.next = newNode;
		} else {
			const oldFirst = this.first;
			this.first = newNode;
			newNode.next = oldFirst;
			oldFirst.prev = newNode;
		}

		this.listSize += 1;
		let didRemove = false;
		return () => {
			if (!didRemove) {
				didRemove = true;
				this.remove(newNode);
			}
		};
	}

	shift(): E | undefined {
		if (this.first === Node.Undefined) {
			return undefined;
		}

		const result = this.first.element;
		this.remove(this.first);
		return result as E;
	}

	pop(): E | undefined {
		if (this.last === Node.Undefined) {
			return undefined;
		}

		const result = this.last.element;
		this.remove(this.last);
		return result as E;
	}

	peek(): E | undefined {
		if (this.last === Node.Undefined) {
			return undefined;
		}

		return this.last.element as E;
	}

	private remove(node: Node<E> | typeof Node.Undefined): void {
		if (node.prev !== Node.Undefined && node.next !== Node.Undefined) {
			const anchor = node.prev;
			anchor.next = node.next;
			node.next.prev = anchor;
		} else if (node.prev === Node.Undefined && node.next === Node.Undefined) {
			this.first = Node.Undefined;
			this.last = Node.Undefined;
		} else if (node.next === Node.Undefined) {
			this.last = this.last.prev!;
			this.last.next = Node.Undefined;
		} else if (node.prev === Node.Undefined) {
			this.first = this.first.next!;
			this.first.prev = Node.Undefined;
		}

		this.listSize -= 1;
	}

	*[Symbol.iterator](): Iterator<E> {
		let node = this.first;
		while (node !== Node.Undefined) {
			yield node.element as E;
			node = node.next;
		}
	}
}
