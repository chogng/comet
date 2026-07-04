export interface IMouseEvent {
  readonly browserEvent: MouseEvent;
  readonly leftButton: boolean;
  readonly middleButton: boolean;
  readonly rightButton: boolean;
  readonly buttons: number;
  readonly target: HTMLElement | null;
  readonly detail: number;
  readonly posx: number;
  readonly posy: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly timestamp: number;
  readonly defaultPrevented: boolean;

  preventDefault(): void;
  stopPropagation(): void;
}

export interface IMouseWheelEvent extends WheelEvent {}

function resolvePageCoordinate(
  value: number,
  clientValue: number,
  scrollOffset: number,
) {
  if (Number.isFinite(value) && (value !== 0 || clientValue === 0)) {
    return value;
  }

  return clientValue + scrollOffset;
}

export class StandardMouseEvent implements IMouseEvent {
  public readonly browserEvent: MouseEvent;
  public readonly leftButton: boolean;
  public readonly middleButton: boolean;
  public readonly rightButton: boolean;
  public readonly buttons: number;
  public readonly target: HTMLElement | null;
  public readonly detail: number;
  public readonly posx: number;
  public readonly posy: number;
  public readonly clientX: number;
  public readonly clientY: number;
  public readonly ctrlKey: boolean;
  public readonly shiftKey: boolean;
  public readonly altKey: boolean;
  public readonly metaKey: boolean;
  public readonly timestamp: number;
  public readonly defaultPrevented: boolean;

  constructor(targetWindow: Window, event: MouseEvent) {
    this.timestamp = Date.now();
    this.browserEvent = event;
    this.leftButton = event.button === 0;
    this.middleButton = event.button === 1;
    this.rightButton = event.button === 2;
    this.buttons = event.buttons;
    this.defaultPrevented = event.defaultPrevented;
    this.target = event.target instanceof HTMLElement ? event.target : null;
    this.detail = event.type === 'dblclick' ? 2 : (event.detail || 1);
    this.clientX = event.clientX;
    this.clientY = event.clientY;
    this.ctrlKey = event.ctrlKey;
    this.shiftKey = event.shiftKey;
    this.altKey = event.altKey;
    this.metaKey = event.metaKey;
    this.posx = resolvePageCoordinate(event.pageX, event.clientX, targetWindow.scrollX);
    this.posy = resolvePageCoordinate(event.pageY, event.clientY, targetWindow.scrollY);
  }

  public preventDefault() {
    this.browserEvent.preventDefault();
  }

  public stopPropagation() {
    this.browserEvent.stopPropagation();
  }
}

export class DragMouseEvent extends StandardMouseEvent {
  public readonly dataTransfer: DataTransfer | null;

  constructor(targetWindow: Window, event: MouseEvent) {
    super(targetWindow, event);
    const dragEvent = event as MouseEvent & {
      dataTransfer?: DataTransfer | null;
    };
    this.dataTransfer = dragEvent.dataTransfer ?? null;
  }
}

export function getMouseClientCoordinates(event: MouseEvent | IMouseEvent) {
  if ('browserEvent' in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return {
    x: event.clientX,
    y: event.clientY,
  };
}
