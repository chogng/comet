import 'cs/base/browser/ui/tree/media/tree.css';

import { addDisposableListener } from 'cs/base/browser/dom';
import type {
	IListElementRenderDetails,
	IListRenderer,
	IListVirtualDelegate,
} from 'cs/base/browser/ui/list/list';
import {
	List,
	type IListAccessibilityProvider,
	type IListOptions,
} from 'cs/base/browser/ui/list/listWidget';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';

const rowHeight = 22;

export type SimpleTreeDataSource<T> = {
	hasChildren(node: T): boolean;
	getChildren(node: T): T[];
};

export type SimpleTreeRenderContext = {
	nodeId: string;
	depth: number;
	hasChildren: boolean;
	isExpanded: boolean;
	isSelected: boolean;
	isFocused: boolean;
	toggleExpanded: () => void;
	select: () => void;
	open: () => void;
};

export type SimpleTreeNodeState = {
	loading?: boolean;
	error?: boolean;
};

export type SimpleTreeRenderer<T> = {
	renderElement(node: T, context: SimpleTreeRenderContext): HTMLElement;
};

export type SimpleTreeOptions<T> = {
	getId: (node: T) => string;
	isRoot: (node: T) => boolean;
	hideRoot?: boolean;
	getLabel?: (node: T) => string;
	getNodeState?: (node: T) => SimpleTreeNodeState;
	defaultExpandedIds?: Iterable<string>;
	shouldAutoExpand?: (node: T) => boolean;
	ariaLabel?: string;
	onDidChangeSelection?: (node: T | null) => void;
	onDidOpen?: (node: T) => void;
};

type VisibleTreeNode<T> = {
	node: T;
	depth: number;
	hasChildren: boolean;
	isExpanded: boolean;
};

type TreeTemplateData = {
	container: HTMLElement;
	disposables: DisposableStore;
};

class SimpleTreeDelegate<T> implements IListVirtualDelegate<VisibleTreeNode<T>> {
	getHeight(): number {
		return rowHeight;
	}

	getTemplateId(): string {
		return 'simpleTreeNode';
	}
}

export class SimpleTree<T> extends Disposable {
	private readonly container = document.createElement('div');
	private readonly list: List<VisibleTreeNode<T>>;
	private input: T | null = null;
	private visibleNodes: VisibleTreeNode<T>[] = [];
	private selectedNode: T | null = null;
	private readonly expandedIds: Set<string>;
	private readonly autoExpandedIds = new Set<string>();
	private disposed = false;

	constructor(
		private readonly dataSource: SimpleTreeDataSource<T>,
		private readonly renderer: SimpleTreeRenderer<T>,
		private readonly options: SimpleTreeOptions<T>,
	) {
		super();
		this.expandedIds = new Set(options.defaultExpandedIds ?? []);
		this.container.className = 'comet-simple-tree';

		const listOptions: IListOptions<VisibleTreeNode<T>> = {
			keyboardSupport: true,
			multipleSelectionSupport: false,
			typeNavigationEnabled: true,
			mouseSupport: true,
			identityProvider: {
				getId: entry => this.options.getId(entry.node),
			},
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: entry =>
					this.options.getLabel?.(entry.node) ?? this.options.getId(entry.node),
			},
			accessibilityProvider: this.createAccessibilityProvider(options.ariaLabel ?? ''),
		};

		this.list = this._register(new List(
			'SimpleTree',
			this.container,
			new SimpleTreeDelegate<T>(),
			[this.createRenderer()],
			listOptions,
		));
		this.list.getHTMLElement().classList.add('comet-simple-tree');

