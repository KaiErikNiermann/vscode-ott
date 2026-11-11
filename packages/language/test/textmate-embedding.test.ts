import { describe, expect, test } from 'vitest';
import { hasScope, tokenize, tokensOf } from './textmate-tokenizer.js';

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
