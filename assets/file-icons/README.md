# File icons

`ott-rule-{light,dark}.svg` is the `.ott` file icon: an inference rule — two
premises, the bar, the conclusion. It is contributed through
`contributes.languages[].icon` in the extension manifest, which slots into
whatever file icon theme the user already runs rather than replacing it. The
build copies both variants into `packages/extension/icons/`.

Two colour tunings of one mark, not two marks: `#E0687F` on dark editor
backgrounds, `#B8425C` on light.

`reserve/` holds marks that are deliberately unused — kept so the alternative
is a one-line manifest change rather than a redesign. Nothing references them.
