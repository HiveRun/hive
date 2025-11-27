const PRIMARY_SUBCOMMANDS = ["logs", "stop", "upgrade", "info"] as const;
export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;

const PRIMARY_SUBCOMMANDS_TEXT = PRIMARY_SUBCOMMANDS.join(" ");
const COMPLETION_SHELL_TEXT = COMPLETION_SHELLS.join(" ");
const QUOTED_PRIMARY_SUBCOMMANDS = PRIMARY_SUBCOMMANDS.map(
  (cmd) => `"${cmd}"`
).join(" ");
const QUOTED_SHELLS = COMPLETION_SHELLS.map((shell) => `"${shell}"`).join(" ");

const COMPLETION_SCRIPTS: Record<(typeof COMPLETION_SHELLS)[number], string> = {
  bash: `# bash completion for synthetic
_synthetic_completions() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ $cur == -* ]]; then
    COMPREPLY=( $(compgen -W "--foreground --help -h" -- "$cur") )
    return 0
  fi
  if [[ \${COMP_CWORD} == 1 ]]; then
    COMPREPLY=( $(compgen -W "${PRIMARY_SUBCOMMANDS_TEXT}" -- "$cur") )
    return 0
  fi
  if [[ \${COMP_WORDS[1]} == "completions" ]]; then
    COMPREPLY=( $(compgen -W "${COMPLETION_SHELL_TEXT}" -- "$cur") )
    return 0
  fi
}
complete -F _synthetic_completions synthetic
`,
  zsh: `#compdef synthetic
_synthetic() {
  local -a primary_commands
  primary_commands=(${QUOTED_PRIMARY_SUBCOMMANDS})
  local -a shells
  shells=(${QUOTED_SHELLS})

  if (( CURRENT == 2 )); then
    compadd -a primary_commands
    return
  elif [[ $words[2] == completions ]]; then
    _describe 'shell' shells
  else
    _values 'option' '--foreground' '--help' '-h'
  fi
}
compdef _synthetic synthetic
`,
  fish: `# fish completion for synthetic
complete -c synthetic -f
complete -c synthetic -n '__fish_use_subcommand' -a '${PRIMARY_SUBCOMMANDS_TEXT}'
complete -c synthetic -l foreground -d 'Run in the foreground instead of background mode'
complete -c synthetic -s h -l help -d 'Show help output'
complete -c synthetic -n '__fish_seen_subcommand_from completions' -a '${COMPLETION_SHELL_TEXT}'
`,
};

export const renderCompletionScript = (shell: string) => {
  const normalized = shell.toLowerCase() as (typeof COMPLETION_SHELLS)[number];
  return COMPLETION_SCRIPTS[normalized] ?? null;
};
