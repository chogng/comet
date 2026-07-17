/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type { LibraryDocumentSummary } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { EditorDraftStyleOption } from 'cs/editor/common/services/editorDraftStyleService';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { SettingsModelSnapshot } from 'cs/workbench/services/settings/settingsModel';
import type { IAgentHostManagementSnapshot } from 'cs/platform/agentHost/browser/agentHostManagementService';

export type SettingsViewState = SettingsModelSnapshot & {
	readonly labels: LocaleMessages;
	readonly locale: Locale;
	readonly supportedSources: readonly JournalDescriptor[];
	readonly showSupportedSources: boolean;
	readonly editorDraftFontFamilyOptions: readonly EditorDraftStyleOption[];
	readonly editorDraftFontSizeOptions: readonly EditorDraftStyleOption[];
	readonly desktopRuntime: boolean;
	readonly isLibraryLoading: boolean;
	readonly libraryDocumentCount: number;
	readonly libraryFileCount: number;
	readonly libraryQueuedJobCount: number;
	readonly libraryDocuments: readonly LibraryDocumentSummary[];
	readonly libraryDbFile: string;
	readonly defaultManagedDirectory: string;
	readonly ragCacheDir: string;
	readonly agentHostManagement: IAgentHostManagementSnapshot;
};
