; LaTeX injection in tex and tex-preamble homomorphisms
(homomorphism
  name: (hom_name) @_hom_name (#match? @_hom_name "^tex(-preamble)?$")
  body: (hom_body) @injection.content (#set! injection.language "latex"))
