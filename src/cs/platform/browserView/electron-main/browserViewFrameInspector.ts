/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IpcMainEvent, WebFrameMain } from 'electron';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, MutableDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IElementAncestor, IElementData, IBrowserViewTheme } from 'cs/platform/browserView/common/browserView';
import { collapseToShorthands, formatMatchedStyles, keyComputedProperties, type IMatchedStyles } from 'cs/platform/browserView/common/cssHelpers';
import type { ICDPConnection } from 'cs/platform/browserView/common/cdp/types';

/** Element data tied to the picker session that requested it. */
export interface IInspectedElement {
	readonly data: IElementData;
	readonly selectionId: number;
}

type Quad = [number, number, number, number, number, number, number, number];

interface IBoxModel {
	content: Quad;
	padding: Quad;
	border: Quad;
	margin: Quad;
	width: number;
	height: number;
}

interface INode {
	nodeId: number;
	backendNodeId: number;
	parentId?: number;
	localName: string;
	attributes: string[];
	children?: INode[];
	pseudoElements?: INode[];
}

interface ILayoutMetricsResult {
	cssVisualViewport?: {
		scale?: number;
	};
}

const inspectHighlightConfig = {
	showInfo: true,
	showRulers: false,
	showStyles: true,
	showAccessibilityInfo: true,
	showExtensionLines: false,
	contrastAlgorithm: 'aa',
	contentColor: { r: 173, g: 216, b: 255, a: 0.8 },
	paddingColor: { r: 150, g: 200, b: 255, a: 0.5 },
	borderColor: { r: 120, g: 180, b: 255, a: 0.7 },
	marginColor: { r: 200, g: 220, b: 255, a: 0.4 },
	eventTargetColor: { r: 130, g: 160, b: 255, a: 0.8 },
	shapeColor: { r: 130, g: 160, b: 255, a: 0.8 },
	shapeMarginColor: { r: 130, g: 160, b: 255, a: 0.5 },
	gridHighlightConfig: {
		rowGapColor: { r: 140, g: 190, b: 255, a: 0.3 },
		rowHatchColor: { r: 140, g: 190, b: 255, a: 0.7 },
		columnGapColor: { r: 140, g: 190, b: 255, a: 0.3 },
		columnHatchColor: { r: 140, g: 190, b: 255, a: 0.7 },
		rowLineColor: { r: 120, g: 180, b: 255 },
		columnLineColor: { r: 120, g: 180, b: 255 },
		rowLineDash: true,
		columnLineDash: true,
	},
	flexContainerHighlightConfig: {
		containerBorder: { color: { r: 120, g: 180, b: 255 }, pattern: 'solid' },
		itemSeparator: { color: { r: 140, g: 190, b: 255 }, pattern: 'solid' },
		lineSeparator: { color: { r: 140, g: 190, b: 255 }, pattern: 'solid' },
		mainDistributedSpace: { hatchColor: { r: 140, g: 190, b: 255, a: 0.7 }, fillColor: { r: 140, g: 190, b: 255, a: 0.4 } },
		crossDistributedSpace: { hatchColor: { r: 140, g: 190, b: 255, a: 0.7 }, fillColor: { r: 140, g: 190, b: 255, a: 0.4 } },
		rowGapSpace: { hatchColor: { r: 140, g: 190, b: 255, a: 0.7 }, fillColor: { r: 140, g: 190, b: 255, a: 0.4 } },
		columnGapSpace: { hatchColor: { r: 140, g: 190, b: 255, a: 0.7 }, fillColor: { r: 140, g: 190, b: 255, a: 0.4 } },
	},
	flexItemHighlightConfig: {
		baseSizeBox: { hatchColor: { r: 130, g: 170, b: 255, a: 0.6 } },
		baseSizeBorder: { color: { r: 120, g: 180, b: 255 }, pattern: 'solid' },
		flexibilityArrow: { color: { r: 130, g: 190, b: 255 } },
	},
};

