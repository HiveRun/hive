defmodule HiveServerElixir.Opencode.Generated.Config do
  @moduledoc """
  Provides struct and type for a Config
  """

  @type t :: %__MODULE__{
          "$schema": String.t() | nil,
          agent: HiveServerElixir.Opencode.Generated.ConfigAgent.t() | nil,
          autoshare: boolean | nil,
          autoupdate: boolean | String.t() | nil,
          command: map | nil,
          compaction: HiveServerElixir.Opencode.Generated.ConfigCompaction.t() | nil,
          default_agent: String.t() | nil,
          disabled_providers: [String.t()] | nil,
          enabled_providers: [String.t()] | nil,
          enterprise: HiveServerElixir.Opencode.Generated.ConfigEnterprise.t() | nil,
          experimental: HiveServerElixir.Opencode.Generated.ConfigExperimental.t() | nil,
          formatter: false | map | nil,
          instructions: [String.t()] | nil,
          layout: String.t() | nil,
          logLevel: String.t() | nil,
          lsp: false | map | nil,
          mcp: map | nil,
          mode: HiveServerElixir.Opencode.Generated.ConfigMode.t() | nil,
          model: String.t() | nil,
          permission: map | String.t() | nil,
          plugin: [String.t()] | nil,
          provider: map | nil,
          server: HiveServerElixir.Opencode.Generated.ServerConfig.t() | nil,
          share: String.t() | nil,
          skills: HiveServerElixir.Opencode.Generated.ConfigSkills.t() | nil,
          small_model: String.t() | nil,
          snapshot: boolean | nil,
          tools: map | nil,
          username: String.t() | nil,
          watcher: HiveServerElixir.Opencode.Generated.ConfigWatcher.t() | nil
        }

  defstruct [
    :"$schema",
    :agent,
    :autoshare,
    :autoupdate,
    :command,
    :compaction,
    :default_agent,
    :disabled_providers,
    :enabled_providers,
    :enterprise,
    :experimental,
    :formatter,
    :instructions,
    :layout,
    :logLevel,
    :lsp,
    :mcp,
    :mode,
    :model,
    :permission,
    :plugin,
    :provider,
    :server,
    :share,
    :skills,
    :small_model,
    :snapshot,
    :tools,
    :username,
    :watcher
  ]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      "$schema": :string,
      agent: {HiveServerElixir.Opencode.Generated.ConfigAgent, :t},
      autoshare: :boolean,
      autoupdate: {:union, [:boolean, const: "notify"]},
      command: :map,
      compaction: {HiveServerElixir.Opencode.Generated.ConfigCompaction, :t},
      default_agent: :string,
      disabled_providers: [:string],
      enabled_providers: [:string],
      enterprise: {HiveServerElixir.Opencode.Generated.ConfigEnterprise, :t},
      experimental: {HiveServerElixir.Opencode.Generated.ConfigExperimental, :t},
      formatter: {:union, [:map, const: false]},
      instructions: [:string],
      layout: {:enum, ["auto", "stretch"]},
      logLevel: {:enum, ["DEBUG", "INFO", "WARN", "ERROR"]},
      lsp: {:union, [:map, const: false]},
      mcp: :map,
      mode: {HiveServerElixir.Opencode.Generated.ConfigMode, :t},
      model: :string,
      permission: {:union, [:map, enum: ["ask", "allow", "deny"]]},
      plugin: [:string],
      provider: :map,
      server: {HiveServerElixir.Opencode.Generated.ServerConfig, :t},
      share: {:enum, ["manual", "auto", "disabled"]},
      skills: {HiveServerElixir.Opencode.Generated.ConfigSkills, :t},
      small_model: :string,
      snapshot: :boolean,
      tools: :map,
      username: :string,
      watcher: {HiveServerElixir.Opencode.Generated.ConfigWatcher, :t}
    ]
  end
end
