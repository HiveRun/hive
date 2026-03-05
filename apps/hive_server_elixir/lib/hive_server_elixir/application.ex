defmodule HiveServerElixir.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      HiveServerElixirWeb.Telemetry,
      HiveServerElixir.Repo,
      {Registry, keys: :unique, name: HiveServerElixir.Opencode.EventIngestRegistry},
      {DynamicSupervisor,
       strategy: :one_for_one, name: HiveServerElixir.Opencode.EventIngestSupervisor},
      {Ecto.Migrator,
       repos: Application.fetch_env!(:hive_server_elixir, :ecto_repos), skip: skip_migrations?()},
      {Oban,
       AshOban.config(
         Application.fetch_env!(:hive_server_elixir, :ash_domains),
         Application.fetch_env!(:hive_server_elixir, Oban)
       )},
      {
        DNSCluster,
        # Start a worker by calling: HiveServerElixir.Worker.start_link(arg)
        # {HiveServerElixir.Worker, arg},
        # Start to serve requests, typically the last entry
        query: Application.get_env(:hive_server_elixir, :dns_cluster_query) || :ignore
      },
      {Phoenix.PubSub, name: HiveServerElixir.PubSub},
      {HiveServerElixir.Cells.TerminalRuntime, name: HiveServerElixir.Cells.TerminalRuntime},
      HiveServerElixirWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: HiveServerElixir.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    HiveServerElixirWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  defp skip_migrations?() do
    # By default, sqlite migrations are run when using a release
    System.get_env("RELEASE_NAME") == nil
  end
end
