const PRIMARY_SUBCOMMANDS = [
  "logs",
  "stop",
  "upgrade",
  "info",
  "web",
  "desktop",
  "help",
  "completions",
] as const;
const COMPLETION_SUBCOMMANDS = ["install"] as const;
const HELP_TARGETS = [
  "logs",
  "stop",
  "upgrade",
  "info",
  "web",
  "desktop",
  "completions",
] as const;
export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;

const PRIMARY_SUBCOMMANDS_TEXT = PRIMARY_SUBCOMMANDS.join(" ");
const HELP_TARGETS_TEXT = HELP_TARGETS.join(" ");
const COMPLETION_SUBCOMMANDS_TEXT = COMPLETION_SUBCOMMANDS.join(" ");
const COMPLETION_SHELL_TEXT = COMPLETION_SHELLS.join(" ");
const QUOTED_PRIMARY_SUBCOMMANDS = PRIMARY_SUBCOMMANDS.map(
  (cmd) => `"${cmd}"`
).join(" ");
const QUOTED_HELP_TARGETS = HELP_TARGETS.map((cmd) => `"${cmd}"`).join(" ");
const QUOTED_COMPLETION_SUBCOMMANDS = COMPLETION_SUBCOMMANDS.map(
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
  if [[ \${COMP_WORDS[1]} == "help" ]]; then
    COMPREPLY=( $(compgen -W "${HELP_TARGETS_TEXT}" -- "$cur") )
    return 0
  fi
  if [[ \${COMP_WORDS[1]} == "completions" ]]; then
    if [[ \${COMP_CWORD} == 2 ]]; then
      COMPREPLY=( $(compgen -W "install" -- "$cur") )
      return 0
    fi
    if [[ \${COMP_WORDS[2]} == "install" ]]; then
      COMPREPLY=( $(compgen -W "${COMPLETION_SHELL_TEXT}" -- "$cur") )
      return 0
    fi
    return 0
  fi
}
complete -F _synthetic_completions synthetic
`,

  zsh: `#compdef synthetic
_synthetic() {
  local -a primary_commands
  primary_commands=(${QUOTED_PRIMARY_SUBCOMMANDS})
  local -a help_targets
  help_targets=(${QUOTED_HELP_TARGETS})
  local -a completion_subcommands
  completion_subcommands=(${QUOTED_COMPLETION_SUBCOMMANDS})
  local -a shells
  shells=(${QUOTED_SHELLS})

  if (( CURRENT == 2 )); then
    compadd -a primary_commands
    return
  fi

  if [[ $words[2] == help ]]; then
    compadd -a help_targets
    return
  fi

  if [[ $words[2] == completions ]]; then
    if (( CURRENT == 3 )); then
      compadd -a completion_subcommands
      return
    fi

    if [[ $words[3] == install ]]; then
      if (( CURRENT == 4 )); then
        _describe 'shell' shells
      fi
      return
    fi
  fi

  _values 'option' '--foreground' '--help' '-h'
}
compdef _synthetic synthetic
`,

  fish: `# fish completion for synthetic
complete -c synthetic -f
complete -c synthetic -n '__fish_use_subcommand' -a '${PRIMARY_SUBCOMMANDS_TEXT}'
complete -c synthetic -n '__fish_seen_subcommand_from help' -a '${HELP_TARGETS_TEXT}'
complete -c synthetic -n '__fish_seen_subcommand_from completions; and not __fish_seen_subcommand_from install' -a '${COMPLETION_SUBCOMMANDS_TEXT}'
complete -c synthetic -n '__fish_seen_subcommand_from completions; and __fish_seen_subcommand_from install' -a '${COMPLETION_SHELL_TEXT}'
complete -c synthetic -l foreground -d 'Run in the foreground instead of background mode'
complete -c synthetic -s h -l help -d 'Show help output'
`,
};

export const renderCompletionScript = (shell: string) => {
  const normalized = shell.toLowerCase() as (typeof COMPLETION_SHELLS)[number];
  return COMPLETION_SCRIPTS[normalized] ?? null;
};
