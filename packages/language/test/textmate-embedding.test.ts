import { describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { hasScope, installedGrammar, STUB_GRAMMARS, tokenize, tokensOf, versionedDirs } from './textmate-tokenizer.js';

/**
 * Hom bodies, tokenised with the real TextMate engine.  These pin what the
 * grammar does today, so that embedding other grammars in hom bodies cannot
 * change the Ott side of things unnoticed.
 */

describe('hom bodies', () => {
    test('a hom body is Ott hom text, and its [[...]] holes are references', async () => {
        const lines = await tokenize('  | \\ x . t :: :: lam {{ coq (Lam [[x]] [[t]]) }}');
        expect(hasScope(tokensOf(lines, '(Lam')[0], 'string.unquoted.hom-body.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, 'x')[0], 'variable.other.inner-ref.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, '}}')[0], 'punctuation.definition.homomorphism.end.ott')).toBe(true);
    });

    test('the text after a hom is Ott again', async () => {
        const lines = await tokenize('  | t1 t2 :: :: app {{ coq (App [[t1]] [[t2]]) }} {{ com application }}');
        const com = tokensOf(lines, 'com')[0];
        expect(hasScope(com, 'entity.name.type.hom-name.ott')).toBe(true);
    });
});

const REPO = new URL('../../..', import.meta.url).pathname;
const VSCODE_TEX = installedGrammar(
    versionedDirs(join(REPO, 'packages/extension/.vscode-test'), 'vscode-')
        .map(d => join(d, 'resources/app/extensions/latex/syntaxes/TeX.tmLanguage.json')),
);

describe('{{ tex }} homs embed TeX maths', () => {
    const line = '  | \\ x . t :: :: lam {{ tex \\lambda [[x]] . \\mathsf{[[t]]} }} {{ com abstraction }}';

    test('the body is LaTeX, with its commands scoped by the TeX grammar', async () => {
        const lines = await tokenize(line, STUB_GRAMMARS.tex);
        const lambda = tokensOf(lines, '\\lambda')[0];
        expect(hasScope(lambda, 'meta.embedded.inline.latex')).toBe(true);
        expect(hasScope(lambda, 'support.function.stub.tex')).toBe(true);
        expect(hasScope(tokensOf(lines, 'tex')[0], 'entity.name.type.hom-name.ott')).toBe(true);
    });

    test('a [[...]] hole stays an Ott reference, inside a TeX group too', async () => {
        const lines = await tokenize(line, STUB_GRAMMARS.tex);
        for (const name of ['x', 't']) {
            expect(hasScope(tokensOf(lines, name)[0], 'variable.other.inner-ref.ott'), name).toBe(true);
        }
    });

    test('}} ends the hom, and what follows is Ott again', async () => {
        const lines = await tokenize(line, STUB_GRAMMARS.tex);
        expect(hasScope(tokensOf(lines, '}}')[0], 'punctuation.definition.homomorphism.end.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, 'com')[0], 'entity.name.type.hom-name.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, 'com')[0], 'meta.embedded.inline.latex')).toBe(false);
    });

    test('texvar is maths too', async () => {
        const lines = await tokenize('metavar x ::= {{ texvar \\mathrm{[[x]]} }}', STUB_GRAMMARS.tex);
        expect(hasScope(tokensOf(lines, '\\mathrm')[0], 'support.function.stub.tex')).toBe(true);
    });

    test('without a TeX grammar the hom still parses as Ott', async () => {
        const lines = await tokenize(line);
        expect(hasScope(tokensOf(lines, 'x')[0], 'variable.other.inner-ref.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, 'com')[0], 'entity.name.type.hom-name.ott')).toBe(true);
    });

    test('tex-preamble is not maths', async () => {
        const lines = await tokenize('embed {{ tex-preamble \\newcommand{\\a}{b} }}', STUB_GRAMMARS.tex);
        expect(lines.flat().some(t => hasScope(t, 'meta.embedded.inline.latex'))).toBe(false);
    });

    test.skipIf(VSCODE_TEX === undefined)('with VS Code\'s own TeX grammar', async () => {
        const lines = await tokenize(line, { 'text.tex': VSCODE_TEX! });
        // the real grammar splits the backslash from the command name
        expect(tokensOf(lines, 'lambda')[0]?.scopes.some(s => s.endsWith('.math.tex'))).toBe(true);
        expect(hasScope(tokensOf(lines, 't')[0], 'variable.other.inner-ref.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, 'x')[0], 'variable.other.inner-ref.ott')).toBe(true);
        expect(hasScope(tokensOf(lines, 'com')[0], 'entity.name.type.hom-name.ott')).toBe(true);
    });
});
