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
