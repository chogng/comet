import {
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchPartDom,
  WORKBENCH_PART_IDS,
  getWorkbenchLayoutStateSnapshot,
  subscribeWorkbenchLayoutState,
} from 'cs/workbench/browser/layout';
import {
  disposeWorkbenchServices,
} from 'cs/workbench/browser/workbench';
import { disposeWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import {
  localeService,
} from 'cs/workbench/services/localization/browser/localeService';
import {
  getStatusbarStateSnapshot,
  subscribeStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
import { StatusbarPart } from 'cs/workbench/browser/parts/statusbar/statusbarPart';
import {
  registerWorkbenchContribution,
  type Disposable,
} from 'cs/workbench/common/contributions';

export function createWorkbenchContainerStateContribution(): Disposable {
  let lastContainer: HTMLElement | null = null;

  const clearContainerState = (container: HTMLElement | null) => {
    if (!container) {
      return;
    }

    delete container.dataset.primarySidebarVisible;
    delete container.dataset.agentSidebarVisible;
    delete container.dataset.workbenchParts;
  };

  const syncContainerState = () => {
    const workbenchPartDomSnapshot = getWorkbenchPartDomSnapshot();
    const nextContainer = workbenchPartDomSnapshot[WORKBENCH_PART_IDS.container];
    if (lastContainer && lastContainer !== nextContainer) {
      clearContainerState(lastContainer);
    }

    lastContainer = nextContainer;
    if (!lastContainer) {
      return;
    }

    const registeredPartIds = Object.entries(workbenchPartDomSnapshot)
      .filter(([, element]) => Boolean(element))
      .map(([partId]) => partId)
      .join(' ');

    lastContainer.dataset.primarySidebarVisible = String(
      getWorkbenchLayoutStateSnapshot().isPrimarySidebarVisible,
    );
    lastContainer.dataset.agentSidebarVisible = String(
      getWorkbenchLayoutStateSnapshot().isAgentSidebarVisible,
    );
    lastContainer.dataset.workbenchParts = registeredPartIds;
  };

  const unsubscribeWorkbenchLayoutState =
    subscribeWorkbenchLayoutState(syncContainerState);
  const unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(syncContainerState);

  syncContainerState();

  return {
    dispose: () => {
      unsubscribeWorkbenchLayoutState();
      unsubscribeWorkbenchPartDom();
      clearContainerState(lastContainer);
      lastContainer = null;
    },
  };
}

export function createWorkbenchStatusbarContribution(): Disposable {
  let currentHost: HTMLElement | null = null;
  let statusbarPart: StatusbarPart | null = null;

  const disposeStatusbarPart = () => {
    statusbarPart?.dispose();
    statusbarPart = null;
  };

  const syncStatusbarPart = () => {
    const nextHost = getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.statusbar];

    if (currentHost !== nextHost) {
      disposeStatusbarPart();
      currentHost = nextHost;
    }

    if (!currentHost) {
      return;
    }

    if (!statusbarPart) {
      statusbarPart = new StatusbarPart(currentHost);
    }

    statusbarPart.render(getStatusbarStateSnapshot());
  };

  const unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(syncStatusbarPart);
  const unsubscribeStatusbarState = subscribeStatusbarState(syncStatusbarPart);

  syncStatusbarPart();

  return {
    dispose: () => {
      unsubscribeWorkbenchPartDom();
      unsubscribeStatusbarState();
      disposeStatusbarPart();
      currentHost = null;
    },
  };
}

export function createWorkbenchDocumentLocaleContribution(): Disposable {
  const syncLocale = () => {
    localeService.syncDocumentLanguage();
  };

  const unsubscribeWorkbenchLocale = localeService.subscribe(syncLocale);
  syncLocale();

  return {
    dispose: () => {
      unsubscribeWorkbenchLocale();
    },
  };
}

export function createWorkbenchServicesLifecycleContribution(): Disposable {
  return {
    dispose: () => {
      disposeWorkbenchInstantiationService();
      disposeWorkbenchServices();
    },
  };
}

registerWorkbenchContribution(createWorkbenchContainerStateContribution);
registerWorkbenchContribution(createWorkbenchDocumentLocaleContribution);
registerWorkbenchContribution(createWorkbenchServicesLifecycleContribution);
registerWorkbenchContribution(createWorkbenchStatusbarContribution);
