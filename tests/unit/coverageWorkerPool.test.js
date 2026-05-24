import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCoverageWorkerBands,
  createCoverageWorkerPoolJob,
} from '../../src/coverageWorkerPool.js';

describe('coverage worker pool', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    globalThis.Worker = class MockWorker {
      terminate() {}

      postMessage(msg) {
        queueMicrotask(() => {
          const rowCount = msg.rowEnd - msg.rowStart;
          this.onmessage?.({
            data: {
              type: 'done',
              rowStart: msg.rowStart,
              rowEnd: msg.rowEnd,
              rgbaBuffer: new ArrayBuffer(rowCount * msg.gridRes * 4),
              stats: { computeMs: 1, insidePoints: rowCount * msg.gridRes },
            },
          });
        });
      }
    };
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  it('counts only launched row bands so odd grids resolve', async () => {
    const job = createCoverageWorkerPoolJob({
      gridRes: 17,
      gridElevs: new Float32Array(4),
    }, { workerCount: 8 });

    const result = await job.promise;

    expect(job.workerCount).toBe(6);
    expect(result.stats.workerCount).toBe(6);
    expect(result.rgba).toHaveLength(17 * 17 * 4);
  });

  it('builds non-empty worker bands for uneven row splits', () => {
    expect(buildCoverageWorkerBands(17, 8)).toEqual([
      { rowStart: 0, rowEnd: 3 },
      { rowStart: 3, rowEnd: 6 },
      { rowStart: 6, rowEnd: 9 },
      { rowStart: 9, rowEnd: 12 },
      { rowStart: 12, rowEnd: 15 },
      { rowStart: 15, rowEnd: 17 },
    ]);
  });
});
