; LaTeX injection in tex and tex-preamble homomorphisms
(homomorphism
  name: (hom_name) @_hom_name (#match? @_hom_name "^tex(-preamble)?$")
  body: (hom_body) @injection.content (#set! injection.language "latex"))

; Lean injection in lean homomorphisms (requires a `lean` tree-sitter parser)
(homomorphism
  name: (hom_name) @_hom_name (#eq? @_hom_name "lean")
  body: (hom_body) @injection.content (#set! injection.language "lean"))
