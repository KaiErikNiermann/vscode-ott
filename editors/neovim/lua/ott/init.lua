local M = {}

--- Register the tree-sitter-ott parser with nvim-treesitter so that
--- :TSInstall ott works out of the box.
local function register_ts_parser()
  local ok, parsers = pcall(require, "nvim-treesitter.parsers")
  if not ok then return end

  local configs = parsers.get_parser_configs()
  if configs.ott then return end -- already registered

  configs.ott = {
    install_info = {
      url = "https://github.com/KaiErikNiermann/tree-sitter-ott",
      files = { "src/parser.c", "src/scanner.c" },
      branch = "main",
    },
    filetype = "ott",
  }
end

--- Set up ott.nvim with the given options.
---@param opts OttConfig|nil
function M.setup(opts)
  local config = require("ott.config")
  config.apply(opts)

  -- Register tree-sitter parser so :TSInstall ott works
  register_ts_parser()

  -- Set up the language server
  require("ott.lsp").setup(config.current)
end

return M
