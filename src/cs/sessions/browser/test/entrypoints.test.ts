/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const Root = process.cwd();

function readSource(relativePath: string): string {
	return readFileSync(path.join(Root, relativePath), 'utf8');
}

function sourceFiles(root: string): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const candidate = path.join(root, entry);
		const stat = statSync(candidate);
		if (stat.isDirectory()) {
			if (entry !== 'test' && entry !== 'tests') {
				files.push(...sourceFiles(candidate));
			}
			continue;
		}
		if (candidate.endsWith('.ts') && !candidate.endsWith('.test.ts')) {
			files.push(candidate);
		}
	}
	return files;
}

function count(source: string, pattern: RegExp): number {
	return source.match(pattern)?.length ?? 0;
}

test('browser and desktop bootstrap the Sessions application exactly once', () => {
	for (const target of ['browser', 'electron-browser'] as const) {
		const source = readSource(`src/cs/code/${target}/workbench.ts`);
		const expectedMain = target === 'browser'
			? 'cs/sessions/sessions.web.main'
			: 'cs/sessions/sessions.desktop.main';
		assert.ok(source.includes(`await import('${expectedMain}')`));
		assert.match(source, /cs\/sessions\/browser\/sessionsWorkbench/);
		assert.equal(count(source, /await startSessionsWorkbench\(\)/g), 1);
		assert.doesNotMatch(source, /startWorkbenchContributions|renderSessionsWorkbench/);
		assert.doesNotMatch(source, /cs\/workbench\/browser\/workbench/);
		assert.doesNotMatch(source, /renderWorkbench\(\)/);
		assert.doesNotMatch(source, /nativeOverlay|isNativeWorkbenchAuxiliaryWindow/);
	}

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	assert.match(sessionsWorkbench, /@IStorageService private readonly storageService/);
	assert.ok(
		sessionsWorkbench.indexOf('await this.storageService.init()')
			< sessionsWorkbench.indexOf('startWorkbenchContributions()'),
		'Sessions storage must initialize before product contributions start',
	);
	assert.ok(
		sessionsWorkbench.indexOf('startWorkbenchContributions()')
			< sessionsWorkbench.indexOf('renderSessionsWorkbench()'),
		'product contributions must start before the Sessions host renders',
	);
	assert.match(
		sessionsWorkbench,
		/this\.storageService\.flush\(WillSaveStateReason\.SHUTDOWN\)/,
	);
	assert.doesNotMatch(sessionsWorkbench, /handleWorkbenchEditorShortcut|handleWindowKeydown/);
	assert.ok(
		sessionsWorkbench.lastIndexOf('this.storageService.flush(WillSaveStateReason.SHUTDOWN)')
			< sessionsWorkbench.lastIndexOf('stopWorkbenchContributions()'),
		'Sessions state must save before product contributions stop',
	);
});

