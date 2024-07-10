import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import * as yaml from 'yaml';
import { LinterInput } from './linter';
import { LinterOptions } from './server';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getAction, getEntry, getRange, ICONS, ID_REGEX, perPrefix, PLACEHOLDER_REGEX } from './util';
import { UnprocessedRaidData } from './types/raids';

function addDiagnostic(diagnostics: Diagnostic[], settings: LinterOptions, diagnostic: Diagnostic): boolean {
    diagnostic.source = 'thaliak-timeline-linter';

    diagnostics.push(diagnostic);

    if (diagnostic.relatedInformation != null) {
        for (const relatedInformation of diagnostic.relatedInformation) {
            diagnostics.push({
                severity: DiagnosticSeverity.Hint,
                message: relatedInformation.message,
                range: relatedInformation.location.range,
                relatedInformation: [{
                    message: 'The original problem comes from here.',
                    location: { uri: relatedInformation.location.uri, range: diagnostic.range }
                }]
            });
        }
    }

    return diagnostics.length < settings.maxNumberOfProblems;
}

export function mustHaveMechanic({ diagnostics, textDocument, document, options }: LinterInput): void {
    const actions = document.get('actions');

    if (yaml.isMap(actions)) {
        for (const action of actions.items) {
            if (yaml.isScalar(action.key) && action.key.range != null && yaml.isMap(action.value) && !action.value.has('mechanic')) {

                if (!addDiagnostic(diagnostics, options, {
                    severity: DiagnosticSeverity.Error,
                    message: `Every action must specify the 'mechanic' field.\nIf no suitable mechanic type exists, add one to 'enums/mechanic-types.yaml'.`,
                    range: getRange(textDocument, action.key.range)
                })) {
                    return;
                }
            }
        }
    }
}

export function mustMaybeHavePlayers({ diagnostics, textDocument, document, options }: LinterInput): void {
    if (options.enums['mechanic-types'] == null) {
        return;
    }

    const actions = document.get('actions');

    if (yaml.isMap(actions)) {
        for (const action of actions.items) {
            if (yaml.isScalar(action.key) && action.key.range != null && yaml.isMap(action.value)) {
                const mechanic = action.value.get('mechanic', true);
                const damage = getEntry(action.value, 'damage');
                const hasDamage = damage != null && yaml.isScalar(damage.value) && damage.value.value as number > 0;

                if (!yaml.isScalar(mechanic)) {
                    continue;
                }

                const mechanicType = options.enums['mechanic-types'].yaml[mechanic.value as string];

                if (mechanicType == null) {
                    continue;
                }

                if (mechanicType.players == null && hasDamage && !action.value.has('players')) {
                    if (!addDiagnostic(diagnostics, options, {
                        severity: DiagnosticSeverity.Error,
                        message: `The 'players' field must be set for mechanic type '${mechanic.value}'`,
                        range: getRange(textDocument, action.key.range),
                        relatedInformation: [
                            {
                                location: { uri: textDocument.uri, range: getRange(textDocument, damage.key.range!) },
                                message: `Or remove this 'damage' field to avoid having to set 'players'.`
                            }
                        ]
                    })) {
                        return;
                    }
                }
            }
        }
    }
}

export function mustSpecifyPartyHP({ diagnostics, textDocument, document, options }: LinterInput): void {
    const wip = document.get('wip');

    if ((wip == null || wip === false) && !document.has('party_hp')) {
        addDiagnostic(diagnostics, options, {
            severity: DiagnosticSeverity.Error,
            message: `Field 'party_hp' is required in non-work-in-progress timelines.`,
            range: { start: textDocument.positionAt(0), end: textDocument.positionAt(1) }
        });
    }
}

export function mustHaveAtLeastOneAuthor({ diagnostics, textDocument, document, options }: LinterInput): void {
    const by = getEntry(document.contents as yaml.YAMLMap, 'by');

    if (by != null && ((yaml.isSeq(by.value) && !by.value.items.some(x => !yaml.isMap(x) || x.get('role') === 'author')) || yaml.isMap(by.value) && by.value.get('role') !== 'author')) {
        addDiagnostic(diagnostics, options, {
            severity: DiagnosticSeverity.Error,
            message: `Field 'by' must contain at least one contributor with the 'author' role.`,
            range: getRange(textDocument, by.key.range!)
        });
    }
}

export function idMustBeValid({ diagnostics, textDocument, document, options }: LinterInput): void {
    const matches: { text: string, range: [number, number] }[] = [];

    for (const match of textDocument.getText().matchAll(PLACEHOLDER_REGEX)) {
        matches.push({ text: match[2], range: [match.index! + match[1].length, match.index! + match[1].length + match[2].length] });
    }

    for (const match of textDocument.getText().matchAll(ID_REGEX)) {
        const delta = match[0].length - match[1].length;
        matches.push({ text: `a:${match[1]}`, range: [match.index! + delta, match.index! + match[0].length] });
    }

    const json = document.toJS() as UnprocessedRaidData;

    for (const match of matches) {
        const isValid = perPrefix(match.text, {
            'a:': key => (json.actions != null && key in json.actions) || (options.enums.common != null && key in options.enums.common.yaml.actions),
            's:': key => (json.status != null && key in json.status) || (options.enums.common != null && key in options.enums.common.yaml.status),
            'm:': key => options.enums['mechanic-types'] != null && key in options.enums['mechanic-types'].yaml,
            'ms:': key => options.enums['mechanic-shapes'] != null && key in options.enums['mechanic-shapes'].yaml,
            'st:': key => options.enums['status-types'] != null && key in options.enums['status-types'].yaml,
            't:': key => options.enums.terms != null && key in options.enums.terms.yaml,
            'i:': key => ICONS.includes(key as typeof ICONS[number])
        });

        if (!isValid) {
            addDiagnostic(diagnostics, options, {
                severity: DiagnosticSeverity.Error,
                message: `Unresolved ${perPrefix(match.text, {
                    'a:': key => `action ${key}`,
                    's:': key => `status effect ${key}`,
                    'm:': key => `mechanic type ${key}`,
                    'ms:': key => `mechanic shape ${key}`,
                    'st:': key => `status effect type ${key}`,
                    't:': key => `term ${key}`,
                    'i:': key => `icon ${key}`
                })}. Did you forget to define it?`,
                range: getRange(textDocument, [match.range[0], match.range[1], match.range[1]])
            });
        }
    }
}
