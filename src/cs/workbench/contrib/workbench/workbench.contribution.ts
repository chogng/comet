/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchPartDom,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import {
  disposeWorkbenchInstantiationService,
  getWorkbenchInstantiationService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
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

    lastContainer.dataset.workbenchParts = registeredPartIds;
  };

  const unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(syncContainerState);

  syncContainerState();

  return {
    dispose: () => {
      unsubscribeWorkbenchPartDom();
      clearContainerState(lastContainer);
      lastContainer = null;
    },
  };
}

export class WorkbenchStatusbarContribution implements Disposable {
  private currentHost: HTMLElement | null = null;
  private statusbarPart: StatusbarPart | null = null;
  private readonly unsubscribeWorkbenchPartDom: () => void;
  private readonly unsubscribeStatusbarState: () => void;

  constructor(
    @IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
  ) {
    this.unsubscribeWorkbenchPartDom = subscribeWorkbenchPartDom(this.syncStatusbarPart);
    this.unsubscribeStatusbarState = subscribeStatusbarState(this.syncStatusbarPart);
    this.syncStatusbarPart();
  }

  private readonly syncStatusbarPart = () => {
    const nextHost = getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.statusbar];

    if (this.currentHost !== nextHost) {
      this.disposeStatusbarPart();
      this.currentHost = nextHost;
    }

    if (!this.currentHost) {
      return;
    }

    if (!this.statusbarPart) {
      this.statusbarPart = new StatusbarPart(this.currentHost, this.commandService);
    }

    this.statusbarPart.render(getStatusbarStateSnapshot());
  };

  dispose(): void {
    this.unsubscribeWorkbenchPartDom();
    this.unsubscribeStatusbarState();
    this.disposeStatusbarPart();
    this.currentHost = null;
  }

  private disposeStatusbarPart(): void {
    this.statusbarPart?.dispose();
    this.statusbarPart = null;
  }
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
    },
  };
}

registerWorkbenchContribution(createWorkbenchContainerStateContribution);
registerWorkbenchContribution(createWorkbenchDocumentLocaleContribution);
registerWorkbenchContribution(createWorkbenchServicesLifecycleContribution);
registerWorkbenchContribution(() =>
  getWorkbenchInstantiationService().createInstance(WorkbenchStatusbarContribution),
);