test('Sessions target mains load their matching Workbench foundation before contributions', () => {
	const common = readSource('src/cs/sessions/sessions.common.main.ts');
	const desktop = readSource('src/cs/sessions/sessions.desktop.main.ts');
	const web = readSource('src/cs/sessions/sessions.web.main.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	const workbenchDesktop = readSource('src/cs/workbench/workbench.desktop.main.ts');
	assert.ok(desktop.indexOf("'cs/workbench/workbench.desktop.main'") < desktop.indexOf("'cs/sessions/sessions.common.main'"));
	assert.ok(web.indexOf("'cs/workbench/workbench.web.main'") < web.indexOf("'cs/sessions/sessions.common.main'"));
	assert.match(common, /sessions\/services\/layout\/browser\/layoutService/);
	assert.doesNotMatch(common, /sessions\/contrib\/editor\/browser\/editorCommands\.contribution/);
	assert.match(workbenchCommon, /workbench\/contrib\/draftEditor\/browser\/draftEditor\.contribution/);
	assert.match(common, /sessions\/contrib\/sessions\/browser\/sessions\.contribution/);
	assert.match(desktop, /sessions\/contrib\/browserView\/electron-browser\/browserViewChat\.contribution/);
	assert.match(desktop, /defaultSessionsProvider\.contribution/);
	assert.doesNotMatch(web, /defaultSessionsProvider/);
	assert.equal(count(desktop, /layout\.contribution/g), 1);
	assert.equal(count(web, /layout\.contribution/g), 1);
	assert.match(desktop, /sessions\/contrib\/splash\/browser\/partsSplash/);
	assert.doesNotMatch(workbenchCommon, /services\/layout|actions\/layoutActions/);
	assert.doesNotMatch(workbenchDesktop, /browserEditorChatFeatures|cs\/sessions/);
	assert.doesNotMatch(workbenchDesktop, /contrib\/splash\/browser\/partsSplash/);
});

test('Lower source layers do not import Sessions and Workbench has no product host entry', () => {
	const lowerLayerRoots = ['base', 'platform', 'editor', 'workbench']
		.map(layer => path.join(Root, 'src/cs', layer));
	const violations = lowerLayerRoots.flatMap(root => sourceFiles(root)).flatMap(file => {
		const source = readFileSync(file, 'utf8');
		return source.includes("'cs/sessions/") || source.includes('"cs/sessions/')
			? [path.relative(Root, file)]
			: [];
	});
	assert.deepEqual(violations, []);
	const workbenchRoot = path.join(Root, 'src/cs/workbench');
	assert.equal(existsSync(path.join(workbenchRoot, 'browser/workbench.ts')), false);

	const sessionsSources = sourceFiles(path.join(Root, 'src/cs/sessions'));
	const hostDefinitions = sessionsSources.filter(file =>
		readFileSync(file, 'utf8').includes('class SessionsWorkbenchHost'),
	);
	assert.deepEqual(hostDefinitions.map(file => path.relative(Root, file)), [
		'src/cs/sessions/browser/sessionsWorkbench.ts',
	]);
});

test('Sessions host directly composes Parts without a state-forwarding wrapper', () => {
	assert.equal(
		existsSync(path.join(Root, 'src/cs/sessions/browser/workbenchContentPartViews.ts')),
		false,
	);

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	assert.doesNotMatch(
		sessionsWorkbench,
		/SessionWorkbenchContentPartViews|workbenchContentPartViews|partViewProps/,
	);
	assert.match(sessionsWorkbench, /createInstance\(\s*SessionSidebarPartView,/);
	assert.match(sessionsWorkbench, /createInstance\(\s*SessionsLayoutView,/);
	assert.match(
		sessionsWorkbench,
		/@ISessionsPartService private readonly sessionsPart: SessionsPart/,
	);
	assert.match(sessionsWorkbench, /this\.sessionsPart\.setTitlebarActions\(/);

	const layout = readSource('src/cs/sessions/browser/layout.ts');
	assert.doesNotMatch(layout, /ISessionsLayoutPartViews|partViews/);
	assert.match(layout, /private readonly sidebarPart: SessionSidebarPartView/);
	assert.match(layout, /private readonly sessionsPart: SessionsPart/);
	assert.match(layout, /private readonly editorPart: SessionsMainEditorPart/);

	const sidebar = readSource('src/cs/sessions/browser/parts/sidebar/sidebarPart.ts');
	assert.doesNotMatch(sidebar, /SessionSidebar(?:View)?Props|\bisCollapsed\b|setProps\(/);
	assert.match(sidebar, /@ISessionsLayoutService private readonly layoutService/);
	assert.match(sidebar, /@IWorkbenchLocaleService private readonly localeService/);
	assert.match(sidebar, /getLayoutState\(\)\.isSidebarVisible/);
});

test('Settings controller is a DI service without mutable shell context', () => {
	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	assert.match(
		sessionsWorkbench,
		/@ISettingsController private readonly settingsController: SettingsController/,
	);
	assert.doesNotMatch(
		sessionsWorkbench,
		/getWorkbenchSettingsController|let settingsController|settingsControllerInstance\.setContext|this\.settingsController\.start\(/,
	);
	assert.match(workbenchCommon, /preferences\/browser\/settings\.contribution/);

	const settingsController = readSource(
		'src/cs/workbench/contrib/preferences/browser/settingsController.ts',
	);
	assert.doesNotMatch(
		settingsController,
		/SettingsControllerContext|CreateSettingsControllerParams|readonly setContext/,
	);
	assert.match(settingsController, /@INativeHostService private readonly nativeHostService/);
	assert.match(settingsController, /registerSingleton\(\s*ISettingsController,/);
});

test('Library model is a DI service without mutable shell context', () => {
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/browser/libraryModel.ts')),
		false,
	);

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	assert.match(
		sessionsWorkbench,
		/@ILibraryModel private readonly libraryModel: LibraryModel/,
	);
	assert.doesNotMatch(
		sessionsWorkbench,
		/createLibraryModel|LibraryModelContext|getWorkbenchLibraryModel|libraryModelInstance\.setContext/,
	);
	assert.match(workbenchCommon, /services\/knowledgeBase\/libraryModel/);

	const libraryModel = readSource(
		'src/cs/workbench/services/knowledgeBase/libraryModel.ts',
	);
	assert.doesNotMatch(libraryModel, /LibraryModelContext|readonly setContext|readonly start/);
	assert.match(libraryModel, /@INativeHostService private readonly nativeHostService/);
	assert.match(libraryModel, /registerSingleton\(ILibraryModel, LibraryModel,/);
});
