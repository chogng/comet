//#region --- workbench core
import 'ls/base/browser/ui/button/button.css';
import {
  createWorkbenchContainerStateContribution,
  createWorkbenchDocumentLocaleContribution,
  createWorkbenchServicesLifecycleContribution,
  createWorkbenchStatusbarContribution,
} from 'ls/workbench/contrib/workbench/workbench.contribution';
import { createWorkbenchContextKeysContribution } from 'ls/workbench/browser/contextkeys';
import { registerWorkbenchContribution } from 'ls/workbench/browser/workbench.contribution';
import { createWorkbenchWebContentViewContribution } from 'ls/workbench/contrib/webContentView/webContentView.contribution';
//#endregion

//#region --- workbench services
import 'ls/workbench/contrib/localization/localization.contribution';
import 'ls/workbench/contrib/sash/browser/sash.contribution';
//#endregion

//#region --- workbench contributions
registerWorkbenchContribution(createWorkbenchContainerStateContribution);
registerWorkbenchContribution(createWorkbenchContextKeysContribution);
registerWorkbenchContribution(createWorkbenchDocumentLocaleContribution);
registerWorkbenchContribution(createWorkbenchServicesLifecycleContribution);
registerWorkbenchContribution(createWorkbenchStatusbarContribution);
registerWorkbenchContribution(createWorkbenchWebContentViewContribution);
//#endregion
