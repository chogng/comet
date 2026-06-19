import type { Event } from 'ls/base/common/event';
import type { DisposableStore } from 'ls/base/common/lifecycle';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';

export const ILayoutService = createDecorator<ILayoutService>('layoutService');

export interface IDimension {
  readonly width: number;
  readonly height: number;
}

export interface ILayoutOffsetInfo {
  readonly top: number;
  readonly quickPickTop: number;
}

export interface ILayoutService {
  readonly _serviceBrand: undefined;
  readonly onDidLayoutMainContainer: Event<IDimension>;
  readonly onDidLayoutContainer: Event<{
    readonly container: HTMLElement;
    readonly dimension: IDimension;
  }>;
  readonly onDidLayoutActiveContainer: Event<IDimension>;
  readonly onDidAddContainer: Event<{
    readonly container: HTMLElement;
    readonly disposables: DisposableStore;
  }>;
  readonly onDidChangeActiveContainer: Event<void>;
  readonly mainContainerDimension: IDimension;
  readonly activeContainerDimension: IDimension;
  readonly mainContainer: HTMLElement;
  readonly activeContainer: HTMLElement;
  readonly containers: Iterable<HTMLElement>;
  getContainer(window: Window): HTMLElement;
  whenContainerStylesLoaded(window: Window): Promise<void> | undefined;
  readonly mainContainerOffset: ILayoutOffsetInfo;
  readonly activeContainerOffset: ILayoutOffsetInfo;
  focus(): void;
}
