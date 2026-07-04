import type { HoverPosition } from './hoverWidget';

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
	DelayedHoverInput,
	HoverBinding,
	HoverInputFactory,
	HoverLifecycleOptions,
	IHoverDelegate,
} from './hoverDelegate';

export type HoverPositionOptions = {
	hoverPosition?: HoverPosition | MouseEvent;
	forcePosition?: boolean;
};
