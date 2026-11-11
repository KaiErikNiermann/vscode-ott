local M = {}

local PARSER_URL = "https://github.com/KaiErikNiermann/tree-sitter-ott"

--- Register the tree-sitter-ott parser with nvim-treesitter, on whichever of
--- its two APIs is installed, so that :TSInstall ott works out of the box.
---
--- nvim-treesitter's `master` branch exposes `get_parser_configs()`. Its
--- `main` branch, the default since the rewrite, has no such function: its
--- `nvim-treesitter.parsers` module is the parser table itself, which it
--- reloads on :TSUpdate, so a custom parser is assigned into it again from a
--- `User TSUpdate` autocommand. The parser is named after the filetype, so
--- no `vim.treesitter.language.register` is needed.
local function register_ts_parser()
  local ok, parsers = pcall(require, "nvim-treesitter.parsers")
  if not ok then return end

  if type(parsers.get_parser_configs) == "function" then
    -- nvim-treesitter `master`
    local configs = parsers.get_parser_configs()
    if configs.ott then return end -- already registered
    configs.ott = {
      install_info = {
        url = PARSER_URL,
        files = { "src/parser.c", "src/scanner.c" },
        branch = "main",
      },
      filetype = "ott",
    }
    return
  end

  -- nvim-treesitter `main`
  local function add()
    require("nvim-treesitter.parsers").ott = {
      install_info = { url = PARSER_URL, branch = "main" },
    }
  end
  add()
  vim.api.nvim_create_autocmd("User", {
    pattern = "TSUpdate",
    group = vim.api.nvim_create_augroup("ott.treesitter", { clear = true }),
    callback = add,
  })
end

--- Set up ott.nvim with the given options.
---@param opts OttConfig|nil
function M.setup(opts)
  local config = require("ott.config")
  config.apply(opts)

  -- Register tree-sitter parser so :TSInstall ott works.  A failure here must
  -- not stop the language server below from starting.
  local ok, err = pcall(register_ts_parser)
  if not ok then
    vim.notify("ott.nvim: could not register the tree-sitter parser: " .. tostring(err), vim.log.levels.WARN)
  end

  -- Set up the language server
  require("ott.lsp").setup(config.current)
end

return M
