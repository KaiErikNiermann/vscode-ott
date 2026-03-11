vim.filetype.add({
  extension = {
    ott = "ott",
  },
})

-- Register tree-sitter language so Neovim maps filetype -> parser
vim.treesitter.language.register("ott", "ott")
