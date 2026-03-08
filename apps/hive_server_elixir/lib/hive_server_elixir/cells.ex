defmodule HiveServerElixir.Cells do
  @moduledoc """
  Ash domain for workspace and cell lifecycle records.
  """

  import Ash.Expr
  require Ash.Query

  use Ash.Domain, extensions: [AshTypescript.Rpc]

  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Reactors.CreateCell
  alias HiveServerElixir.Cells.Reactors.DeleteCell
  alias HiveServerElixir.Cells.Reactors.ResumeCell
  alias HiveServerElixir.Cells.Reactors.RetryCell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixir.Cells.Workspace

  typescript_rpc do
    resource HiveServerElixir.Cells.Workspace do
      rpc_action :list_workspaces, :ui_list
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
      rpc_action :list_services, :list_services
      rpc_action :start_services, :start_services
      rpc_action :stop_services, :stop_services
      rpc_action :restart_services, :restart_services
    end

    resource HiveServerElixir.Cells.Service do
      rpc_action :start_service, :start_service
      rpc_action :stop_service, :stop_service
      rpc_action :restart_service, :restart_service
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

  @spec create_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def create_cell(input) when is_map(input) do
    prepared_input =
      input
      |> Map.put_new(:name, "Cell")
      |> Map.put_new(:template_id, "default-template")
      |> Map.put_new(:start_mode, "plan")
      |> Map.put_new(:workspace_root_path, ".")
      |> Map.put_new(:workspace_path, ".")

    Reactor.run(CreateCell, prepared_input)
  end

  @spec retry_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def retry_cell(input) when is_map(input) do
    Reactor.run(RetryCell, input)
  end

  @spec resume_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def resume_cell(input) when is_map(input) do
    Reactor.run(ResumeCell, input)
  end

  @spec delete_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def delete_cell(input) when is_map(input) do
    Reactor.run(DeleteCell, input)
  end

  def create_cell_rpc(input) when is_map(input) do
    workspace_id = Map.fetch!(input, :workspace_id)
    description = Map.get(input, :description)

    with {:ok, workspace} <- Ash.get(Workspace, workspace_id, domain: __MODULE__),
         {:ok, cell} <-
           create_cell(%{
             workspace_id: workspace_id,
             name: normalize_cell_name(Map.get(input, :name), description),
             description: description,
             template_id: normalize_template_id(Map.get(input, :template_id)),
             start_mode: normalize_start_mode(Map.get(input, :start_mode)),
             workspace_root_path: workspace.path,
             workspace_path: workspace.path,
             runtime_opts: runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      {:ok, rpc_cell_payload(cell)}
    end
  end

  def retry_cell_setup_rpc(input) when is_map(input) do
    with {:ok, cell} <-
           retry_cell(%{
             cell_id: Map.fetch!(input, :cell_id),
             runtime_opts: runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- record_retry_activity(cell.id, input),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      {:ok, rpc_cell_payload(cell)}
    end
  end

  def resume_cell_setup_rpc(input) when is_map(input) do
    with {:ok, cell} <-
           resume_cell(%{
             cell_id: Map.fetch!(input, :cell_id),
             runtime_opts: runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      {:ok, rpc_cell_payload(cell)}
    end
  end

  def delete_cell_rpc(input) when is_map(input) do
    with {:ok, cell} <-
           delete_cell(%{
             cell_id: Map.fetch!(input, :cell_id),
             runtime_opts: runtime_opts(),
             fail_after_stop: false
           }),
         :ok <- Events.publish_cell_removed(cell.workspace_id, cell.id) do
      {:ok, %{deleted_id: cell.id, workspace_id: cell.workspace_id}}
    end
  end

  def delete_many_cells_rpc(input) when is_map(input) do
    ids =
      input
      |> Map.get(:ids, [])
      |> Enum.uniq()

    {deleted_ids, failed_ids} =
      Enum.reduce(ids, {[], []}, fn id, {deleted_ids, failed_ids} ->
        case delete_cell_rpc(%{cell_id: id}) do
          {:ok, %{deleted_id: deleted_id}} -> {[deleted_id | deleted_ids], failed_ids}
          {:error, _error} -> {deleted_ids, [id | failed_ids]}
        end
      end)

    {:ok,
     %{
       deleted_ids: Enum.reverse(deleted_ids),
       failed_ids: Enum.reverse(failed_ids)
     }}
  end

  def list_services_rpc(input) when is_map(input) do
    cell_id = Map.fetch!(input, :cell_id)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: __MODULE__) do
      {:ok, ServiceSnapshot.list_rpc_payloads(cell_id, service_snapshot_options(input))}
    end
  end

  def start_service_rpc(input) when is_map(input) do
    with {:ok, service} <- Ash.get(Service, Map.fetch!(input, :service_id), domain: __MODULE__),
         :ok <- ensure_runtime_start(service),
         {:ok, updated_service} <- Ash.get(Service, service.id, domain: __MODULE__) do
      _ = record_service_activity(service.cell_id, service.id, "service.start", input, %{})
      {:ok, ServiceSnapshot.rpc_payload(updated_service)}
    end
  end

  def stop_service_rpc(input) when is_map(input) do
    with {:ok, service} <- Ash.get(Service, Map.fetch!(input, :service_id), domain: __MODULE__),
         :ok <- ensure_runtime_stop(service),
         {:ok, updated_service} <- Ash.get(Service, service.id, domain: __MODULE__) do
      _ = record_service_activity(service.cell_id, service.id, "service.stop", input, %{})
      {:ok, ServiceSnapshot.rpc_payload(updated_service)}
    end
  end

  def restart_service_rpc(input) when is_map(input) do
    with {:ok, service} <- Ash.get(Service, Map.fetch!(input, :service_id), domain: __MODULE__),
         :ok <- ensure_runtime_restart(service),
         {:ok, updated_service} <- Ash.get(Service, service.id, domain: __MODULE__) do
      _ =
        record_service_activity(service.cell_id, service.id, "service.restart", input, %{
          "serviceName" => service.name
        })

      {:ok, ServiceSnapshot.rpc_payload(updated_service)}
    end
  end

  def start_services_rpc(input) when is_map(input) do
    cell_id = Map.fetch!(input, :cell_id)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: __MODULE__),
         :ok <- start_all_services(cell_id) do
      _ = record_service_activity(cell_id, nil, "services.start", input, %{})
      {:ok, ServiceSnapshot.list_rpc_payloads(cell_id)}
    end
  end

  def stop_services_rpc(input) when is_map(input) do
    cell_id = Map.fetch!(input, :cell_id)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: __MODULE__),
         :ok <- stop_all_services(cell_id) do
      _ = record_service_activity(cell_id, nil, "services.stop", input, %{})
      {:ok, ServiceSnapshot.list_rpc_payloads(cell_id)}
    end
  end

  def restart_services_rpc(input) when is_map(input) do
    cell_id = Map.fetch!(input, :cell_id)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: __MODULE__),
         :ok <- restart_all_services(cell_id) do
      _ = record_service_activity(cell_id, nil, "services.restart", input, %{})
      {:ok, ServiceSnapshot.list_rpc_payloads(cell_id)}
    end
  end

  defp runtime_opts do
    Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts, [])
  end

  defp record_retry_activity(cell_id, input) do
    attrs = %{
      cell_id: cell_id,
      type: "setup.retry",
      source: Map.get(input, :source),
      tool_name: Map.get(input, :tool_name),
      metadata:
        %{}
        |> maybe_put_metadata("auditEvent", Map.get(input, :audit_event))
        |> maybe_put_metadata("serviceName", Map.get(input, :service_name))
    }

    case Ash.create(Activity, attrs, domain: __MODULE__) do
      {:ok, _activity} -> :ok
      {:error, _error} -> :ok
    end
  end

  defp record_service_activity(cell_id, service_id, type, audit, metadata) do
    attrs =
      %{
        cell_id: cell_id,
        type: type,
        source: Map.get(audit, :source),
        tool_name: Map.get(audit, :tool_name),
        metadata: merge_audit_metadata(audit, metadata || %{})
      }
      |> maybe_put_service_id(service_id)

    case Ash.create(Activity, attrs, domain: __MODULE__) do
      {:ok, _activity} -> :ok
      {:error, _error} -> :ok
    end
  end

  defp service_snapshot_options(input) do
    %{
      include_resources: Map.get(input, :include_resources, false),
      lines: Map.get(input, :log_lines) || 200,
      offset: Map.get(input, :log_offset) || 0
    }
  end

  defp merge_audit_metadata(audit, metadata) when is_map(metadata) do
    metadata
    |> maybe_put_metadata("auditEvent", Map.get(audit, :audit_event))
    |> maybe_put_metadata("serviceName", Map.get(audit, :service_name))
  end

  defp maybe_put_service_id(attrs, nil), do: attrs
  defp maybe_put_service_id(attrs, service_id), do: Map.put(attrs, :service_id, service_id)

  defp ensure_runtime_start(%Service{} = service) do
    case ServiceRuntime.start_service(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  defp ensure_runtime_stop(%Service{} = service) do
    case ServiceRuntime.stop_service(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  defp ensure_runtime_restart(%Service{} = service) do
    case ServiceRuntime.restart_service(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  defp restart_all_services(cell_id) do
    cell_id
    |> list_services_for_cell()
    |> Enum.reduce_while(:ok, fn service, :ok ->
      case ensure_runtime_restart(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp start_all_services(cell_id) do
    cell_id
    |> list_services_for_cell()
    |> Enum.reduce_while(:ok, fn service, :ok ->
      case ensure_runtime_start(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp stop_all_services(cell_id) do
    cell_id
    |> list_services_for_cell()
    |> Enum.reduce_while(:ok, fn service, :ok ->
      case ensure_runtime_stop(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp list_services_for_cell(cell_id) do
    Service
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read!(domain: __MODULE__)
  end

  defp maybe_put_metadata(metadata, _key, nil), do: metadata
  defp maybe_put_metadata(metadata, key, value), do: Map.put(metadata, key, value)

  defp rpc_cell_payload(cell) do
    %{
      id: cell.id,
      name: cell.name,
      workspace_id: cell.workspace_id,
      description: cell.description,
      template_id: cell.template_id,
      workspace_root_path: cell.workspace_root_path,
      workspace_path: cell.workspace_path,
      opencode_session_id: cell.opencode_session_id,
      opencode_command: build_opencode_command(cell.workspace_path, cell.opencode_session_id),
      created_at: maybe_to_iso8601(cell.inserted_at),
      status: HiveServerElixir.Cells.CellStatus.present(cell.status),
      last_setup_error: cell.last_setup_error,
      branch_name: cell.branch_name,
      base_commit: cell.base_commit,
      updated_at: maybe_to_iso8601(cell.updated_at)
    }
  end

  defp build_opencode_command(workspace_path, session_id)
       when is_binary(workspace_path) and workspace_path != "" and is_binary(session_id) and
              session_id != "" do
    "opencode \"" <> workspace_path <> "\" --session \"" <> session_id <> "\""
  end

  defp build_opencode_command(_workspace_path, _session_id), do: nil

  defp maybe_to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp maybe_to_iso8601(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp maybe_to_iso8601(value) when is_binary(value), do: value
  defp maybe_to_iso8601(_value), do: nil

  defp normalize_cell_name(name, _description) when is_binary(name) and byte_size(name) > 0,
    do: name

  defp normalize_cell_name(_name, description)
       when is_binary(description) and byte_size(description) > 0,
       do: description

  defp normalize_cell_name(_name, _description), do: "Cell"

  defp normalize_template_id(template_id)
       when is_binary(template_id) and byte_size(template_id) > 0,
       do: template_id

  defp normalize_template_id(_template_id), do: "default-template"

  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode(_mode), do: "plan"
end
