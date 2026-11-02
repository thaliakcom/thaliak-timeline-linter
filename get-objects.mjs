import { exec } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

/* eslint-disable */

async function fetchFile(from, to, repo) {
    const call = `gh api "https://api.github.com/repos/thaliakcom/${repo}/contents/${from}" -H "Accept: application/vnd.github.v4.raw"`;
    exec(call, (error, stdout, stderr) => {
        if (error != null || stderr.length > 0) {
            throw new Error(`Error calling "${call}": ${error ?? stderr}`);
        }

        return writeFile(to, stdout, { encoding: 'utf-8' });
    });
}

await fetchFile('src/types/enum-schema.ts', './server/src/types/enum-schema.ts', 'thaliak');
await fetchFile('src/types/raids.ts', './server/src/types/raids.ts', 'thaliak');
await fetchFile('src/types/graphing.ts', './server/src/types/graphing.ts', 'thaliak');
await fetchFile('src/types/enums.ts', './server/src/types/enums.ts', 'thaliak');
await fetchFile('src/types/ironworks.ts', './server/src/types/ironworks.ts', 'thaliak');
await fetchFile('src/types/jobs.ts', './server/src/types/jobs.ts', 'thaliak');
// The `.diagram` parser and compiler, at the same relative paths as in thaliak, so that their imports hold.
await fetchFile('src/utility/diagram-ddl/parse.ts', './server/src/utility/diagram-ddl/parse.ts', 'thaliak');
await fetchFile('src/utility/diagram-ddl/compile.ts', './server/src/utility/diagram-ddl/compile.ts', 'thaliak');
await fetchFile('src/utility/diagram-ddl/seek.ts', './server/src/utility/diagram-ddl/seek.ts', 'thaliak');
await fetchFile('src/utility/diagram-ddl/placeholders.ts', './server/src/utility/diagram-ddl/placeholders.ts', 'thaliak');
await fetchFile('src/utility/diagram-sizing.ts', './server/src/utility/diagram-sizing.ts', 'thaliak');
await fetchFile('src/utility/margin.ts', './server/src/utility/margin.ts', 'thaliak');
await fetchFile('src/components/diagram/render/effects/presets.ts', './server/src/components/diagram/render/effects/presets.ts', 'thaliak');
