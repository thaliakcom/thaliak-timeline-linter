import { TextDocument } from 'vscode-languageserver-textdocument';
import * as yaml from 'yaml';
import { LinterOptions, ThaliakTimelineLinterSettings } from './server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connection, TextDocumentIdentifier } from 'vscode-languageserver';

// Based on https://github.com/microsoft/vscode/blob/main/extensions/json-language-features/server/src/languageModelCache.ts

export interface ParserCache {
    get(document: TextDocument | TextDocumentIdentifier): yaml.Document | null;
    onDocumentRemoved(document: TextDocument): void;
    getLinterOptions(settings: ThaliakTimelineLinterSettings): LinterOptions;
    dispose(): void;
}

export function getParserCache(maxEntries: number, cleanupIntervalTimeInSec: number): ParserCache {
    let languageModels: { [uri: string]: { version: number; languageId: string; cTime: number; ast: yaml.Document, isRaidData: boolean } } = {};
    let nModels = 0;
    let options: LinterOptions | undefined;

    let cleanupInterval: NodeJS.Timeout | undefined = undefined;
    if (cleanupIntervalTimeInSec > 0) {
        cleanupInterval = setInterval(() => {
            const cutoffTime = Date.now() - cleanupIntervalTimeInSec * 1000;
            const uris = Object.keys(languageModels);
            for (const uri of uris) {
                const languageModelInfo = languageModels[uri];
                if (languageModelInfo.cTime < cutoffTime) {
                    delete languageModels[uri];
                    nModels--;
                }
            }
        }, cleanupIntervalTimeInSec * 1000);
    }

    return {
        get(document: TextDocument | TextDocumentIdentifier): yaml.Document | null {
            const languageModelInfo = languageModels[document.uri];
            const version = 'version' in document ? document.version : languageModelInfo.version;
            const languageId = 'languageId' in document ? document.languageId : languageModelInfo.languageId;
            if (languageModelInfo && languageModelInfo.version === version && languageModelInfo.languageId === languageId && languageModelInfo.isRaidData) {
                languageModelInfo.cTime = Date.now();
                return languageModelInfo.ast;
            }

            if (!('getText' in document)) {
                return null;
            }

            const yamlDocument = yaml.parseDocument(document.getText());
            languageModels[document.uri] = { ast: yamlDocument, version, languageId, cTime: Date.now(), isRaidData: isRaidData(yamlDocument.toJS()) };
            console.log('Adding', document.uri);
            if (!languageModelInfo) {
                nModels++;
            }

            if (nModels > maxEntries) {
                let oldestTime = Number.MAX_VALUE;
                let oldestUri = null;
                for (const uri in languageModels) {
                    const languageModelInfo = languageModels[uri];
                    if (languageModelInfo.cTime < oldestTime) {
                        oldestUri = uri;
                        oldestTime = languageModelInfo.cTime;
                    }
                }
                if (oldestUri) {
                    console.log('Removing', oldestUri, '(maxEntries reached)');
                    delete languageModels[oldestUri];
                    nModels--;
                }
            }
            return yamlDocument;
        },
        onDocumentRemoved(document: TextDocument) {
            const uri = document.uri;
            if (languageModels[uri]) {
                console.log('Removing', uri, '(onDocumentRemoved)');
                delete languageModels[uri];
                nModels--;
            }
        },
        getLinterOptions(settings: ThaliakTimelineLinterSettings): LinterOptions {
            if (options == null) {
                options = { ...settings };
            }

            if (options.enums == null) {
                const raidDataDocument = Object.entries(languageModels).find(x => x[1].isRaidData);

                if (raidDataDocument == null) {
                    console.log('No raid document found');
                    return options;
                }

                const uri = raidDataDocument[0];
                const isFileProtocol = uri.replace('file://', '');
                let enumsPath = uri;

                if (isFileProtocol) {
                    enumsPath = enumsPath.slice(7);
                }

                enumsPath = path.join(enumsPath, '../..', 'enums');

                if (!fs.existsSync(enumsPath)) {
                    console.log(`Failed to parse enums. No enums found above '${uri}' (at: '${enumsPath}')`);
                    return options;
                }

                options.enumsPath = enumsPath;

                options.enums = {
                    common: yaml.parse(fs.readFileSync(path.join(enumsPath, 'common.yaml')).toString()),
                    'damage-types': yaml.parse(fs.readFileSync(path.join(enumsPath, 'damage-types.yaml')).toString()),
                    expansions: yaml.parse(fs.readFileSync(path.join(enumsPath, 'expansions.yaml')).toString()),
                    'mechanic-shapes': yaml.parse(fs.readFileSync(path.join(enumsPath, 'mechanic-shapes.yaml')).toString()),
                    'mechanic-types': yaml.parse(fs.readFileSync(path.join(enumsPath, 'mechanic-types.yaml')).toString()),
                    'status-types': yaml.parse(fs.readFileSync(path.join(enumsPath, 'status-types.yaml')).toString()),
                    terms: yaml.parse(fs.readFileSync(path.join(enumsPath, 'terms.yaml')).toString())
                };
            }

            Object.assign(options, settings);

            return options;
        },
        dispose() {
            if (typeof cleanupInterval !== 'undefined') {
                console.log('Disposing all documents');
                clearInterval(cleanupInterval);
                cleanupInterval = undefined;
                languageModels = {};
                nModels = 0;
            }
        }
    };
}

function isRaidData(json: Record<string, unknown>): boolean {
    return typeof json.id === 'number'
        && typeof json.patch === 'string'
        && json.by != null
        && typeof json.boss === 'string'
        && typeof json.description === 'string';
}
