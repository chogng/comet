/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';

interface IWindowsFinderWorkspaceFolder {
	readonly uri: URI;
}

interface IWindowsFinderResolvedWorkspace {
	readonly folders: readonly IWindowsFinderWorkspaceFolder[];
}

interface IWindowsFinderWorkspaceIdentifier {
	readonly configPath: URI;
}

interface IWindowsFinderSingleFolderWorkspaceIdentifier {
	readonly uri: URI;
}

interface IWindowsFinderWindow {
	readonly openedWorkspace?: IWindowsFinderWorkspaceIdentifier | IWindowsFinderSingleFolderWorkspaceIdentifier;
	readonly config?: {
		readonly extensionDevelopmentPath?: readonly string[];
	};
}

function isWorkspaceIdentifier(workspace: IWindowsFinderWindow['openedWorkspace']): workspace is IWindowsFinderWorkspaceIdentifier {
	return Boolean(workspace && 'configPath' in workspace);
}

function isSingleFolderWorkspaceIdentifier(workspace: IWindowsFinderWindow['openedWorkspace']): workspace is IWindowsFinderSingleFolderWorkspaceIdentifier {
	return Boolean(workspace && 'uri' in workspace);
}

export async function findWindowOnFile(
	windows: readonly IWindowsFinderWindow[],
	fileUri: URI,
	localWorkspaceResolver: (workspace: IWindowsFinderWorkspaceIdentifier) => Promise<IWindowsFinderResolvedWorkspace | undefined>,
): Promise<IWindowsFinderWindow | undefined> {
	for (const window of windows) {
		const workspace = window.openedWorkspace;
		if (!isWorkspaceIdentifier(workspace)) {
			continue;
		}

		const resolvedWorkspace = await localWorkspaceResolver(workspace);
		if (resolvedWorkspace) {
			if (resolvedWorkspace.folders.some(folder => extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, folder.uri))) {
				return window;
			}
			continue;
		}

		if (extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, workspace.configPath)) {
			return window;
		}
	}

	const singleFolderWindowsOnFilePath: { window: IWindowsFinderWindow; workspace: IWindowsFinderSingleFolderWorkspaceIdentifier }[] = [];
	for (const window of windows) {
		const workspace = window.openedWorkspace;
		if (isSingleFolderWorkspaceIdentifier(workspace) && extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, workspace.uri)) {
			singleFolderWindowsOnFilePath.push({ window, workspace });
		}
	}

	if (singleFolderWindowsOnFilePath.length) {
		return singleFolderWindowsOnFilePath.sort((windowA, windowB) =>
			-(windowA.workspace.uri.path.length - windowB.workspace.uri.path.length)
		)[0].window;
	}

	return undefined;
}

export function findWindowOnWorkspaceOrFolder(
	windows: readonly IWindowsFinderWindow[],
	folderOrWorkspaceConfigUri: URI,
): IWindowsFinderWindow | undefined {
	for (const window of windows) {
		if (isWorkspaceIdentifier(window.openedWorkspace) && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.configPath, folderOrWorkspaceConfigUri)) {
			return window;
		}

		if (isSingleFolderWorkspaceIdentifier(window.openedWorkspace) && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.uri, folderOrWorkspaceConfigUri)) {
			return window;
		}
	}

	return undefined;
}

export function findWindowOnExtensionDevelopmentPath(
	windows: readonly IWindowsFinderWindow[],
	extensionDevelopmentPaths: readonly string[],
): IWindowsFinderWindow | undefined {
	const matches = (uriString: string): boolean => extensionDevelopmentPaths.some(path => extUriBiasedIgnorePathCase.isEqual(URI.file(path), URI.file(uriString)));

	for (const window of windows) {
		if (window.config?.extensionDevelopmentPath?.some(path => matches(path))) {
			return window;
		}
	}

	return undefined;
}