/** Owns element inspection for one web frame and its CDP execution context. */
export class BrowserViewFrameInspector extends Disposable {
	private disposed = false;
	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;

	private readonly _onDidInspectElement = this._register(new Emitter<IInspectedElement>());
	readonly onDidInspectElement: Event<IInspectedElement> = this._onDidInspectElement.event;

	private readonly _onDidStopPicking = this._register(new Emitter<void>());
	readonly onDidStopPicking: Event<void> = this._onDidStopPicking.event;

	private paused = false;
	private readonly activeInspection = this._register(new MutableDisposable<IDisposable>());
	private inspectionActive = false;
	private selectionId = 0;
	private readonly initialization: Promise<void>;

	get isInspecting(): boolean {
		return this.inspectionActive;
	}

	get frameId(): string {
		return this.cdpFrameId;
	}

	constructor(
		readonly connection: ICDPConnection,
		readonly frame: WebFrameMain,
		private readonly uniqueContextId: string,
		private readonly cdpFrameId: string,
	) {
		super();

		this._register(connection.onClose(() => this.dispose()));
		this._register(connection.onEvent(async event => {
			switch (event.method) {
				case 'Overlay.inspectNodeRequested': {
					const params = event.params as { backendNodeId: number };
					if (!params?.backendNodeId || !this.isInspecting) {
						break;
					}
					const selectionId = this.selectionId;
					try {
						const { node } = await this.connection.sendCommand('DOM.describeNode', {
							backendNodeId: params.backendNodeId,
						}) as { node: { frameId?: string } };
						if (node.frameId && node.frameId !== this.cdpFrameId) {
							break;
						}
						const data = await this.extractNodeData({ backendNodeId: params.backendNodeId });
						if (!this.disposed) {
							this._onDidInspectElement.fire({ data, selectionId });
						}
					} catch {
						// The inspected node may disappear before its data is extracted.
					}
					break;
				}
				case 'Debugger.paused':
					this.paused = true;
					break;
				case 'Debugger.resumed':
					this.paused = false;
					break;
			}
		}));

		const onPicked = async (event: IpcMainEvent, pickId: string) => {
			if (!pickId || event.senderFrame !== this.frame) {
				return;
			}
			const selectionId = this.selectionId;
			try {
				const data = await this.extractNodeDataById(pickId);
				if (!this.disposed) {
					this._onDidInspectElement.fire({ data, selectionId });
				}
			} catch {
				// The selected element may be detached before CDP resolves it.
			}
		};
		frame.ipc.on('vscode:browserView:elementPicked', onPicked);
		this._register({ dispose: () => frame.ipc.removeListener('vscode:browserView:elementPicked', onPicked) });

		const onPickStopped = (event: IpcMainEvent) => {
			if (event.senderFrame === this.frame) {
				this._onDidStopPicking.fire();
			}
		};
		frame.ipc.on('vscode:browserView:elementPickStopped', onPickStopped);
		this._register({ dispose: () => frame.ipc.removeListener('vscode:browserView:elementPickStopped', onPickStopped) });

		this.initialization = this.enableDomains();
		void this.initialization.catch(() => this.dispose());
	}

	private async enableDomains(): Promise<void> {
		await this.connection.sendCommand('DOM.enable');
		await this.connection.sendCommand('Overlay.enable');
		await this.connection.sendCommand('CSS.enable');
		await this.connection.sendCommand('Runtime.enable');
		await this.connection.sendCommand('Page.enable');
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this._onWillDispose.fire();
		super.dispose();
	}

	setTheme(theme: IBrowserViewTheme): void {
		if (!this.frame.isDestroyed()) {
			this.frame.postMessage('vscode:browserView:setTheme', theme);
		}
	}

