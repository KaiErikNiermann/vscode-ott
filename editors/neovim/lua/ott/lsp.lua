local M = {}

--- Locate the Ott language server binary.
--- Checks in order: npm global install, bundled in monorepo.
---@return string[]|nil cmd The command to start the server, or nil if not found
function M.find_server()
  -- Check npm global install
  if vim.fn.executable("ott-language-server") == 1 then
    return { "ott-language-server", "--stdio" }
  end

  -- Check if node is available and the bundled server exists
  if vim.fn.executable("node") == 1 then
    -- Look relative to the plugin root for the monorepo bin wrapper
    local plugin_root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h:h:h")

    -- Check monorepo bin/ (two levels up from editors/neovim)
    local bin_path = plugin_root .. "/../../bin/ott-language-server"
    local resolved = vim.fn.resolve(bin_path)
    if vim.fn.filereadable(resolved) == 1 then
      return { "node", resolved }
    end

    -- Check bundled extension output directly
    local server_path = plugin_root .. "/../../packages/extension/out/language/main.cjs"
    resolved = vim.fn.resolve(server_path)
    if vim.fn.filereadable(resolved) == 1 then
      return { "node", resolved, "--stdio" }
    end
  end

  return nil
end

--- Set up the Ott language server using Neovim's built-in LSP client.
---@param config OttConfig
function M.setup(config)
  if not config.lsp.enabled then
    return
  end

  local cmd = config.lsp.cmd or M.find_server()
  if not cmd then
    vim.notify(
      "[ott] Language server not found. Install with: npm install -g vscode-ott",
      vim.log.levels.WARN
    )
    return
  end

  vim.lsp.config("ott", {
    cmd = cmd,
    filetypes = { "ott" },
    root_markers = config.lsp.root_markers,
    settings = {},
  })

  vim.lsp.enable("ott")
end

return M
