<p align="center">
  <img src="assets/icon.png" alt="vscode-ott" width="128" />
</p>

<h1 align="center">vscode-ott</h1>

<p align="center">
  Language support for the <a href="https://github.com/ott-lang/ott">Ott</a> specification language in VS Code and Neovim.
</p>

Ott is a tool for writing definitions of programming languages and calculi, developed by Peter Sewell and collaborators. It generates LaTeX, Coq, HOL, and Isabelle definitions from a single concise source. This project provides IDE tooling to make writing `.ott` files easier.

## Features

- **Syntax highlighting** -- TextMate grammar for VS Code, tree-sitter for Neovim
- **Error reporting** -- Langium-based parser with inline diagnostics
- **Document symbols** -- outline view for metavars, grammar rules, definition classes, embeds
- **Hover documentation** -- contextual docs for hom names, metavars, nonterminals, comprehensions, bind specs
- **Validation** -- reference checks for subrules, substitutions, freevars, parsing directives; duplicate detection
- **Formatting** -- section-level formatter with conservative rules (blank lines between sections, indented productions, homomorphism wrapping)
- **Neovim support** -- standalone LSP server over stdio with tree-sitter highlighting

## Getting started

### VS Code

Install the extension from the marketplace (coming soon), or build from source:

```sh
pnpm install
pnpm run langium:generate
pnpm run build
```

Then press `F5` in VS Code to launch the Extension Development Host.

### Neovim

The Neovim plugin lives in `editors/neovim/`. Add it with your plugin manager, e.g. with lazy.nvim:

```lua
{
  "KaiErikNiermann/vscode-ott",
  config = function()
    require("ott").setup()
  end,
}
```

Requires Node.js and the language server to be built (`pnpm run build` in the repo root).

## Project structure

```
packages/
  language/   -- Langium grammar, LSP services (symbols, hover, formatter, validator)
  cli/        -- Command-line interface
  extension/  -- VS Code extension wrapper
editors/
  neovim/     -- Neovim plugin (Lua, tree-sitter queries)
```

## Development

```sh
pnpm install
pnpm run langium:generate   # generate AST types from grammar
pnpm run build               # typecheck + bundle extension
pnpm run test                # run vitest suite (146 tests)
pnpm run lint                # eslint with sonarjs/unicorn/security
```

## Attribution

This project provides IDE tooling for the **Ott** language. Ott itself is developed and maintained at [ott-lang/ott](https://github.com/ott-lang/ott) by Peter Sewell, Francesco Zappa Nardelli, Scott Owens, and many other contributors. The test fixtures in this repository include example files from the Ott project, used for cross-validation of the parser.

If you use Ott in your research, please cite the original paper:

> Peter Sewell, Francesco Zappa Nardelli, Scott Owens, Gilles Peskine, Thomas Ridge, Susmit Sarkar, and Rok Strnisa.
> *Ott: Effective Tool Support for the Working Semanticist.*
> Journal of Functional Programming, 2010.

## License

[MIT](./LICENSE)
