local M = {}

---@class OttConfig
---@field lsp OttLspConfig

---@class OttLspConfig
---@field enabled boolean Enable the language server
---@field cmd string[]|nil Command to start the server (auto-detected if nil)
---@field root_markers string[] Files that identify the project root

---@type OttConfig
M.defaults = {
  lsp = {
    enabled = true,
    cmd = nil,
    root_markers = { ".git" },
  },
}

---@type OttConfig
M.current = vim.deepcopy(M.defaults)

---@param opts OttConfig|nil
function M.apply(opts)
  M.current = vim.tbl_deep_extend("force", vim.deepcopy(M.defaults), opts or {})
end

return M
