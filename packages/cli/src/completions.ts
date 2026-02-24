export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

type CompletionCommandModel = {
  primarySubcommands: string[];
  helpTargets: string[];
  completionSubcommands: string[];
};

const isLiteralCommandToken = (token: string) =>
  token.length > 0 && !token.startsWith("-");

const pushUnique = (values: string[], value: string) => {
  if (!values.includes(value)) {
    values.push(value);
  }
};

export const buildCompletionCommandModel = (
  commandPaths: readonly (readonly string[])[]
): CompletionCommandModel => {
  const primarySubcommands: string[] = [];
  const completionSubcommands: string[] = [];

  for (const commandPath of commandPaths) {
    const [firstToken, secondToken] = commandPath;
    if (!(firstToken && isLiteralCommandToken(firstToken))) {
      continue;
    }

    pushUnique(primarySubcommands, firstToken);

    if (firstToken !== "completions") {
      continue;
    }

    if (!(secondToken && isLiteralCommandToken(secondToken))) {
      continue;
    }

    pushUnique(completionSubcommands, secondToken);
  }

  pushUnique(primarySubcommands, "help");

  return {
    primarySubcommands,
    helpTargets: primarySubcommands.filter((command) => command !== "help"),
    completionSubcommands,
  };
};

export const renderCompletionScript = (
  shell: string,
  commandModel: CompletionCommandModel
) => {
  const normalized = shell.toLowerCase() as CompletionShell;
  if (!COMPLETION_SHELLS.includes(normalized)) {
    return null;
  }

  const primarySubcommandsText = commandModel.primarySubcommands.join(" ");
  const helpTargetsText = commandModel.helpTargets.join(" ");
  const completionSubcommandsText =
    commandModel.completionSubcommands.join(" ");
  const completionShellText = COMPLETION_SHELLS.join(" ");

  const quotedPrimarySubcommands = commandModel.primarySubcommands
    .map((cmd) => `"${cmd}"`)
    .join(" ");
  const quotedHelpTargets = commandModel.helpTargets
    .map((cmd) => `"${cmd}"`)
    .join(" ");
  const quotedCompletionSubcommands = commandModel.completionSubcommands
    .map((cmd) => `"${cmd}"`)
    .join(" ");
  const quotedShells = COMPLETION_SHELLS.map(
    (supportedShell) => `"${supportedShell}"`
  ).join(" ");

  if (normalized === "bash") {
    return `# bash completion for hive
_hive_completions() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ $cur == -* ]]; then
    COMPREPLY=( $(compgen -W "--foreground --help -h" -- "$cur") )
    return 0
  fi
  if [[ \${COMP_CWORD} == 1 ]]; then
    COMPREPLY=( $(compgen -W "${primarySubcommandsText}" -- "$cur") )
    return 0
  fi
  if [[ \${COMP_WORDS[1]} == "help" ]]; then
    COMPREPLY=( $(compgen -W "${helpTargetsText}" -- "$cur") )
    return 0
  fi
  if [[ \${COMP_WORDS[1]} == "completions" ]]; then
    if [[ \${COMP_CWORD} == 2 ]]; then
      COMPREPLY=( $(compgen -W "${completionSubcommandsText}" -- "$cur") )
      return 0
    fi
    if [[ \${COMP_WORDS[2]} == "install" ]]; then
      COMPREPLY=( $(compgen -W "${completionShellText}" -- "$cur") )
      return 0
    fi
    return 0
  fi
}
complete -F _hive_completions hive
`;
  }

  if (normalized === "zsh") {
    return `#compdef hive
_hive() {
  local -a primary_commands
  primary_commands=(${quotedPrimarySubcommands})
  local -a help_targets
  help_targets=(${quotedHelpTargets})
  local -a completion_subcommands
  completion_subcommands=(${quotedCompletionSubcommands})
  local -a shells
  shells=(${quotedShells})

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
compdef _hive hive
`;
  }

  return `# fish completion for hive
complete -c hive -f
complete -c hive -n '__fish_use_subcommand' -a '${primarySubcommandsText}'
complete -c hive -n '__fish_seen_subcommand_from help' -a '${helpTargetsText}'
complete -c hive -n '__fish_seen_subcommand_from completions; and not __fish_seen_subcommand_from install' -a '${completionSubcommandsText}'
complete -c hive -n '__fish_seen_subcommand_from completions; and __fish_seen_subcommand_from install' -a '${completionShellText}'
complete -c hive -l foreground -d 'Run in the foreground instead of background mode'
complete -c hive -s h -l help -d 'Show help output'
`;
};
