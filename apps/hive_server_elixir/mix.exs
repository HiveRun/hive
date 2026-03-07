defmodule HiveServerElixir.MixProject do
  use Mix.Project

  def project do
    [
      app: :hive_server_elixir,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      usage_rules: usage_rules(),
      compilers: [:phoenix_live_view] ++ Mix.compilers(),
      listeners: [Phoenix.CodeReloader],
      consolidate_protocols: Mix.env() != :dev
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {HiveServerElixir.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:sourceror, "~> 1.8", only: [:dev, :test]},
      {:oban, "~> 2.0"},
      {:ash_typescript, "~> 0.15"},
      {:usage_rules, "~> 1.0", only: [:dev]},
      {:ash_ai, "~> 0.5"},
      {:tidewave, "~> 0.5", only: [:dev]},
      {:ash_state_machine, "~> 0.2"},
      {:oban_web, "~> 2.0"},
      {:ash_oban, "~> 0.7"},
      {:ash_sqlite, "~> 0.2"},
      {:ash_phoenix, "~> 2.0"},
      {:ash, "~> 3.0"},
      {:igniter, "~> 0.6", only: [:dev, :test]},
      {:phoenix, "~> 1.8.4"},
      {:phoenix_ecto, "~> 4.5"},
      {:ecto_sql, "~> 3.13"},
      {:ecto_sqlite3, ">= 0.0.0"},
      {:phoenix_html, "~> 4.1"},
      {:phoenix_live_reload, "~> 1.2", only: :dev},
      {:phoenix_live_view, "~> 1.1.0"},
      {:lazy_html, ">= 0.1.0", only: :test},
      {:phoenix_live_dashboard, "~> 0.8.3"},
      {:esbuild, "~> 0.10", runtime: Mix.env() == :dev},
      {:tailwind, "~> 0.3", runtime: Mix.env() == :dev},
      {:heroicons,
       github: "tailwindlabs/heroicons",
       tag: "v2.2.0",
       sparse: "optimized",
       app: false,
       compile: false,
       depth: 1},
      {:swoosh, "~> 1.16"},
      {:req, "~> 0.5"},
      {:oapi_generator, "~> 0.4", only: [:dev, :test]},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:gettext, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup", "assets.setup", "assets.build"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ash.setup --quiet", "test"],
      "assets.setup": ["tailwind.install --if-missing", "esbuild.install --if-missing"],
      "assets.build": ["compile", "tailwind hive_server_elixir", "esbuild hive_server_elixir"],
      "assets.deploy": [
        "tailwind hive_server_elixir --minify",
        "esbuild hive_server_elixir --minify",
        "phx.digest"
      ],
      "opencode.gen.client": ["api.gen opencode priv/opencode/openapi.json"],
      "opencode.refresh": ["opencode.sync_spec", "opencode.gen.client"],
      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"],
      "ash.setup": ["ash.setup", "run priv/repo/seeds.exs"]
    ]
  end

  defp usage_rules do
    [
      skills: [
        location: "../../.agents/skills",
        build: [
          "ash-framework": [
            description:
              "Use this when working with Ash Framework and its extensions. Always consult this when making domain, resource, action, or policy changes.",
            usage_rules: [
              :ash,
              :ash_ai,
              :ash_oban,
              :ash_phoenix,
              :ash_sqlite,
              :ash_state_machine,
              :ash_typescript
            ]
          ]
        ],
        deps: [~r/.*/]
      ]
    ]
  end
end
