import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

/* eslint-disable */

/** The files to fetch, as [path in the repository, path in the linter, repository]. */
const FILES = [
    ['src/types/enum-schema.ts', './server/src/types/enum-schema.ts', 'thaliak'],
    ['src/types/raids.ts', './server/src/types/raids.ts', 'thaliak'],
    ['src/types/graphing.ts', './server/src/types/graphing.ts', 'thaliak'],
    // `src/types/enums.ts` isn't fetched: thaliak generates it and doesn't commit it. The linter keeps its own copy.
    ['src/types/ironworks.ts', './server/src/types/ironworks.ts', 'thaliak'],
    ['src/types/jobs.ts', './server/src/types/jobs.ts', 'thaliak'],
    // The `.diagram` parser and compiler, at the same relative paths as in thaliak, so that their imports hold.
    ['src/utility/diagram-ddl/parse.ts', './server/src/utility/diagram-ddl/parse.ts', 'thaliak'],
    ['src/utility/diagram-ddl/compile.ts', './server/src/utility/diagram-ddl/compile.ts', 'thaliak'],
    ['src/utility/diagram-ddl/seek.ts', './server/src/utility/diagram-ddl/seek.ts', 'thaliak'],
    ['src/utility/diagram-ddl/placeholders.ts', './server/src/utility/diagram-ddl/placeholders.ts', 'thaliak'],
    ['src/utility/diagram-sizing.ts', './server/src/utility/diagram-sizing.ts', 'thaliak'],
    ['src/utility/diagram-defaults.ts', './server/src/utility/diagram-defaults.ts', 'thaliak'],
    ['src/utility/diagram-enums.ts', './server/src/utility/diagram-enums.ts', 'thaliak'],
    ['src/utility/margin.ts', './server/src/utility/margin.ts', 'thaliak'],
    ['src/eleventy/utility/shape-icons.ts', './server/src/utility/shape-icons.ts', 'thaliak'],
    ['src/components/diagram/render/effects/presets.ts', './server/src/components/diagram/render/effects/presets.ts', 'thaliak']
];

/** Fetches one file's raw contents from GitHub through the `gh` CLI. */
async function fetchFile(from, repo) {
    const { stdout } = await promisify(execFile)('gh', ['api', `https://api.github.com/repos/thaliakcom/${repo}/contents/${from}`, '-H', 'Accept: application/vnd.github.v4.raw'], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
}

// Everything is fetched before anything is written, so that a failure leaves the linter's copies as they were.
const results = await Promise.allSettled(FILES.map(([from, , repo]) => fetchFile(from, repo)));
const failures = results.flatMap((result, i) => result.status === 'rejected' ? [`${FILES[i][2]}/${FILES[i][0]}: ${result.reason?.stderr?.trim() || result.reason}`] : []);

if (failures.length > 0) {
    console.error(`Nothing was written. These files couldn't be fetched:\n${failures.join('\n')}`);
    process.exit(1);
}

await Promise.all(FILES.map(([, to], i) => writeFile(to, results[i].value, { encoding: 'utf-8' })));
console.log(`Fetched ${FILES.length} files.`);
