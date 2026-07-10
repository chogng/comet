/// <reference types="vite/client" />

type DesktopArticle = import('cs/base/parts/sandbox/common/sandboxTypes').Article;
type DesktopBatchSource = import('cs/base/parts/sandbox/common/sandboxTypes').BatchSource;
type DesktopFetchBatchSource = import('cs/base/parts/sandbox/common/sandboxTypes').FetchBatchSource;
type DesktopFetchStrategy = import('cs/base/parts/sandbox/common/sandboxTypes').FetchStrategy;
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
type DesktopFetchChannel = import('cs/base/parts/sandbox/common/sandboxTypes').FetchChannel;
type DesktopPreviewReuseMode = import('cs/base/parts/sandbox/common/sandboxTypes').WebContentReuseMode;
type ElectronInvoke = import('cs/base/parts/sandbox/common/sandboxTypes').ElectronInvoke;

interface Window {
  electronAPI?: import('cs/base/parts/sandbox/common/sandboxTypes').ElectronAPI;
}
