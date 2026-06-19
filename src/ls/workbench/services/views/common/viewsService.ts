import { EventEmitter, type Event } from 'ls/base/common/event';
import { Disposable, type IDisposable } from 'ls/base/common/lifecycle';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';

export type WorkbenchViewId = string;

export interface WorkbenchViewVisibilityChangeEvent {
  readonly id: WorkbenchViewId;
  readonly visible: boolean;
}

export const IViewsService = createDecorator<IViewsService>('viewsService');

export interface IViewsService extends IDisposable {
  readonly _serviceBrand: undefined;
  readonly onDidChangeViewVisibility: Event<WorkbenchViewVisibilityChangeEvent>;
  isViewVisible(id: WorkbenchViewId): boolean;
  setViewVisible(id: WorkbenchViewId, visible: boolean): void;
  getVisibleViewIds(): readonly WorkbenchViewId[];
}

export class WorkbenchViewsService extends Disposable implements IViewsService {
  declare readonly _serviceBrand: undefined;

  private readonly visibleViewIds = new Set<WorkbenchViewId>();
  private readonly didChangeViewVisibilityEmitter = this._register(
    new EventEmitter<WorkbenchViewVisibilityChangeEvent>(),
  );

  readonly onDidChangeViewVisibility =
    this.didChangeViewVisibilityEmitter.event;

  isViewVisible(id: WorkbenchViewId) {
    return this.visibleViewIds.has(id);
  }

  setViewVisible(id: WorkbenchViewId, visible: boolean) {
    if (this.visibleViewIds.has(id) === visible) {
      return;
    }

    if (visible) {
      this.visibleViewIds.add(id);
    } else {
      this.visibleViewIds.delete(id);
    }

    this.didChangeViewVisibilityEmitter.fire({ id, visible });
  }

  getVisibleViewIds() {
    return [...this.visibleViewIds];
  }
}

export function createWorkbenchViewsService(): IViewsService {
  return new WorkbenchViewsService();
}