	async startInspection(selectionId: number): Promise<void> {
		let cancelled = false;
		let stop: (() => Promise<void>) | undefined;
		const inspection: IDisposable = {
			dispose: () => {
				cancelled = true;
				this.inspectionActive = false;
				if (stop) {
					void stop();
				}
			},
		};
		this.selectionId = selectionId;
		this.activeInspection.value = inspection;

		try {
			await this.initialization;
			if (cancelled) {
				return;
			}
			if (this.paused) {
				await this.connection.sendCommand('Overlay.setInspectMode', {
					mode: 'searchForNode',
					highlightConfig: inspectHighlightConfig,
				});
				stop = async () => {
					if (this.frame.isDestroyed()) {
						return;
					}
					try {
						await this.connection.sendCommand('Overlay.setInspectMode', {
							mode: 'none',
							highlightConfig: { showInfo: false, showStyles: false },
						});
						await this.connection.sendCommand('Overlay.hideHighlight');
					} catch {
						// The execution context may close while inspection is stopping.
					}
				};
			} else {
				stop = async () => {
					try {
						if (!this.frame.isDestroyed()) {
							this.frame.postMessage('vscode:browserView:stopElementPicker', {});
						}
					} catch {
						// The frame may close while inspection is stopping.
					}
				};
				this.frame.postMessage('vscode:browserView:startElementPicker', {});
			}

			if (cancelled || this.activeInspection.value !== inspection) {
				await stop();
				return;
			}
			this.inspectionActive = true;
		} catch (error) {
			if (this.activeInspection.value === inspection) {
				this.activeInspection.clear();
			}
			throw error;
		}
	}

	async stopInspection(): Promise<void> {
		this.activeInspection.clear();
	}

	async extractNodeDataById(elementId: string): Promise<IElementData> {
		const { result } = await this.connection.sendCommand('Runtime.evaluate', {
			expression: `window.__vscode_helpers?.getElement(${JSON.stringify(elementId)})`,
			returnByValue: false,
			uniqueContextId: this.uniqueContextId,
		}) as { result: { objectId?: string } };

		if (!result?.objectId) {
			throw new Error(`Element not found: ${elementId}`);
		}
		return this.extractNodeData({ objectId: result.objectId });
	}

	async extractNodeData(id: { backendNodeId?: number; objectId?: string }): Promise<IElementData> {
		const data = await extractNodeData(this.connection, id);
		return { ...data, url: this.frame.url };
	}

	async getVisualViewportScale(): Promise<number> {
		await this.initialization;
		const result = await this.connection.sendCommand('Page.getLayoutMetrics') as ILayoutMetricsResult;
		const scale = Number(result.cssVisualViewport?.scale);
		if (!Number.isFinite(scale) || scale <= 0) {
			throw new Error('Browser frame returned an invalid visual viewport scale.');
		}
		return scale;
	}

}

