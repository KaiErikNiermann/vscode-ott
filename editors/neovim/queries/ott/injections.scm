; LaTeX injection in tex and tex-preamble homomorphisms
(homomorphism
  name: (hom_name) @_hom_name (#match? @_hom_name "^tex(-preamble)?$")
  body: (hom_body) @injection.content (#set! injection.language "latex"))

; Typst injection in typst, typstvar and typst-preamble homomorphisms
; (requires a `typst` tree-sitter parser).  A typst hom in a grammar is Typst
; maths, which the parser reads as markup: names and calls still colour, and
; the embeds, which are markup, read right.
(homomorphism
  name: (hom_name) @_hom_name (#match? @_hom_name "^typst(var|-preamble|-wrap-pre|-wrap-post)?$")
  body: (hom_body) @injection.content (#set! injection.language "typst"))

; Lean injection in lean homomorphisms (requires a `lean` tree-sitter parser)
(homomorphism
  name: (hom_name) @_hom_name (#eq? @_hom_name "lean")
  body: (hom_body) @injection.content (#set! injection.language "lean"))
