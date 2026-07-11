//#region --- workbench common
import 'cs/workbench/workbench.common.main';
//#endregion

//#region --- workbench web services
import 'cs/workbench/services/secrets/browser/secretStorageService';
import 'cs/workbench/services/storage/browser/storageService';
import 'cs/workbench/contrib/browserView/browser/browserView.contribution';
import 'cs/workbench/contrib/fetch/browser/fetch.contribution';
//#endregion
// Web entry intentionally excludes desktop-only sandbox/window registrations.
