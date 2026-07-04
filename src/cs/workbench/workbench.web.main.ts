//#region --- workbench common
import 'cs/workbench/workbench.common.main';
import 'cs/workbench/workbench.web.main.css';
//#endregion

// Web entry intentionally excludes desktop-only sandbox/window registrations.

if (typeof document !== 'undefined') {
  document.body.classList.add('web');
}
