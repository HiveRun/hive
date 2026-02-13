export const selectors = {
  workspaceSection: '[data-testid="workspace-section"]',
  workspaceCreateCellButton: '[data-testid="workspace-create-cell"]',
  workspaceCellLink: '[data-testid="workspace-cell-link"]',
  workspaceManageButton: '[aria-label="Manage workspaces"]',
  workspaceRegisterButton: '[aria-label="Register new workspace"]',
  cellNameInput: '[data-testid="cell-name-input"]',
  templateSelect: '[data-testid="template-select"]',
  templateSelectTrigger: '[data-testid="template-select"] [role="combobox"]',
  cellSubmitButton: '[data-testid="cell-submit-button"]',
  terminalRoot: '[data-testid="cell-terminal"]',
  terminalReadySurface:
    '[data-testid="cell-terminal"][data-terminal-ready="true"]',
  terminalConnectionBadge: '[data-testid="terminal-connection"]',
  terminalRestartButton: '[data-testid="terminal-restart-button"]',
  terminalInputSurface: '[data-testid="cell-terminal-input"]',
  terminalInputTextarea:
    '[data-testid="cell-terminal-input"] .xterm-helper-textarea',
} as const;
