# Go to Definition / hover broken on timeline IDs

## Focus

Investigate why Go to Definition and hover no longer resolve `id:` values of timeline items.

## Actions

- Reproduced with a scratch script (`/tmp/ttl-repro`) that calls `hoverProvider` and `definitionProvider` directly on `m2s.yaml`: with LF line endings both resolve; with the same file converted to CRLF both return `null`, and the resolver logs `found timeline action 'call-me-honey<CR>'`.
- Root cause: `getKeyValueAt` (`server/src/util.ts`) cuts the value at the last `\n` of the rest of the line, so on CRLF lines the trailing `\r` stays in the ID. `vscode-languageserver-textdocument` 1.0.11 doesn't clamp `Infinity` positions before the EOL, so `getLineAt` hands it the `\r\n`. The same applies to every key resolved through `getKeyValueAt` (`id`, `action`, `mechanic`, `shape`, `type`).
- 11 of 147 data files are CRLF, among them `uwu.yaml`, `top.yaml`, `umad.yaml`, `p9s.yaml` and `enums/common.yaml`.
- Fixed: `getKeyValueAt` now strips a trailing `\r?\n` from `lineAfter` instead of slicing at `lastIndexOf('\n')`, and derives the range end from the stripped value. Verified with the scratch repro (LF and CRLF both resolve hover and definition) and `tsc -p server --noEmit`. Not yet tested in a running VS Code instance.

## Status

Completed.
