# vscode-ott

Language support for the [Ott](https://github.com/ott-lang/ott) specification language in VS Code.

Ott is a tool for writing definitions of programming languages and calculi. It generates LaTeX, Coq, HOL, and Isabelle definitions from a single concise source.

## Features

- **Syntax highlighting** for `.ott` files
- **Error reporting** with inline diagnostics as you type
- **Document symbols** -- navigate metavars, grammar rules, definition classes, and embeds in the outline view (`Ctrl+Shift+O`)
- **Hover documentation** -- hover over hom names, metavars, nonterminals, comprehensions, and bind specs for contextual docs
- **Validation** -- reference checks for subrules, substitutions, freevars, and parsing directives; duplicate metavar/nonterminal detection
- **Formatting** -- format your `.ott` files with `Shift+Alt+F`; conservative section-level rules that won't break valid Ott

## Supported Ott constructs

- `metavar` / `indexvar` declarations
- `grammar` blocks with productions
- `defns` / `defn` blocks with inference rules
- Homomorphisms (`{{ coq ... }}`, `{{ tex ... }}`, etc.)
- Comprehensions (`</ ... // ... />`)
- Bind specs (`(+ ... +)`)
- `embed`, `subrules`, `substitutions`, `freevars`, `parsing` blocks

## Requirements

- VS Code 1.110.0 or later

## Attribution

This extension provides IDE tooling for the **Ott** language, developed and maintained at [ott-lang/ott](https://github.com/ott-lang/ott) by Peter Sewell, Francesco Zappa Nardelli, Scott Owens, and many other contributors.

## Issues

Report issues at [github.com/KaiErikNiermann/vscode-ott/issues](https://github.com/KaiErikNiermann/vscode-ott/issues).

## License

[MIT](https://github.com/KaiErikNiermann/vscode-ott/blob/main/LICENSE)
