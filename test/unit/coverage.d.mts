export interface LcovBranch {
	readonly line: number;
	readonly block: string;
	readonly branch: string;
	readonly count: number;
}

export interface LcovRecord {
	readonly file: string;
	readonly branches: readonly LcovBranch[];
}

export interface ChangedBranchSpan {
	readonly startLine: number;
	readonly endLine: number;
	readonly kind: string;
}

export interface CoverageRuntime {
	readonly id: string;
	readonly requiredPlatforms: readonly string[];
	readonly productionSourceRoots: readonly string[];
}

export interface CoverageFragmentDescriptor {
	readonly runtimeId: string;
	readonly platform: string;
	readonly commit: string;
	readonly file: string;
}

export const coverageExclusions: readonly never[];
export const coverageRuntimes: readonly CoverageRuntime[];
export function parseLcov(contents: string): Map<string, LcovRecord>;
export function readCoverageFragment(fragmentFile: string): Promise<Map<string, LcovRecord>>;
export function parseChangedLines(diffText: string): Map<string, Set<number>>;
export function findProductionSourceRuntime(
	filePath: string,
	runtimes?: readonly CoverageRuntime[],
): CoverageRuntime;
export function findChangedBranchSpans(
	filePath: string,
	sourceText: string,
	changedLines: ReadonlySet<number>,
): ChangedBranchSpan[];
export function validateCoverageFragmentDescriptors(
	descriptors: readonly CoverageFragmentDescriptor[],
	expectedCommit: string,
	runtimes?: readonly CoverageRuntime[],
): Map<string, CoverageFragmentDescriptor>;
export function evaluateChangedBranchRecords(options: {
	readonly changedBranches: readonly {
		readonly file: string;
		readonly spans: readonly ChangedBranchSpan[];
	}[];
	readonly fragmentRecords: ReadonlyMap<string, ReadonlyMap<string, LcovRecord>>;
	readonly runtimes?: readonly CoverageRuntime[];
	readonly exclusions?: readonly {
		readonly file: string;
		readonly startLine: number;
		readonly endLine: number;
		readonly reason: string;
	}[];
}): number;
