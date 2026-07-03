//#region --- workbench core
import 'ls/base/browser/ui/button/button.css';
import { DisposableStore } from 'ls/base/common/lifecycle';
import {
  createWorkbenchContainerStateContribution,
  createWorkbenchDocumentLocaleContribution,
  createWorkbenchServicesLifecycleContribution,
  createWorkbenchStatusbarContribution,
} from 'ls/workbench/contrib/workbench/workbench.contribution';
import { createWorkbenchContextKeysContribution } from 'ls/workbench/browser/contextkeys';
import { registerWorkbenchContribution } from 'ls/workbench/browser/workbench.contribution';
import { createWorkbenchWebContentViewContribution } from 'ls/workbench/contrib/webContentView/webContentView.contribution';
import {
  IWorkbenchCommandService,
  createWorkbenchCommandService,
} from 'ls/workbench/services/commands/common/commandService';
import {
  IWorkbenchConfigurationService,
} from 'ls/workbench/services/configuration/common/configuration';
import {
  createWorkbenchConfigurationService,
} from 'ls/workbench/services/configuration/browser/configurationService';
import {
  IWorkbenchEnvironmentService,
  createWorkbenchEnvironmentService,
} from 'ls/workbench/services/environment/browser/environmentService';
import {
  IHostService,
  createWorkbenchHostService,
} from 'ls/workbench/services/host/browser/host';
import {
  IWorkbenchKeybindingService,
  createWorkbenchKeybindingService,
} from 'ls/workbench/services/keybinding/browser/keybindingService';
import {
  INotificationService,
} from 'ls/platform/notification/common/notification';
import {
  IWorkbenchLanguageService,
  createWorkbenchLanguageService,
} from 'ls/workbench/services/language/common/languageService';
import {
  IWorkbenchLayoutService,
  createWorkbenchLayoutService,
} from 'ls/workbench/services/layout/browser/layoutService';
import {
  ILifecycleService,
} from 'ls/workbench/services/lifecycle/common/lifecycle';
import {
  createBrowserWorkbenchLifecycleService,
} from 'ls/workbench/services/lifecycle/browser/lifecycleService';
import {
  IWorkbenchLocaleService,
  createWorkbenchLocaleService,
} from 'ls/workbench/services/localization/browser/localeService';
import {
  IViewsService,
  createWorkbenchViewsService,
} from 'ls/workbench/services/views/common/viewsService';
import {
  registerWorkbenchDisposable,
  registerWorkbenchService,
} from 'ls/workbench/services/instantiation/browser/workbenchInstantiationService';
import {
  createWorkbenchNotificationService,
} from 'ls/workbench/browser/parts/notifications/notificationsModel';
//#endregion

//#region --- workbench actions
import 'ls/workbench/browser/actions/layoutActions';
//#endregion

//#region --- workbench services
import 'ls/workbench/contrib/localization/localization.contribution';
import 'ls/workbench/contrib/sash/browser/sash.contribution';

const workbenchServicesStore = new DisposableStore();
const workbenchConfigurationService = workbenchServicesStore.add(
  createWorkbenchConfigurationService(),
);
const workbenchLifecycleService = workbenchServicesStore.add(
  createBrowserWorkbenchLifecycleService(),
);
const workbenchViewsService = workbenchServicesStore.add(
  createWorkbenchViewsService(),
);
const workbenchNotificationService = workbenchServicesStore.add(
  createWorkbenchNotificationService(),
);
const workbenchLayoutService = workbenchServicesStore.add(
  createWorkbenchLayoutService(),
);

registerWorkbenchService(
  IWorkbenchCommandService,
  createWorkbenchCommandService(),
);
registerWorkbenchService(
  IWorkbenchConfigurationService,
  workbenchConfigurationService,
);
registerWorkbenchService(
  IWorkbenchEnvironmentService,
  createWorkbenchEnvironmentService(),
);
registerWorkbenchService(IHostService, createWorkbenchHostService());
registerWorkbenchService(
  IWorkbenchKeybindingService,
  createWorkbenchKeybindingService(),
);
registerWorkbenchService(
  IWorkbenchLanguageService,
  createWorkbenchLanguageService(),
);
registerWorkbenchService(
  IWorkbenchLayoutService,
  workbenchLayoutService,
);
registerWorkbenchService(
  IWorkbenchLocaleService,
  createWorkbenchLocaleService(),
);
registerWorkbenchService(INotificationService, workbenchNotificationService);
registerWorkbenchService(ILifecycleService, workbenchLifecycleService);
registerWorkbenchService(IViewsService, workbenchViewsService);
registerWorkbenchDisposable(workbenchServicesStore);
//#endregion

//#region --- workbench contributions
registerWorkbenchContribution(createWorkbenchContainerStateContribution);
registerWorkbenchContribution(createWorkbenchContextKeysContribution);
registerWorkbenchContribution(createWorkbenchDocumentLocaleContribution);
registerWorkbenchContribution(createWorkbenchServicesLifecycleContribution);
registerWorkbenchContribution(createWorkbenchStatusbarContribution);
registerWorkbenchContribution(createWorkbenchWebContentViewContribution);
//#endregion
