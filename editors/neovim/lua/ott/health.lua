local M = {}

function M.check()
  vim.health.start("ott.nvim")

  -- Check node
  if vim.fn.executable("node") == 1 then
    local version = vim.fn.system({ "node", "--version" }):gsub("%s+$", "")
    vim.health.ok("node found: " .. version)
  else
    vim.health.error("node not found (required for language server)")
  end

  -- Check language server
  local config = require("ott.config").current
  local lsp = require("ott.lsp")
  local cmd = config.lsp.cmd or lsp.find_server()
  if cmd then
    vim.health.ok("Language server: " .. table.concat(cmd, " "))
  else
    vim.health.warn("Language server not found. Install with: npm install -g vscode-ott")
  end

  -- Check tree-sitter parser
  local ok = pcall(vim.treesitter.language.inspect, "ott")
  if ok then
    vim.health.ok("tree-sitter-ott parser installed")
  else
    vim.health.warn("tree-sitter-ott parser not installed. Run :TSInstall ott")
  end
end

return M
