defmodule HiveServerElixir.Cells do
  @moduledoc """
  Ash domain for workspace and cell lifecycle records.
  """

  use Ash.Domain, extensions: [AshTypescript.Rpc]

  alias HiveServerElixir.Cells.Service

  typescript_rpc do
    resource HiveServerElixir.Cells.Workspace do
      rpc_action :list_workspaces, :ui_list
      rpc_action :workspace_overview, :overview
      rpc_action :register_workspace, :register
      rpc_action :activate_workspace, :activate, identities: [:_primary_key]
      rpc_action :delete_workspace, :destroy, identities: [:_primary_key]
    end

    resource HiveServerElixir.Cells.Cell do
      rpc_action :list_cells, :ui_list
      rpc_action :get_cell, :ui_get, get?: true, not_found_error?: false
      rpc_action :create_cell, :create_cell
      rpc_action :retry_cell_setup, :retry_cell_setup
      rpc_action :resume_cell_setup, :resume_cell_setup
      rpc_action :delete_cell, :delete_cell
      rpc_action :delete_many_cells, :delete_many_cells
      rpc_action :setup_terminal_input, :setup_terminal_input
      rpc_action :setup_terminal_resize, :setup_terminal_resize
      rpc_action :setup_log, :setup_log
      rpc_action :chat_terminal_input, :chat_terminal_input
      rpc_action :chat_terminal_resize, :chat_terminal_resize
      rpc_action :chat_terminal_restart, :chat_terminal_restart
      rpc_action :list_services, :list_services
      rpc_action :start_services, :start_services
      rpc_action :stop_services, :stop_services
      rpc_action :restart_services, :restart_services
    end

    resource HiveServerElixir.Cells.Service do
      rpc_action :start_service, :start_service
      rpc_action :stop_service, :stop_service
      rpc_action :restart_service, :restart_service
      rpc_action :service_snapshot, :service_snapshot
      rpc_action :service_terminal_input, :service_terminal_input
      rpc_action :service_terminal_resize, :service_terminal_resize
    end

    resource HiveServerElixir.Cells.AgentSession do
      rpc_action :get_agent_session_by_cell, :get_session_by_cell
      rpc_action :set_agent_session_mode, :set_session_mode
    end

    resource HiveServerElixir.Cells.TerminalSession do
      rpc_action :list_terminal_sessions, :for_cell
    end

    resource HiveServerElixir.Cells.Activity do
      rpc_action :list_cell_activity, :for_cell
    end

    resource HiveServerElixir.Cells.Timing do
      rpc_action :list_cell_timings, :for_cell
      rpc_action :list_global_cell_timings, :global
    end
  end

  resources do
    resource HiveServerElixir.Cells.Workspace
    resource HiveServerElixir.Cells.Cell
    resource HiveServerElixir.Cells.Provisioning
    resource HiveServerElixir.Cells.Service
    resource HiveServerElixir.Cells.AgentSession
    resource HiveServerElixir.Cells.TerminalSession
    resource HiveServerElixir.Cells.Activity
    resource HiveServerElixir.Cells.Timing
  end

  @spec reconcile_service_runtime_inventory() :: {:ok, map()} | {:error, term()}
  def reconcile_service_runtime_inventory do
    Service
    |> Ash.ActionInput.for_action(:reconcile_runtime_inventory, %{})
    |> Ash.run_action(domain: __MODULE__)
  end
end
