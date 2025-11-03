#!/bin/bash

# Clean Zsh Setup with Batteries Included
# This script sets up a minimal but powerful Zsh configuration

set -e

echo "🚀 Setting up clean Zsh with batteries included..."

# Install Oh My Zsh if not present
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  echo "📦 Installing Oh My Zsh..."
  RUNZSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

# Install useful plugins
echo "🔌 Installing plugins..."

# zsh-autosuggestions
if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions" ]; then
  git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
fi

# zsh-syntax-highlighting
if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" ]; then
  git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
fi

# zsh-completions
if [ ! -d "$HOME/.oh-my-zsh/custom/plugins/zsh-completions" ]; then
  git clone https://github.com/zsh-users/zsh-completions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-completions
fi

# Install Starship prompt (better than Spaceship)
echo "🚀 Installing Starship prompt..."
if ! command -v starship &> /dev/null; then
  curl -sS https://starship.rs/install.sh | sh -s -- -y
fi

# Create Starship config
mkdir -p "$HOME/.config"
cat > "$HOME/.config/starship.toml" << 'EOF'
# Starship Configuration - Clean and informative

format = """
$directory\
$git_branch\
$git_status\
$nodejs\
$elixir\
$docker_context\
$package\
$character
"""

right_format = """
$time
"""

[directory]
truncation_length = 3
truncate_to_repo = false

[git_branch]
format = "[$symbol$branch]($style) "
symbol = "🌱 "

[git_status]
format = "([\\[$all_status$ahead_behind\\]]($style) )"

[nodejs]
format = "[$symbol($version )]($style)"

[elixir]
format = "[$symbol($version )]($style)"
symbol = "💧 "

[docker_context]
format = "[$symbol$context]($style) "
symbol = "🐳 "

[package]
format = "[$symbol$version]($style) "
symbol = "📦 "

[time]
format = "[$time]($style) "
time_format = "%R"
disabled = false

[character]
success_symbol = "[❯](bold green)"
error_symbol = "[❯](bold red)"
EOF

# Create .zshrc with clean configuration
echo "⚙️  Creating .zshrc..."
cat > "$HOME/.zshrc" << 'EOF'
# Zsh Configuration - Clean with Batteries Included

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Theme (using Starship instead)
ZSH_THEME=""

# Plugins
plugins=(
  git
  zsh-autosuggestions
  zsh-syntax-highlighting
  zsh-completions
  docker
  docker-compose
  npm
  node
  bun
  vscode
  elixir
  mix
  kubectl
  terraform
  gcloud
  aws
)

source $ZSH/oh-my-zsh.sh

# Initialize Starship
eval "$(starship init zsh)"

# User configuration

# Better history
HISTSIZE=10000
SAVEHIST=10000
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_SPACE
setopt SHARE_HISTORY
setopt APPEND_HISTORY

# Better completion
zstyle ':completion:*' menu select
zstyle ':completion:*' group-name ''
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'

# Useful aliases
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

# Git aliases
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git pull'
alias gd='git diff'
alias gco='git checkout'

# Development aliases
alias dev='npm run dev'
alias build='npm run build'
alias test='npm test'
alias lint='npm run lint'

# Elixir aliases
alias iex='iex --erl "-kernel shell_history enabled"'
alias mix='mix'
alias phx='mix phx'
alias ecto='mix ecto'

# Docker aliases
alias d='docker'
alias dc='docker-compose'
alias dps='docker ps'
alias dimg='docker images'
alias drun='docker run -it --rm'

# Kubernetes aliases
alias k='kubectl'
alias kgp='kubectl get pods'
alias kgs='kubectl get services'
alias kaf='kubectl apply -f'
alias kdf='kubectl delete -f'

# System aliases
alias ports='netstat -tuln'
alias myip='curl ifconfig.me'
alias weather='curl wttr.in'
alias top='htop'  # if htop is installed

# Environment variables
export EDITOR='code'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Elixir/Erlang
export ERL_AFLAGS="-kernel shell_history enabled"

# Development
export NODE_OPTIONS="--max-old-space-size=4096"
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Better defaults
export LESS="-R"
export CLICOLOR=1
export LSCOLORS="ExFxBxDxCxegedabagacad"

# Useful functions
mkcd() {
  mkdir -p "$1" && cd "$1"
}

extract() {
  if [ -f "$1" ]; then
    case "$1" in
      *.tar.bz2)   tar xjf "$1"     ;;
      *.tar.gz)    tar xzf "$1"     ;;
      *.bz2)       bunzip2 "$1"     ;;
      *.rar)       unrar x "$1"     ;;
      *.gz)        gunzip "$1"      ;;
      *.tar)       tar xf "$1"      ;;
      *.tbz2)      tar xjf "$1"     ;;
      *.tgz)       tar xzf "$1"     ;;
      *.zip)       unzip "$1"       ;;
      *.Z)         uncompress "$1"  ;;
      *.7z)        7z x "$1"        ;;
      *)           echo "'$1' cannot be extracted via extract()" ;;
    esac
  else
    echo "'$1' is not a valid file"
  fi
}

# Load local customizations if they exist
if [ -f "$HOME/.zshrc.local" ]; then
  source "$HOME/.zshrc.local"
fi
EOF

# Install useful development tools
echo "🛠️  Installing useful development tools..."

# Install htop if not present
if ! command -v htop &> /dev/null; then
  echo "Installing htop (you may need sudo)..."
  # Uncomment the line below if you have sudo access
  # sudo apt install -y htop
fi

# Install exa (better ls) if not present
if ! command -v exa &> /dev/null; then
  echo "Installing exa for better ls output..."
  if command -v cargo &> /dev/null; then
    cargo install exa
  else
    echo "Install Rust first to get exa: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  fi
fi

# Install bat (better cat) if not present
if ! command -v bat &> /dev/null; then
  echo "Installing bat for better cat output..."
  if command -v cargo &> /dev/null; then
    cargo install bat
  fi
fi

# Update ls aliases if exa is available
if command -v exa &> /dev/null; then
  cat >> "$HOME/.zshrc" << 'EOF'

# Better ls with exa
if command -v exa &> /dev/null; then
  alias ls='exa'
  alias ll='exa -la --git'
  alias la='exa -la --git'
  alias l='exa -l --git'
  alias tree='exa --tree'
fi

# Better cat with bat
if command -v bat &> /dev/null; then
  alias cat='bat'
fi
EOF
fi

# Set Zsh as default shell
echo "🐚 Setting Zsh as default shell..."
if [ "$SHELL" != "$(which zsh)" ]; then
  chsh -s $(which zsh)
fi

echo "✅ Zsh setup complete!"
echo "🔄 Restart your terminal or run 'zsh' to start using your new configuration"
echo "📝 You can add custom configurations to ~/.zshrc.local"