import type { HoverPosition } from './hoverWidget';


/**
 * 底层协议
 */


export {
	createHoverController,
	normalizeHoverInput,
	HoverPosition,
	type HoverAction,
	type HoverHandle,
	type HoverInput,
	type HoverOptions,
	type HoverRenderable,
} from './hoverWidget';

export type {
	HoverBinding,
	IHoverDelegate,
} from './hoverDelegate';

export type HoverPositionOptions = {
	hoverPosition?: HoverPosition | MouseEvent;
	forcePosition?: boolean;
};
