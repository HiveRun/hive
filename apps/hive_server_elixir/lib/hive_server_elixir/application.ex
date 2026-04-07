defmodule HiveServerElixir.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        HiveServerElixirWeb.Telemetry,
        HiveServerElixir.Repo,
        {Registry, keys: :unique, name: HiveServerElixir.Opencode.EventIngestRegistry},
        {Registry, keys: :unique, name: HiveServerElixir.Cells.ProvisioningRegistry},
        {DynamicSupervisor,
         strategy: :one_for_one, name: HiveServerElixir.Opencode.EventIngestSupervisor},
        {DynamicSupervisor,
         strategy: :one_for_one, name: HiveServerElixir.Cells.ProvisioningSupervisor},
        {DynamicSupervisor,
         strategy: :one_for_one, name: HiveServerElixir.Opencode.ServerManager.Supervisor},
        {Ecto.Migrator,
         repos: Application.fetch_env!(:hive_server_elixir, :ecto_repos), skip: skip_migrations?()},
        {Oban,
         AshOban.config(
           Application.fetch_env!(:hive_server_elixir, :ash_domains),
           Application.fetch_env!(:hive_server_elixir, Oban)
         )}
      ] ++
        opencode_server_manager_children() ++
        workspace_bootstrap_children() ++
        [
          {
            DNSCluster,
            # Start a worker by calling: HiveServerElixir.Worker.start_link(arg)
            # {HiveServerElixir.Worker, arg},
            # Start to serve requests, typically the last entry
            query: Application.get_env(:hive_server_elixir, :dns_cluster_query) || :ignore
          },
          {Phoenix.PubSub, name: HiveServerElixir.PubSub},
          {HiveServerElixir.Cells.TerminalRuntime, name: HiveServerElixir.Cells.TerminalRuntime},
          {HiveServerElixir.Cells.ServiceRuntime, name: HiveServerElixir.Cells.ServiceRuntime},
          HiveServerElixirWeb.Endpoint
        ] ++ provisioning_bootstrap_children()

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

  defp skip_migrations?(), do: not run_migrations_on_start?()

  defp opencode_server_manager_children do
    if Keyword.get(
         Application.get_env(:hive_server_elixir, :opencode_server_manager, []),
         :enabled,
         true
       ) do
      [{HiveServerElixir.Opencode.ServerManager, []}]
    else
      []
    end
  end

  defp run_migrations_on_start? do
    Application.get_env(
      :hive_server_elixir,
      :run_migrations_on_start,
      System.get_env("RELEASE_NAME") != nil
    )
  end

  defp workspace_bootstrap_children do
    if Application.get_env(:hive_server_elixir, :workspace_bootstrap, true) do
      [
        Supervisor.child_spec(
          {Task, fn -> HiveServerElixir.Workspaces.bootstrap_current_workspace() end},
          id: :workspace_bootstrap_task
        )
      ]
    else
      []
    end
  end

  defp provisioning_bootstrap_children do
    if Application.get_env(:hive_server_elixir, :cell_provisioning_bootstrap, true) do
      [
        Supervisor.child_spec(
          {Task, fn -> HiveServerElixir.Cells.ProvisioningRuntime.resume_incomplete_cells() end},
          id: :cell_provisioning_bootstrap_task
        )
      ]
    else
      []
    end
  end
end
