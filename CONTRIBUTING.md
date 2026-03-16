# Contributing

Thanks for your interest in contributing to vscode-ott!

## Setup

```sh
git clone https://github.com/KaiErikNiermann/vscode-ott.git
cd vscode-ott
pnpm install
pnpm run langium:generate
pnpm run build
```

## Development workflow

1. Make your changes
2. Run checks before committing:
   ```sh
   pnpm run build       # typecheck
   pnpm run lint        # eslint
   pnpm run test        # vitest
   ```
3. Commit using [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `test:`, `chore:`)

## Project layout

| Path | Purpose |
|------|---------|
| `packages/language/src/ott.langium` | Langium grammar definition |
| `packages/language/src/ott-*.ts` | LSP services (validator, hover, symbols, formatter) |
| `packages/language/src/generated/` | Auto-generated from grammar (do not edit) |
| `packages/language/test/` | Vitest test suites |
| `packages/language/test/fixtures/` | Real-world `.ott` files from [ott-lang/ott](https://github.com/ott-lang/ott) examples |
| `packages/language/syntaxes/` | Custom TextMate grammar (hand-written, not auto-generated) |
| `packages/extension/` | VS Code extension wrapper |
| `packages/cli/` | CLI tool |
| `editors/neovim/` | Neovim plugin |

## Key conventions

- **pnpm** for package management (not npm/yarn)
- **Atomic conventional commits** -- one logical change per commit
- **ts-pattern** for AST node dispatch (prefer over if-else chains)
- **ESLint** with sonarjs, unicorn, and security plugins -- `pnpm run lint` must pass
- **DRY** -- extract shared helpers, avoid duplicate logic
- Generated files (`src/generated/`) are gitignored and created by `pnpm run langium:generate`
- The TextMate grammar (`syntaxes/ott.tmLanguage.json`) is hand-maintained, not generated

## Adding test fixtures

Drop `.ott` files into `packages/language/test/fixtures/`. The fixture test suite automatically picks them up and validates them against both the Langium parser and the real `ott` tool (if installed).

If a fixture uses Ott features our grammar doesn't support yet, add it to the `KNOWN_FAILURES` map in `fixtures.test.ts` with a description of the missing feature.

## Reporting issues

Please open an issue at https://github.com/KaiErikNiermann/vscode-ott/issues.
