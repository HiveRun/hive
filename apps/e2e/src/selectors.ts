export const selectors = {
  workspaceCreateCellButton: '[data-testid="workspace-create-cell"]',
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
