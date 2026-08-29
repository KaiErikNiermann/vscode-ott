/**
 * Formatter settings that come from the client rather than from LSP's
 * `FormattingOptions`.
 *
 * LSP hands a formatter only `tabSize` / `insertSpaces`, so anything
 * language-specific has to be fetched over `workspace/configuration`. Everything
 * here defaults to "do nothing": Ott source is hand-laid-out, and only 370 of
 * the 1457 inference rules in the upstream corpus already have a bar matching
 * their widest line, so switching rule formatting on by default would rewrite
 * three quarters of every existing spec the first time someone hit
 * `Format Document`.
 */

/** What to do with the dashed line of an inference rule. */
export type BarMode = 'off' | 'fit';

/**
 * How to indent the lines of an inference rule.
 *
 * `auto` centres a rule with at most one premise and left-flushes one with
 * premises stacked above the bar — the convention inference rules are usually
 * typeset with. Nothing in the upstream corpus is centred (1275 of 1457 rules
 * are flush left and only 13 vary their indentation at all), so `center` and
 * `auto` introduce a layout rather than restoring one.
 */
export type Alignment = 'off' | 'left' | 'center' | 'auto';

export interface RuleFormatSettings {
    readonly bar: BarMode;
    readonly alignment: Alignment;
    /** Extra dashes beyond the widest line. Authors typically overshoot by a few. */
    readonly barPadding: number;
    /** Upper bound on the bar, or 0 for none. The widest corpus rule is 155 columns. */
    readonly maxBarWidth: number;
}

export const DEFAULT_RULE_SETTINGS: RuleFormatSettings = {
    bar: 'off',
    alignment: 'off',
    barPadding: 0,
    maxBarWidth: 100,
};

/** True if these settings would leave every inference rule untouched. */
export function isNoOp(settings: RuleFormatSettings): boolean {
    return settings.bar === 'off' && settings.alignment === 'off';
}

const BAR_MODES: ReadonlySet<string> = new Set<BarMode>(['off', 'fit']);
const ALIGNMENTS: ReadonlySet<string> = new Set<Alignment>(['off', 'left', 'center', 'auto']);

/** A non-negative integer from an untrusted settings value, or the fallback. */
function count(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : fallback;
}

/**
 * Read `ott.format.rules.*` out of whatever the client sent. The shape is
 * unvalidated JSON from `workspace/configuration`, and a stale or hand-edited
 * `settings.json` can put anything in it, so every field falls back rather than
 * throwing — a bad setting must not break formatting altogether.
 */
export function readRuleSettings(configuration: unknown): RuleFormatSettings {
    if (typeof configuration !== 'object' || configuration === null) {
        return DEFAULT_RULE_SETTINGS;
    }
    const rules = (configuration as { rules?: unknown }).rules;
    if (typeof rules !== 'object' || rules === null) return DEFAULT_RULE_SETTINGS;

    const { bar, alignment, barPadding, maxBarWidth } = rules as Record<string, unknown>;
    return {
        bar: typeof bar === 'string' && BAR_MODES.has(bar)
            ? bar as BarMode : DEFAULT_RULE_SETTINGS.bar,
        alignment: typeof alignment === 'string' && ALIGNMENTS.has(alignment)
            ? alignment as Alignment : DEFAULT_RULE_SETTINGS.alignment,
        barPadding: count(barPadding, DEFAULT_RULE_SETTINGS.barPadding),
        maxBarWidth: count(maxBarWidth, DEFAULT_RULE_SETTINGS.maxBarWidth),
    };
}
