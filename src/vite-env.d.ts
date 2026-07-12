/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vite/client" />
declare module '*.html' {
	const html: string;
	export default html;
}

type DesktopPdfDownloadResult = import('cs/base/parts/sandbox/common/sandboxTypes').PdfDownloadResult;
type DesktopDocxExportResult = import('cs/base/parts/sandbox/common/sandboxTypes').DocxExportResult;
type DesktopStoredAppSettings = import('cs/base/parts/sandbox/common/sandboxTypes').StoredAppSettings;
type DesktopAppSettings = import('cs/base/parts/sandbox/common/sandboxTypes').AppSettings;
type AppCommandPayloadMap = import('cs/base/parts/sandbox/common/sandboxTypes').AppCommandPayloadMap;
type AppCommandResultMap = import('cs/base/parts/sandbox/common/sandboxTypes').AppCommandResultMap;
type AppCommand = import('cs/base/parts/sandbox/common/sandboxTypes').AppCommand;
type WindowControlAction = import('cs/base/parts/sandbox/common/sandboxTypes').WindowControlAction;
type WindowState = import('cs/base/parts/sandbox/common/sandboxTypes').WindowState;
type WindowStateListener = import('cs/base/parts/sandbox/common/sandboxTypes').WindowStateListener;
type DesktopWebContentBounds = import('cs/base/parts/sandbox/common/sandboxTypes').WebContentBounds;
type DesktopWebContentState = import('cs/base/parts/sandbox/common/sandboxTypes').WebContentState;
type DesktopPreviewReuseMode = import('cs/base/parts/sandbox/common/sandboxTypes').WebContentReuseMode;
type ElectronInvoke = import('cs/base/parts/sandbox/common/sandboxTypes').ElectronInvoke;

interface Window {
  electronAPI?: import('cs/base/parts/sandbox/common/sandboxTypes').ElectronAPI;
}
