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

await fetchFile('src/types/enums.ts', './server/src/types/enums.ts', 'thaliak');
