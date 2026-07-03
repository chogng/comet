import {
  getWorkbenchBrowserTabKeepAliveLimit,
  subscribeWorkbenchWebContentRetention,
} from 'ls/workbench/browser/webContentRetentionState';
import {
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchPartDom,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import {
  combinedDisposable,
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';
import type {
  WebContentBounds,
  WebContentLayoutPhase,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';
import {
  registerWorkbenchContribution,
  type Disposable,
} from 'ls/workbench/common/contributions';

type WebContentLayoutSnapshot = {
  visible: boolean;
  bounds: WebContentBounds | null;
};

function readWebContentViewLayout(webContentViewHostElement: HTMLElement | null) {
  if (!webContentViewHostElement) {
    return {
      visible: false,
      bounds: null,
    };
  }

  if (webContentViewHostElement.dataset.webcontentActive !== 'true') {
    return {
      visible: false,
      bounds: null,
    };
  }

  const rect = webContentViewHostElement.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (width <= 0 || height <= 0) {
    return {
      visible: false,
      bounds: null,
    };
  }

  return {
    visible: true,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width,
      height,
    },
  };
}

function areBoundsEqual(
  left: WebContentLayoutSnapshot['bounds'],
  right: WebContentLayoutSnapshot['bounds'],
) {
  return (
    left?.x === right?.x &&
    left?.y === right?.y &&
    left?.width === right?.width &&
    left?.height === right?.height
  );
}

function areLayoutSnapshotsEqual(
  left: WebContentLayoutSnapshot | null,
  right: WebContentLayoutSnapshot | null,
) {
  if (!left || !right) {
    return left === right;
  }

  return left.visible === right.visible && areBoundsEqual(left.bounds, right.bounds);
}

function addDisposableListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export function createWorkbenchWebContentViewContribution(): Disposable | void {
  const webContentApi =
    typeof window === 'undefined' ? undefined : getNativeHostService().webContent;

  if (
    typeof window === 'undefined' ||
    typeof webContentApi?.navigate !== 'function'
  ) {
    return;
  }

  let webContentViewHostElement =
    getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.webContentViewHost];
  const contributionDisposables = new DisposableStore();
  const hostObservers = new MutableDisposable<DisposableLike>();
  const scheduledSync = new MutableDisposable<DisposableLike>();
  let lastSnapshot: WebContentLayoutSnapshot | null = null;
  let layoutPhase: WebContentLayoutPhase = 'hidden';
  let measuringSnapshot: WebContentLayoutSnapshot | null = null;

  const applySurfaceState = (
    visible: boolean,
    phase: WebContentLayoutPhase,
    bounds: WebContentBounds | null,
  ) => {
    webContentApi.setBounds(bounds);
    webContentApi.setVisible(visible);
    webContentApi.setLayoutPhase(phase);
  };

  const syncRetentionLimit = () => {
    webContentApi.setRetentionLimit(getWorkbenchBrowserTabKeepAliveLimit());
  };

  contributionDisposables.add(hostObservers);
  contributionDisposables.add(scheduledSync);
  contributionDisposables.add(subscribeWorkbenchWebContentRetention(syncRetentionLimit));

  const scheduleSync = () => {
    if (scheduledSync.value) {
      return;
    }

    let frameId = 0;
    const frameDisposable = toDisposable(() => {
      window.cancelAnimationFrame(frameId);
    });
    scheduledSync.value = frameDisposable;
    frameId = window.requestAnimationFrame(() => {
      if (scheduledSync.value === frameDisposable) {
        scheduledSync.clearAndLeak();
      }
      const nextSnapshot = readWebContentViewLayout(webContentViewHostElement);

      if (!nextSnapshot.visible) {
        layoutPhase = 'hidden';
        measuringSnapshot = null;
        applySurfaceState(false, 'hidden', null);
        lastSnapshot = nextSnapshot;
        return;
      }

      if (layoutPhase === 'hidden') {
        layoutPhase = 'measuring';
        measuringSnapshot = nextSnapshot;
        applySurfaceState(true, 'measuring', nextSnapshot.bounds);
        scheduleSync();
        return;
      }

      if (layoutPhase === 'measuring') {
        if (areLayoutSnapshotsEqual(measuringSnapshot, nextSnapshot)) {
          layoutPhase = 'visible';
          measuringSnapshot = null;
          applySurfaceState(true, 'visible', nextSnapshot.bounds);
          lastSnapshot = nextSnapshot;
          return;
        }

        measuringSnapshot = nextSnapshot;
        applySurfaceState(true, 'measuring', nextSnapshot.bounds);
        scheduleSync();
        return;
      }

      if (!areLayoutSnapshotsEqual(lastSnapshot, nextSnapshot)) {
        applySurfaceState(true, 'visible', nextSnapshot.bounds);
      }
      lastSnapshot = nextSnapshot;
    });
  };

  const resetObserver = () => {
    hostObservers.clear();

    if (!webContentViewHostElement) {
      return;
    }

    const mutationObserver = new MutationObserver(() => {
      layoutPhase = 'hidden';
      measuringSnapshot = null;
      scheduleSync();
    });
    mutationObserver.observe(webContentViewHostElement, {
      attributes: true,
      attributeFilter: ['data-webcontent-active'],
    });
    const observerDisposables: DisposableLike[] = [
      toDisposable(() => {
        mutationObserver.disconnect();
      }),
    ];

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => scheduleSync());
      resizeObserver.observe(webContentViewHostElement);
      observerDisposables.push(
        toDisposable(() => {
          resizeObserver.disconnect();
        }),
      );
    }

    hostObservers.value = combinedDisposable(...observerDisposables);
  };

  const syncFromPartDom = () => {
    const nextWebContentViewHostElement =
      getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.webContentViewHost];
    if (nextWebContentViewHostElement !== webContentViewHostElement) {
      webContentViewHostElement = nextWebContentViewHostElement;
      layoutPhase = 'hidden';
      measuringSnapshot = null;
      resetObserver();
    }

    scheduleSync();
  };

  contributionDisposables.add(subscribeWorkbenchPartDom(syncFromPartDom));
  contributionDisposables.add(
    addDisposableListener(window, 'resize', () => scheduleSync()),
  );

  syncRetentionLimit();
  resetObserver();
  scheduleSync();

  return {
    dispose: () => {
      contributionDisposables.dispose();
      applySurfaceState(false, 'hidden', null);
    },
  };
}

registerWorkbenchContribution(createWorkbenchWebContentViewContribution);
