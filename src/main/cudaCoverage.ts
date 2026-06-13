import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import {
  parseCudaCoveragePayload,
  parseCudaOptimizerPayload,
  serializeBuildingPayload,
  serializeFoliagePayload,
  type AnyRecord,
} from './cudaSchemas.js';

type JobKey = 'probe' | 'coverage' | 'optimizer';
type PythonChild = ReturnType<typeof spawn>;
type PythonLineState = { lastMessage: any };
type PythonLineCallbacks = {
  onProgress?: ((msg: any) => void) | null;
  onStrayLine?: ((line: string) => void) | null;
};
type RunPythonOptions = {
  jobKey?: JobKey;
  onProgress?: ((msg: any) => void) | null;
};

const currentChildren: Record<JobKey, PythonChild | null> = {
  probe: null,
  coverage: null,
  optimizer: null,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerCudaCoverageHandlers(ipcMain: IpcMain, appRoot: string): void {
  // When packaged, scripts live in app.asar.unpacked/ on the real filesystem
  // because Python (an external subprocess) cannot read files inside app.asar.
  const scriptRoot = app?.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : appRoot;
  const helperPath = path.join(scriptRoot, 'scripts', 'cuda_coverage.py');

  ipcMain.handle('cuda-coverage-probe', async () => {
    try {
      return await _runPython(helperPath, ['--probe'], { jobKey: 'probe' });
    } catch (err) {
      return { available: false, reason: errorMessage(err) };
    }
  });

  ipcMain.handle('cuda-coverage-cancel', () => {
    _cancelChild('coverage');
  });

  ipcMain.handle('cuda-optimizer-cancel', () => {
    _cancelChild('optimizer');
  });

  ipcMain.handle('cuda-coverage-compute', async (_event: IpcMainInvokeEvent, payload: AnyRecord) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcore-cuda-'));
    try {
      const gridPath = path.join(tmpDir, 'grid_elevs.f32');
      const outPath = path.join(tmpDir, 'coverage.rgba');
      const signalPath = path.join(tmpDir, 'coverage_signal.f32');
      const losPath = path.join(tmpDir, 'coverage_los.f32');
      const paramsPath = path.join(tmpDir, 'params.json');
      const { gridElevs, gridRes, elevRes } = parseCudaCoveragePayload(payload);

      fs.writeFileSync(gridPath, Buffer.from(gridElevs.buffer, gridElevs.byteOffset, gridElevs.byteLength));
      const foliage = serializeFoliagePayload(payload.foliage, 'foliage');
      const buildings = serializeBuildingPayload(payload.buildings, 'buildings');
      fs.writeFileSync(paramsPath, JSON.stringify({
        gridPath,
        outPath,
        signalPath,
        losPath,
        gridRes,
        ELEV_RES: elevRes,
        rep: payload.rep,
        txElev: payload.txElev,
        latMin: payload.latMin,
        latMax: payload.latMax,
        lonMin: payload.lonMin,
        lonMax: payload.lonMax,
        radiusKm: payload.radiusKm,
        rxHeight: payload.rxHeight,
        effectiveSens: payload.effectiveSens,
        useLos: payload.useLos,
        useFresnel: payload.useFresnel,
        useDeygout: Boolean(payload.useDeygout || payload.diffractionModel === 'deygout'),
        useGroundReflection: Boolean(payload.useGroundReflection),
        reflectionModel: payload.reflectionModel === 'six-ray' || payload.reflectionModel === 'facade'
          ? payload.reflectionModel
          : 'two-ray',
        reflectionCoeff: Number.isFinite(payload.reflectionCoeff) ? payload.reflectionCoeff : 0.7,
        sideReflectionCoeff: Number.isFinite(payload.sideReflectionCoeff) ? payload.sideReflectionCoeff : 0.35,
        reflectionCorridorWidthM: Number.isFinite(payload.reflectionCorridorWidthM) ? payload.reflectionCorridorWidthM : 24,
        useFoliage: payload.useFoliage,
        useBuildings: payload.useBuildings,
        profileTargetSpacingM: payload.profileTargetSpacingM,
        profileMaxSamples: payload.profileMaxSamples,
        foliage,
        buildings,
      }));

      const result = await _runPython(helperPath, ['--compute', paramsPath], {
        jobKey: 'coverage',
        onProgress: stage => {
          try {
            _event.sender.send('cuda-coverage-progress', stage);
          } catch {
            // Renderer may already be gone/cancelled.
          }
        },
      });
      if (!result.ok) return result;

      return {
        ...result,
        rgba: new Uint8Array(fs.readFileSync(outPath)),
        signalGrid: _readFloat32File(signalPath),
        losGrid: fs.existsSync(losPath) ? _readFloat32File(losPath) : undefined,
      };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  ipcMain.handle('cuda-optimizer-compute', async (_event: IpcMainInvokeEvent, payload: AnyRecord) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcore-cuda-opt-'));
    try {
      const evalElevsPath = path.join(tmpDir, 'eval_elevs.f32');
      const candidateCoordsPath = path.join(tmpDir, 'candidate_coords.f32');
      const candidateElevsPath = path.join(tmpDir, 'candidate_elevs.f32');
      const paramsPath = path.join(tmpDir, 'params.json');

      const {
        opts,
        txParams,
        candidateCount,
        evalRes,
        nRepeaters,
        evalElevs,
        candidateElevs,
        candidateCoords,
        bounds,
      } = parseCudaOptimizerPayload(payload);

      fs.writeFileSync(evalElevsPath, Buffer.from(evalElevs.buffer, evalElevs.byteOffset, evalElevs.byteLength));
      fs.writeFileSync(candidateElevsPath, Buffer.from(candidateElevs.buffer, candidateElevs.byteOffset, candidateElevs.byteLength));
      fs.writeFileSync(candidateCoordsPath, Buffer.from(candidateCoords.buffer, candidateCoords.byteOffset, candidateCoords.byteLength));

      const foliage = serializeFoliagePayload(opts.foliage, 'optimizer foliage');
      const buildings = serializeBuildingPayload(opts.buildings, 'optimizer buildings');
      delete opts.foliage;
      delete opts.buildings;

      fs.writeFileSync(paramsPath, JSON.stringify({
        evalElevsPath,
        candidateCoordsPath,
        candidateElevsPath,
        candidateCount,
        evalRes,
        nRepeaters,
        txParams,
        opts,
        bounds,
        rxSens: opts.rxSens,
        fadeMargin: opts.fadeMargin,
        foliage,
        buildings,
      }));

      return await _runPython(helperPath, ['--optimize', paramsPath], {
        jobKey: 'optimizer',
        onProgress: stage => {
          try {
            _event.sender.send('cuda-optimizer-progress', stage);
          } catch {
            // Renderer may already be gone/cancelled.
          }
        },
      });
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

function _readFloat32File(filePath: string): Float32Array {
  const bytes = fs.readFileSync(filePath);
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  return new Float32Array(view);
}

/**
 * Pull progress + result messages out of a chunk of Python helper stdout.
 *
 * Lines that are valid JSON with `type === 'progress'` invoke `onProgress`.
 * Other valid-JSON objects become the candidate `lastMessage` (the helper
 * emits its final result on the last line of stdout).
 *
 * Non-JSON lines are tolerated and surfaced via `onStrayLine` so the caller
 * can log them without aborting. Earlier versions rejected the whole job the
 * moment the helper printed an unexpected log line.
 */
export function _consumePythonLines(
  lines: string[],
  state: PythonLineState,
  { onProgress = null, onStrayLine = null }: PythonLineCallbacks = {}
): void {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      onStrayLine?.(trimmed);
      continue;
    }
    if (msg && typeof msg === 'object' && msg.type === 'progress') {
      onProgress?.(msg);
    } else {
      state.lastMessage = msg;
    }
  }
}

function _runPython(helperPath: string, args: string[], { jobKey = 'probe', onProgress = null }: RunPythonOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (currentChildren[jobKey]) {
      reject(new Error(`Python CUDA ${jobKey} job already running`));
      return;
    }
    const python = process.env.MESHCORE_PYTHON || process.env.PYTHON || 'python';
    const child = spawn(python, [helperPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentChildren[jobKey] = child;
    let stdout = '';
    let stderr = '';
    const parseState: PythonLineState = { lastMessage: null };
    const stray = (line: string): void => console.warn(`[cuda] ${jobKey}: stray non-JSON line ignored: ${line.slice(0, 200)}`);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? '';
      _consumePythonLines(lines, parseState, { onProgress, onStrayLine: stray });
    });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      if (currentChildren[jobKey] === child) currentChildren[jobKey] = null;
      reject(err);
    });
    child.on('close', code => {
      if (currentChildren[jobKey] === child) currentChildren[jobKey] = null;
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python CUDA helper exited ${code}`));
        return;
      }
      const trailing = stdout.trim();
      if (trailing) _consumePythonLines([trailing], parseState, { onProgress, onStrayLine: stray });
      resolve(parseState.lastMessage ?? {});
    });
  });
}

function _cancelChild(jobKey: JobKey): void {
  const child = currentChildren[jobKey];
  if (!child) return;
  child.kill();
  currentChildren[jobKey] = null;
}
