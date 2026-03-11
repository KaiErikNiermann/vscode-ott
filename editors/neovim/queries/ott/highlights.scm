; Ott tree-sitter highlights for Neovim
; Node types from https://github.com/KaiErikNiermann/tree-sitter-ott

; Comments
(comment) @comment @spell

; Names and identifiers
(string) @variable
(defnclass_name) @function
(defn_name) @function.method
(rule_name) @property
(production_name) @property
(namespace_prefix) @string
(hom_name) @type
(production_mod) @type.builtin

; Keywords
[
  "metavar"
  "indexvar"
  "grammar"
  "defns"
  "defn"
  "by"
  "embed"
  "subrules"
  "IN"
] @keyword

; Delimiters
[
  (dash_line)
  (dots)
  "|"
  "::"
  "<::"
  "::="
  ","
] @punctuation.delimiter

; Brackets
[
  "{{"
  "}}"
  "[["
  "]]"
] @punctuation.bracket

; Comprehension markers
[
  "</"
  "//"
  "/>"
] @punctuation.special