		this._register(this.list.onDidChangeFocus(() => {
			this.syncRenderedNodeState();
		}));
		this._register(this.list.onDidChangeSelection(event => {
			const selectedNode = event.elements[0]?.node ?? null;
			if (selectedNode !== this.selectedNode) {
				this.selectedNode = selectedNode;
				this.options.onDidChangeSelection?.(selectedNode);
			}
			this.syncRenderedNodeState();
		}));
		this._register(addDisposableListener(this.list.getHTMLElement(), 'keydown', event => {
			this.handleKeyDown(event);
		}, true));
	}

	getElement() {
		return this.list.getHTMLElement();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.input = null;
		this.visibleNodes = [];
		this.selectedNode = null;
		super.dispose();
		this.list.getHTMLElement().replaceChildren();
		this.container.replaceChildren();
	}

	setAriaLabel(label: string) {
		if (this.disposed) {
			return;
		}

		this.list.ariaLabel = label;
	}

	focus() {
		if (this.disposed) {
			return;
		}

		this.list.domFocus();
	}

	getSelection() {
		const index = this.list.getSelection()[0];
		return typeof index === 'number' ? (this.visibleNodes[index]?.node ?? null) : null;
	}

	setSelection(node: T | null) {
		if (this.disposed) {
			return;
		}

		const index = node ? this.findVisibleNodeIndex(node) : -1;
		this.list.setSelection(index >= 0 ? [index] : []);
	}

	getFocus() {
		const index = this.list.getFocus()[0];
		return typeof index === 'number' ? (this.visibleNodes[index]?.node ?? null) : null;
	}

	setFocus(node: T | null) {
		if (this.disposed) {
			return;
		}

		const index = node ? this.findVisibleNodeIndex(node) : -1;
		this.list.setFocus(index >= 0 ? [index] : []);
	}

	setInput(input: T | null) {
		if (this.disposed) {
			return;
		}

		this.input = input;
		if (!input) {
			this.visibleNodes = [];
			this.list.setSelection([]);
			this.list.setFocus([]);
			this.list.splice(0, this.list.length);
			return;
		}

		this.render();
	}

	rerender() {
		if (this.disposed) {
			return;
		}

		this.render();
	}

	private createRenderer(): IListRenderer<VisibleTreeNode<T>, TreeTemplateData> {
		return {
			templateId: 'simpleTreeNode',
			renderTemplate: container => ({
				container,
				disposables: new DisposableStore(),
			}),
			renderElement: (entry, index, templateData, _details?: IListElementRenderDetails) => {
				templateData.disposables.clear();
				templateData.container.replaceChildren();

				const nodeId = this.options.getId(entry.node);
				const nodeState = this.options.getNodeState?.(entry.node) ?? {};
				const isSelected = this.list.getSelection().includes(index);
				const isFocused = this.list.getFocus().includes(index);
				const rendered = this.renderer.renderElement(entry.node, {
					nodeId,
					depth: entry.depth,
					hasChildren: entry.hasChildren,
					isExpanded: entry.isExpanded,
					isSelected,
					isFocused,
					toggleExpanded: () => {
						this.toggleExpanded(entry);
					},
					select: () => {
						this.list.setSelection([index]);
					},
					open: () => {
						this.options.onDidOpen?.(entry.node);
					},
				});

				rendered.dataset['simpleTreeNodeId'] = nodeId;
				rendered.dataset['simpleTreeIndex'] = String(index);
				rendered.classList.add('comet-simple-tree-node');
				rendered.classList.toggle('is-selected', isSelected);
				rendered.classList.toggle('is-focused', isFocused);
				rendered.setAttribute('aria-level', String(entry.depth + 1));
				rendered.setAttribute('aria-selected', String(isSelected));
				rendered.toggleAttribute('aria-busy', Boolean(nodeState.loading));
				rendered.dataset['treeState'] = nodeState.error
					? 'error'
					: nodeState.loading
						? 'loading'
						: 'idle';
				if (!rendered.getAttribute('role')) {
					rendered.setAttribute('role', 'treeitem');
				}
				if (entry.hasChildren) {
					rendered.setAttribute('aria-expanded', String(entry.isExpanded));
				} else {
					rendered.removeAttribute('aria-expanded');
				}
				rendered.classList.toggle('is-loading', Boolean(nodeState.loading));
				rendered.classList.toggle('has-error', Boolean(nodeState.error));
				templateData.container.append(rendered);
			},
			disposeElement: (_entry, _index, templateData) => {
				templateData.disposables.clear();
				templateData.container.replaceChildren();
			},
			disposeTemplate: templateData => {
				templateData.disposables.dispose();
			},
		};
	}

	private createAccessibilityProvider(ariaLabel: string): IListAccessibilityProvider<VisibleTreeNode<T>> {
		return {
			getWidgetAriaLabel: () => ariaLabel,
			getWidgetRole: () => 'tree',
			getAriaLabel: entry =>
				this.options.getLabel?.(entry.node) ?? this.options.getId(entry.node),
			getAriaLevel: entry => entry.depth + 1,
			getRole: () => 'treeitem',
		};
	}

	private render() {
		this.visibleNodes = this.getVisibleNodes();
		this.list.splice(0, this.list.length, this.visibleNodes);
		if (this.visibleNodes.length > 0 && this.list.getFocus().length === 0) {
			this.list.setFocus([0]);
		}
		this.list.layout(Math.max(1, this.visibleNodes.length) * rowHeight);
		this.syncRenderedNodeState();
	}

	private syncRenderedNodeState() {
		const focused = new Set(this.list.getFocus());
		const selected = new Set(this.list.getSelection());
		for (const node of this.list.getHTMLElement().querySelectorAll<HTMLElement>('[data-simple-tree-index]')) {
			const rawIndex = node.dataset['simpleTreeIndex'];
			const index = typeof rawIndex === 'string' ? Number(rawIndex) : Number.NaN;
			if (!Number.isInteger(index)) {
				continue;
			}

			const isSelected = selected.has(index);
			node.classList.toggle('is-selected', isSelected);
			node.classList.toggle('is-focused', focused.has(index));
			node.setAttribute('aria-selected', String(isSelected));
		}
	}

	private handleKeyDown(event: KeyboardEvent) {
		const activeIndex = this.list.getFocus()[0] ?? 0;
		const activeEntry = this.visibleNodes[activeIndex];
		if (!activeEntry) {
			return;
		}

		switch (event.key) {
			case 'ArrowRight': {
				if (activeEntry.hasChildren && !activeEntry.isExpanded && !this.options.isRoot(activeEntry.node)) {
					this.expandedIds.add(this.options.getId(activeEntry.node));
					this.rerender();
				} else if (activeEntry.hasChildren) {
					this.list.focusNext();
					this.list.reveal(this.list.getFocus()[0] ?? activeIndex);
				}
				event.preventDefault();
				event.stopPropagation();
				break;
			}
			case 'ArrowLeft': {
				const nodeId = this.options.getId(activeEntry.node);
				if (activeEntry.hasChildren && activeEntry.isExpanded && !this.options.isRoot(activeEntry.node)) {
					this.expandedIds.delete(nodeId);
					this.rerender();
				} else {
					const parentIndex = this.findParentIndex(activeIndex);
					if (parentIndex >= 0) {
						this.list.setFocus([parentIndex]);
						this.list.reveal(parentIndex);
					}
				}
				event.preventDefault();
				event.stopPropagation();
				break;
			}
			case 'Enter': {
				if (activeEntry.hasChildren && !this.options.isRoot(activeEntry.node)) {
					this.toggleExpanded(activeEntry);
				} else {
					this.list.setSelection([activeIndex]);
					this.options.onDidOpen?.(activeEntry.node);
				}
				event.preventDefault();
				event.stopPropagation();
				break;
			}
		}
	}

	private getVisibleNodes(input: T | null = this.input): VisibleTreeNode<T>[] {
		if (!input) {
			return [];
		}

		const nodes: VisibleTreeNode<T>[] = [];
		const visit = (node: T, depth: number, includeNode: boolean = true) => {
			const nodeId = this.options.getId(node);
			const hasChildren = this.dataSource.hasChildren(node);
			const isRoot = this.options.isRoot(node);
			if (
				hasChildren &&
				!isRoot &&
				this.options.shouldAutoExpand?.(node) &&
				!this.autoExpandedIds.has(nodeId)
			) {
				this.autoExpandedIds.add(nodeId);
				this.expandedIds.add(nodeId);
			}
			const isExpanded = isRoot || (hasChildren && this.expandedIds.has(nodeId));
			if (includeNode) {
				nodes.push({ node, depth, hasChildren, isExpanded });
			}
			if (hasChildren && isExpanded) {
				for (const child of this.dataSource.getChildren(node)) {
					visit(child, includeNode ? depth + 1 : depth);
				}
			}
		};

		visit(
			input,
			0,
			!(this.options.hideRoot && this.options.isRoot(input)),
		);
		return nodes;
	}

	private toggleExpanded(entry: VisibleTreeNode<T>) {
		const nodeId = this.options.getId(entry.node);
		if (!entry.hasChildren || this.options.isRoot(entry.node)) {
			return;
		}

		if (this.expandedIds.has(nodeId)) {
			this.expandedIds.delete(nodeId);
		} else {
			this.expandedIds.add(nodeId);
		}

		this.rerender();
	}

	private findParentIndex(index: number) {
		const current = this.visibleNodes[index];
		if (!current) {
			return -1;
		}

		for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
			const candidate = this.visibleNodes[cursor];
			if (candidate && candidate.depth < current.depth) {
				return cursor;
			}
		}

		return -1;
	}

	private findVisibleNodeIndex(node: T) {
		const nodeId = this.options.getId(node);
		return this.visibleNodes.findIndex(
			entry => this.options.getId(entry.node) === nodeId,
		);
	}
}
