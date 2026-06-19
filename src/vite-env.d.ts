/// <reference types="vite/client" />

type DesktopArticle = import('ls/base/parts/sandbox/common/desktopTypes').Article;
type DesktopBatchSource = import('ls/base/parts/sandbox/common/desktopTypes').BatchSource;
type DesktopFetchBatchSource = import('ls/base/parts/sandbox/common/desktopTypes').FetchBatchSource;
type DesktopFetchStrategy = import('ls/base/parts/sandbox/common/desktopTypes').FetchStrategy;
type DesktopPdfDownloadResult = import('ls/base/parts/sandbox/common/desktopTypes').PdfDownloadResult;
type DesktopDocxExportResult = import('ls/base/parts/sandbox/common/desktopTypes').DocxExportResult;
type DesktopStoredAppSettings = import('ls/base/parts/sandbox/common/desktopTypes').StoredAppSettings;
type DesktopAppSettings = import('ls/base/parts/sandbox/common/desktopTypes').AppSettings;
type AppCommandPayloadMap = import('ls/base/parts/sandbox/common/desktopTypes').AppCommandPayloadMap;
type AppCommandResultMap = import('ls/base/parts/sandbox/common/desktopTypes').AppCommandResultMap;
type AppCommand = import('ls/base/parts/sandbox/common/desktopTypes').AppCommand;
type WindowControlAction = import('ls/base/parts/sandbox/common/desktopTypes').WindowControlAction;
type WindowState = import('ls/base/parts/sandbox/common/desktopTypes').WindowState;
type WindowStateListener = import('ls/base/parts/sandbox/common/desktopTypes').WindowStateListener;
type DesktopWebContentBounds = import('ls/base/parts/sandbox/common/desktopTypes').WebContentBounds;
type DesktopWebContentState = import('ls/base/parts/sandbox/common/desktopTypes').WebContentState;
type DesktopFetchChannel = import('ls/base/parts/sandbox/common/desktopTypes').FetchChannel;
type DesktopPreviewReuseMode = import('ls/base/parts/sandbox/common/desktopTypes').WebContentReuseMode;
type DesktopFetchStatus = import('ls/base/parts/sandbox/common/desktopTypes').FetchStatus;
type ElectronInvoke = import('ls/base/parts/sandbox/common/desktopTypes').ElectronInvoke;

interface Window {
  electronAPI?: import('ls/base/parts/sandbox/common/desktopTypes').ElectronAPI;
}
