export interface TestSelection {
	readonly runFiles?: readonly string[];
	readonly globs?: readonly string[];
}

export interface TestSpawnResult {
	readonly error?: Error;
	readonly status: number | null;
	readonly signal: NodeJS.Signals | null;
}

export interface TestTypeScriptProject {
	readonly id: string;
	readonly config: string;
}

export const supportedTestSuffixes: readonly string[];
export const unitTestSourceRoots: readonly string[];
export const unitTypeScriptProjects: readonly TestTypeScriptProject[];
export function validateSupportedTestFiles(files: readonly string[]): string[];
export function selectTestFiles(
	files: readonly string[],
	selection?: TestSelection,
	rootDir?: string,
): string[];
export function discoverProjectTestFiles(rootDir?: string): Promise<string[]>;
export function compiledTestPath(sourceFile: string, outputDirectory: string, rootDir?: string): string;
export function spawnExitCode(result: TestSpawnResult): number;
export function validateTestProjectOwnership(
	testFiles: readonly string[],
	rootDir?: string,
): Promise<void>;
