// Game data from the game files through `ironworks-cli` (https://github.com/thaliakcom/ironworks-cli),
// cached with the same layout as `thaliak/.cache`. Ported from `thaliak/src/eleventy/utility/ironworks.ts`.
import * as childProcess from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as paths from 'path';
import { Status as GameStatus, Action as GameAction, BNpcBase as GameBNpcBase, ModelSkeleton as GameModelSkeleton } from './types/ironworks.js';

/** The game data settings, which the client passes in `initializationOptions.ironworks`. */
export interface IronworksOptions {
    /** The `ironworks-cli` executable. */
    executable: string;
    /** The FFXIV install directory. Empty turns game data off. */
    gameDirectory: string;
    /** The directory the results are cached in. */
    cachePath: string;
    /** Whether `cachePath` is the extension's own. A cache set by the user is never cleared. */
    ownsCache: boolean;
}

/** An action's whole cast in ms: up to where its animation starts, plus the extra cast time that ends with the hit. */
export function castTimeOf(game: GameAction): number {
    return (game.cast100ms + (game.extraCastTime100ms ?? 0)) * 100;
}

/** An icon in the cache. */
export interface GameIcon {
    /** The absolute path of the PNG. */
    path: string;
    data: Buffer;
}

/** The cache directory of each subcommand, as in `thaliak/.cache`. */
const DIRECTORIES = {
    Status: 'status',
    Action: 'actions',
    BNpcBase: 'bnpc-bases',
    ModelSkeleton: 'model-skeletons',
    icon: 'icons'
} as const;

type Subcommand = keyof typeof DIRECTORIES;

/** The file in the cache that holds the game version the cached `status` and `actions` were read from. */
const VERSION_FILE = 'game-version';

/** Maximum number of ironworks-cli processes that may run at the same time. */
const MAX_PROCESSES = os.availableParallelism();
let runningProcesses = 0;
const waitingProcesses: (() => void)[] = [];

let options: IronworksOptions | null = null;
let warn: (message: string) => void = () => {};
/** Whether the CLI works with the game directory. Probed once, on the first request. */
let ready: Promise<boolean> | null = null;
/** The current schema version of each sheet's output, by sheet name (`ironworks-cli --schema-version`). Set by the probe. */
let schemaVersions: Record<string, number> = {};
/** The results by subcommand and ID (`null` if there are none), for the lifetime of the server. Requests for the same ID share one call. */
const results = new Map<string, Promise<Buffer | null>>();

/** Sets the game data settings. `report` shows a warning to the user; it's called at most once. */
export function configureIronworks(ironworksOptions: IronworksOptions | undefined, report: (message: string) => void): void {
    options = ironworksOptions ?? null;
    warn = report;
}

async function fetchJson<T>(subcommand: Exclude<Subcommand, 'icon'>, id: number): Promise<T | null> {
    const data = await fetch(subcommand, id);

    return data != null ? JSON.parse(data.toString('utf-8')) as T : null;
}

/** The game data of the status with the given ID, or `null` if there is none (or game data is off). */
export function getGameStatus(id: number): Promise<GameStatus | null> {
    return fetchJson('Status', id);
}

/** The game data of the action with the given ID, or `null` if there is none (or game data is off). */
export function getGameAction(id: number): Promise<GameAction | null> {
    return fetchJson('Action', id);
}

/** The game data of the battle NPC with the given BNpcBase ID, or `null` if there is none (or game data is off). */
export function getGameBNpcBase(id: number): Promise<GameBNpcBase | null> {
    return fetchJson('BNpcBase', id);
}

/** The game data of the model skeleton with the given ID, or `null` if there is none (or game data is off). */
export function getGameModelSkeleton(id: number): Promise<GameModelSkeleton | null> {
    return fetchJson('ModelSkeleton', id);
}

/** The icon with the given ID, or `null` if there is none (or game data is off). */
export async function getGameIcon(id: number): Promise<GameIcon | null> {
    const data = await fetch('icon', id);

    return data != null ? { path: cacheFile('icon', id), data } : null;
}

function fetch(subcommand: Subcommand, id: number): Promise<Buffer | null> {
    const key = `${subcommand}:${id}`;
    let result = results.get(key);

    if (result == null) {
        result = load(subcommand, id);
        results.set(key, result);
    }

    return result;
}

function cacheFile(subcommand: Subcommand, id: number): string {
    return paths.join(options!.cachePath, DIRECTORIES[subcommand], `${id}.${subcommand === 'icon' ? 'png' : 'json'}`);
}

