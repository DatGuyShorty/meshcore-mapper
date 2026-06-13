export type CoverageOverlayLayer = {
  _blobUrl?: string | null;
} & Record<string, any>;

export function createCoverageStore<TCoverageResult = any>() {
  let coverageLayers: CoverageOverlayLayer[] = [];
  let coverageResults: TCoverageResult[] = [];

  return {
    getCoverageLayers(): CoverageOverlayLayer[] {
      return coverageLayers;
    },
    setCoverageLayers(nextLayers: CoverageOverlayLayer[]): void {
      coverageLayers = Array.isArray(nextLayers) ? nextLayers : [];
    },
    getCoverageResults(): TCoverageResult[] {
      return coverageResults;
    },
    setCoverageResults(nextResults: TCoverageResult[]): void {
      coverageResults = Array.isArray(nextResults) ? nextResults : [];
    },
    clear(): void {
      coverageLayers = [];
      coverageResults = [];
    },
  };
}