async function extractNodeData(connection: ICDPConnection, id: { backendNodeId?: number; objectId?: string }): Promise<IElementData> {
	const store = new DisposableStore();
	try {
		const discoveredNodesByNodeId: Record<number, INode> = {};
		store.add(connection.onEvent(event => {
			if (event.method !== 'DOM.setChildNodes') {
				return;
			}
			const { nodes } = event.params as { nodes: INode[] };
			for (const node of nodes) {
				discoveredNodesByNodeId[node.nodeId] = node;
				for (const child of node.children ?? []) {
					discoveredNodesByNodeId[child.nodeId] = { ...child, parentId: node.nodeId };
				}
				for (const pseudoElement of node.pseudoElements ?? []) {
					discoveredNodesByNodeId[pseudoElement.nodeId] = { ...pseudoElement, parentId: node.nodeId };
				}
			}
		}));

		await connection.sendCommand('DOM.getDocument');
		const { node } = await connection.sendCommand('DOM.describeNode', id) as { node: INode };
		if (!node) {
			throw new Error('Failed to describe node.');
		}
		let nodeId = node.nodeId;
		if (!nodeId) {
			const { nodeIds } = await connection.sendCommand('DOM.pushNodesByBackendIdsToFrontend', {
				backendNodeIds: [node.backendNodeId],
			}) as { nodeIds: number[] };
			if (!nodeIds?.length) {
				throw new Error('Failed to get node ID.');
			}
			nodeId = nodeIds[0];
		}

		const { model } = await connection.sendCommand('DOM.getBoxModel', { nodeId }) as { model: IBoxModel };
		if (!model) {
			throw new Error('Failed to get box model.');
		}
		const content = model.content;
		const margin = model.margin;
		const x = Math.min(margin[0], content[0]);
		const y = Math.min(margin[1], content[1]);
		const width = Math.max(margin[2] - margin[0], content[2] - content[0]);
		const height = Math.max(margin[5] - margin[1], content[5] - content[1]);

		const matched = await connection.sendCommand('CSS.getMatchedStylesForNode', { nodeId });
		if (!matched) {
			throw new Error('Failed to get matched CSS.');
		}
		const { rulesText, referencedVars, authorPropertyNames, userAgentPropertyNames } = formatMatchedStyles(matched as IMatchedStyles);
		const { outerHTML } = await connection.sendCommand('DOM.getOuterHTML', { nodeId }) as { outerHTML: string };
		if (!outerHTML) {
			throw new Error('Failed to get outerHTML.');
		}

		const attributes = attributeArrayToRecord(node.attributes);
		const ancestors: IElementAncestor[] = [];
		let currentNode: INode | undefined = discoveredNodesByNodeId[nodeId] ?? node;
		while (currentNode) {
			const currentAttributes = attributeArrayToRecord(currentNode.attributes);
			ancestors.unshift({
				tagName: currentNode.localName,
				id: currentAttributes.id,
				classNames: currentAttributes.class?.trim().split(/\s+/).filter(Boolean),
			});
			currentNode = currentNode.parentId ? discoveredNodesByNodeId[currentNode.parentId] : undefined;
		}

		let computedStyle = rulesText;
		let computedStyles: Record<string, string> | undefined;
		const { computedStyle: computedStyleArray } = await connection.sendCommand('CSS.getComputedStyleForNode', { nodeId }) as {
			computedStyle?: Array<{ name: string; value: string }>;
		};
		if (computedStyleArray) {
			computedStyles = {};
			const resolvedMap = new Map<string, string>();
			const variableLines: string[] = [];
			for (const property of computedStyleArray) {
				if (!property.name || typeof property.value !== 'string') {
					continue;
				}
				if (referencedVars.has(property.name) || keyComputedProperties.has(property.name)) {
					computedStyles[property.name] = property.value;
				}
				if (authorPropertyNames.has(property.name)) {
					resolvedMap.set(property.name, property.value);
				} else if (userAgentPropertyNames.has(property.name)) {
					resolvedMap.set(property.name, `${property.value} /*UA*/`);
				}
				if (referencedVars.has(property.name)) {
					variableLines.push(`${property.name}: ${property.value};`);
				}
			}
			if (resolvedMap.size > 0) {
				computedStyle += `\n\n/* Resolved values */\n${collapseToShorthands(resolvedMap).join('\n')}`;
			}
			if (variableLines.length > 0) {
				computedStyle += `\n\n/* CSS variables */\n${variableLines.join('\n')}`;
			}
		}

		return {
			outerHTML,
			computedStyle,
			bounds: { x, y, width, height },
			ancestors,
			attributes,
			computedStyles,
			dimensions: { top: y, left: x, width, height },
		};
	} finally {
		store.dispose();
	}
}

function attributeArrayToRecord(attributes: string[]): Record<string, string> {
	const record: Record<string, string> = {};
	for (let index = 0; index < attributes.length; index += 2) {
		record[attributes[index]] = attributes[index + 1];
	}
	return record;
}
