export interface NodeUnitTestBuild {
	readonly format: 'esm';
	readonly target: string;
	readonly sourcemap: string;
	readonly external: readonly string[];
	readonly loader: Readonly<Record<string, string>>;
}

export const nodeUnitTestRunner: string;
export const nodeUnitTestOutput: string;
export const nodeUnitTestBuild: NodeUnitTestBuild;
export function createNodeTestArguments(
	outputDirectory: string,
	coverageFile?: string,
	rootDir?: string,
): string[];
