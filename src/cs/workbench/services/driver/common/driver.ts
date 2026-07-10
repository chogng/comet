/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Do not remove the START and END markers. test/automation copies this contract.

//*START
export interface IElement {
	readonly tagName: string;
	readonly className: string;
	readonly textContent: string;
	readonly attributes: { [name: string]: string };
	readonly children: IElement[];
	readonly top: number;
	readonly left: number;
}

export interface IWindowDriver {
	getElements(selector: string, recursive: boolean): Promise<IElement[]>;
	getElementXY(selector: string, xOffset?: number, yOffset?: number): Promise<{ x: number; y: number }>;
	whenWorkbenchRestored(): Promise<void>;
}
//*END