/** Returns the cached result for the given subcommand and ID, or runs ironworks-cli to get it. */
async function load(subcommand: Subcommand, id: number): Promise<Buffer | null> {
    if (!await (ready ??= probe())) {
        return null;
    }

    const path = cacheFile(subcommand, id);

    try {
        const cached = await fs.readFile(path);

        if (subcommand === 'icon' || isCurrent(subcommand, cached)) {
            return cached;
        }

        // Written by an older ironworks-cli, so it may lack fields: fetched again below.
        await fs.rm(path, { force: true });
    } catch {
        // Not cached yet.
    }

    let output: Buffer;

    try {
        output = await limitProcesses(() => run([subcommand, String(id), '-g', options!.gameDirectory]));
    } catch {
        // No such row or icon.
        return null;
    }

    try {
        await fs.mkdir(paths.dirname(path), { recursive: true });
        // Written to a temporary file first so that other processes never read a partially written file.
        const temporaryPath = `${path}.${process.pid}.tmp`;
        // Copied, since this @types/node's Buffer doesn't type-check as an ArrayBufferView under TypeScript 6.
        await fs.writeFile(temporaryPath, new Uint8Array(output));
        await fs.rename(temporaryPath, path);
    } catch (e) {
        // A read-only cache still works for this session, from memory.
        console.log(`Couldn't cache ${path}: ${e}`);
    }

    return output;
}

/** Whether a cached row is at least as new as the output of the ironworks-cli in use. A newer one is fine. */
function isCurrent(sheet: Exclude<Subcommand, 'icon'>, row: Buffer): boolean {
    try {
        const version = (JSON.parse(row.toString('utf-8')) as { schemaVersion?: number }).schemaVersion;

        return version != null && version >= (schemaVersions[sheet] ?? 0);
    } catch {
        return false;
    }
}

/**
 * Checks that the CLI runs and reads the game, warning the user if it doesn't. Clears the cached
 * `status` and `actions` of the extension's own cache after a game update, since those can change.
 */
async function probe(): Promise<boolean> {
    if (options == null || options.gameDirectory === '') {
        return false;
    }

    let output: string;

    try {
        output = (await run(['-v', '-g', options.gameDirectory])).toString('utf-8');
    } catch (e) {
        warn(`Couldn't run ironworks-cli ("${options.executable}"): ${e instanceof Error ? e.message : e}. Install it or set thaliak-timeline-linter.ironworksPath, then restart the language server.`);
        return false;
    }

    const version = /Final Fantasy XIV v(\S+)/.exec(output)?.[1];

    if (version == null) {
        warn(`ironworks-cli couldn't read the game in "${options.gameDirectory}". Check thaliak-timeline-linter.gameDirectory, then restart the language server.`);
        return false;
    }

    try {
        schemaVersions = JSON.parse((await run(['--schema-version'])).toString('utf-8')) as Record<string, number>;
    } catch (e) {
        warn(`ironworks-cli ("${options.executable}") is outdated: it has no --schema-version. Install the latest version, then restart the language server. (${e instanceof Error ? e.message : e})`);
        return false;
    }

    if (options.ownsCache) {
        await expireCache(version);
    }

    return true;
}

/** Deletes the cached sheet rows (everything but icons) if they were read from another game version than `version`. */
async function expireCache(version: string): Promise<void> {
    const versionFile = paths.join(options!.cachePath, VERSION_FILE);
    const cachedVersion = await fs.readFile(versionFile, 'utf-8').catch(() => null);

    if (cachedVersion === version) {
        return;
    }

    for (const subcommand of ['Status', 'Action', 'BNpcBase', 'ModelSkeleton'] as const) {
        await fs.rm(paths.join(options!.cachePath, DIRECTORIES[subcommand]), { recursive: true, force: true });
    }

    await fs.mkdir(options!.cachePath, { recursive: true });
    await fs.writeFile(versionFile, version);
}

/** Runs ironworks-cli once with `args` and returns its output. Rejects with its error message if it fails. */
function run(args: string[]): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        childProcess.execFile(options!.executable, args, { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => {
            if (e == null) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.toString('utf-8').trim() || e.message));
            }
        });
    });
}

/** Runs {@link task} as soon as fewer than {@link MAX_PROCESSES} tasks started by this function are running. */
async function limitProcesses<T>(task: () => Promise<T>): Promise<T> {
    if (runningProcesses < MAX_PROCESSES) {
        runningProcesses++;
    } else {
        // The finishing task hands its slot over directly, so runningProcesses stays the same.
        await new Promise<void>(resolve => waitingProcesses.push(resolve));
    }

    try {
        return await task();
    } finally {
        const next = waitingProcesses.shift();

        if (next != null) next();
        else runningProcesses--;
    }
}
