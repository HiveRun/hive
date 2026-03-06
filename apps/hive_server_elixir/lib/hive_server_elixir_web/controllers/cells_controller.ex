defmodule HiveServerElixirWeb.CellsController do
  use HiveServerElixirWeb, :controller

  import Ash.Expr
  require Ash.Query

  alias Ash.Error.Invalid.InvalidPrimaryKey
  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Diff
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.ResourceSummary
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace
  @service_stream_heartbeat_ms 15_000
  @preserve_nil_service_keys MapSet.new([:cpuPercent, :rssBytes])

  def index(conn, params) do
    workspace_id = read_param(params, "workspaceId", "workspace_id")

    query =
      Cell
      |> Ash.Query.filter(expr(status != "deleting"))
      |> maybe_filter_workspace(workspace_id)
      |> Ash.Query.sort(inserted_at: :asc)

    cells = Ash.read!(query, domain: Cells)
    workspaces = preload_workspaces(cells)

    payload =
      Enum.map(cells, fn cell ->
        serialize_cell(cell, %{
          workspace: Map.get(workspaces, cell.workspace_id),
          include_setup_log: false
        })
      end)

    json(conn, %{cells: payload})
  end

  def show(conn, %{"id" => id} = params) do
    include_setup_log = parse_boolean_param(Map.get(params, "includeSetupLog"), true)

    case Ash.get(Cell, id, domain: Cells) do
      {:ok, %Cell{status: "deleting"}} ->
        conn
        |> put_status(:not_found)
        |> json(%{message: "Cell not found"})

      {:ok, %Cell{} = cell} ->
        workspace = fetch_workspace(cell.workspace_id)

        json(
          conn,
          serialize_cell(cell, %{workspace: workspace, include_setup_log: include_setup_log})
        )

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def create(conn, params) do
    workspace_id = read_param(params, "workspaceId", "workspace_id")
    description = read_param(params, "description")
    name = normalize_cell_name(read_param(params, "name"), description)
    template_id = normalize_template_id(read_param(params, "templateId", "template_id"))

    with :ok <- validate_workspace_id(workspace_id),
         :ok <- validate_description(description),
         {:ok, workspace} <- Ash.get(Workspace, workspace_id, domain: Cells),
         {:ok, cell} <-
           Cells.create_cell(%{
             workspace_id: workspace_id,
             name: name,
             description: description,
             template_id: template_id,
             workspace_root_path: workspace.path,
             workspace_path: workspace.path,
             runtime_opts: runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      conn
      |> put_status(:created)
      |> json(serialize_cell(cell, %{workspace: workspace, include_setup_log: false}))
    else
      {:error, :invalid_workspace_id} ->
        bad_request(conn, "workspaceId is required")

      {:error, :invalid_description} ->
        bad_request(conn, "description must be a string when provided")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def retry(conn, %{"id" => id}) do
    case Cells.retry_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_ingest: false}) do
      {:ok, cell} ->
        :ok = Events.publish_cell_status(cell.workspace_id, cell.id)
        workspace = fetch_workspace(cell.workspace_id)
        json(conn, serialize_cell(cell, %{workspace: workspace, include_setup_log: false}))

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def resume(conn, %{"id" => id}) do
    case Cells.resume_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_ingest: false}) do
      {:ok, cell} ->
        :ok = Events.publish_cell_status(cell.workspace_id, cell.id)
        workspace = fetch_workspace(cell.workspace_id)
        json(conn, serialize_cell(cell, %{workspace: workspace, include_setup_log: false}))

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def delete(conn, %{"id" => id}) do
    case Cells.delete_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_stop: false}) do
      {:ok, %Cell{} = cell} ->
        :ok = Events.publish_cell_removed(cell.workspace_id, cell.id)
        json(conn, %{message: "Cell deleted successfully"})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def delete_many(conn, params) do
    ids = Map.get(params, "ids")

    if is_list(ids) do
      deleted_ids =
        ids
        |> Enum.filter(&is_binary/1)
        |> Enum.uniq()
        |> Enum.reduce([], fn id, acc ->
          case Cells.delete_cell(%{
                 cell_id: id,
                 runtime_opts: runtime_opts(),
                 fail_after_stop: false
               }) do
            {:ok, %Cell{} = cell} ->
              :ok = Events.publish_cell_removed(cell.workspace_id, cell.id)
              [id | acc]

            {:error, _error} ->
              acc
          end
        end)
        |> Enum.reverse()

      if deleted_ids == [] do
        conn
        |> put_status(:not_found)
        |> json(%{message: "No cells found for provided ids"})
      else
        json(conn, %{deletedIds: deleted_ids})
      end
    else
      bad_request(conn, "ids must be a non-empty array")
    end
  end

  def workspace_stream(conn, %{"workspace_id" => workspace_id} = params) do
    with {:ok, _workspace} <- Ash.get(Workspace, workspace_id, domain: Cells),
         :ok <- Events.subscribe_workspace(workspace_id) do
      stream_conn =
        conn
        |> put_resp_content_type("text/event-stream")
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_header("connection", "keep-alive")
        |> send_chunked(200)

      with {:ok, stream_conn} <-
             send_sse(stream_conn, "ready", %{timestamp: System.system_time(:millisecond)}),
           {:ok, stream_conn} <- send_workspace_snapshot(stream_conn, workspace_id),
           {:ok, stream_conn} <-
             send_sse(stream_conn, "snapshot", %{timestamp: System.system_time(:millisecond)}) do
        idle_timeout_ms = parse_idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          stream_workspace_events(stream_conn, workspace_id, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, :service_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{code: "not_found", message: "Service not found"}})

      {:error, reason} ->
        if contains_error?(reason, NotFound) do
          conn
          |> put_status(:not_found)
          |> json(%{error: %{code: "workspace_not_found", message: "Workspace not found"}})
        else
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: %{code: "stream_failed", message: inspect(reason)}})
        end
    end
  end

  def timing_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_cell_timing(cell_id) do
      stream_conn =
        conn
        |> put_resp_content_type("text/event-stream")
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_header("connection", "keep-alive")
        |> send_chunked(200)

      with {:ok, stream_conn} <-
             send_sse(stream_conn, "ready", %{timestamp: System.system_time(:millisecond)}),
           {:ok, stream_conn} <- send_timing_snapshot(stream_conn, cell_id),
           {:ok, stream_conn} <-
             send_sse(stream_conn, "snapshot", %{timestamp: System.system_time(:millisecond)}) do
        idle_timeout_ms = parse_idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          stream_timing_events(stream_conn, cell_id, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, reason} ->
        if contains_error?(reason, NotFound) do
          conn
          |> put_status(:not_found)
          |> json(%{error: %{code: "not_found", message: "Cell not found"}})
        else
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: %{code: "stream_failed", message: inspect(reason)}})
        end
    end
  end

  def setup_terminal_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_setup_terminal(cell_id) do
      stream_conn =
        conn
        |> put_resp_content_type("text/event-stream")
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_header("connection", "keep-alive")
        |> send_chunked(200)

      session = TerminalRuntime.ensure_setup_session(cell_id)
      ready_payload = %{session: session, setupState: setup_state_for(cell), lastSetupError: nil}
      output = TerminalRuntime.read_setup_output(cell_id)

      with {:ok, stream_conn} <- send_sse(stream_conn, "ready", ready_payload),
           {:ok, stream_conn} <- send_sse(stream_conn, "snapshot", %{output: output}) do
        idle_timeout_ms = parse_idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          stream_setup_terminal_events(stream_conn, cell_id, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, reason} ->
        if contains_error?(reason, NotFound) do
          conn
          |> put_status(:not_found)
          |> json(%{error: %{code: "not_found", message: "Cell not found"}})
        else
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: %{code: "stream_failed", message: inspect(reason)}})
        end
    end
  end

  def setup_terminal_resize(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, cols, rows} <- parse_resize_params(params) do
      session = TerminalRuntime.resize_setup_session(cell_id, cols, rows)
      json(conn, %{ok: true, session: session})
    else
      {:error, :service_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{code: "not_found", message: "Service not found"}})

      {:error, :invalid_resize} ->
        bad_request(conn, "cols and rows must be positive integers")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def setup_terminal_input(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, chunk} <- parse_input(params) do
      _session = TerminalRuntime.ensure_setup_session(cell_id)
      :ok = TerminalRuntime.write_setup_input(cell_id, chunk)
      :ok = Events.publish_setup_terminal_data(cell_id, chunk)
      json(conn, %{ok: true})
    else
      {:error, :service_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{code: "not_found", message: "Service not found"}})

      {:error, :invalid_input} ->
        bad_request(conn, "data must be a string")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def service_terminal_stream(conn, %{"id" => cell_id, "service_id" => service_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, service} <- get_service_for_cell(cell_id, service_id),
         :ok <- ensure_service_runtime(service),
         :ok <- Events.subscribe_service_terminal(cell_id, service_id) do
      session = TerminalRuntime.ensure_service_session(cell_id, service_id)
      output = TerminalRuntime.read_service_output(cell_id, service_id)

      stream_conn =
        conn
        |> put_resp_content_type("text/event-stream")
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_header("connection", "keep-alive")
        |> send_chunked(200)

      with {:ok, stream_conn} <- send_sse(stream_conn, "ready", %{session: session}),
           {:ok, stream_conn} <- send_sse(stream_conn, "snapshot", %{output: output}) do
        idle_timeout_ms = parse_idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          stream_service_terminal_events(stream_conn, cell_id, service_id, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "stream_failed", message: "Service runtime unavailable"}})

      {:error, reason} ->
        if contains_error?(reason, NotFound) do
          conn
          |> put_status(:not_found)
          |> json(%{error: %{code: "not_found", message: "Service not found"}})
        else
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: %{code: "stream_failed", message: inspect(reason)}})
        end
    end
  end

  def service_terminal_resize(conn, %{"id" => cell_id, "service_id" => service_id} = params) do
    with {:ok, _service} <- get_service_for_cell(cell_id, service_id),
         {:ok, cols, rows} <- parse_resize_params(params) do
      session = TerminalRuntime.resize_service_session(cell_id, service_id, cols, rows)
      json(conn, %{ok: true, session: session})
    else
      {:error, :invalid_resize} -> bad_request(conn, "cols and rows must be positive integers")
      {:error, error} -> render_cell_error(conn, error)
    end
  end

  def service_terminal_input(conn, %{"id" => cell_id, "service_id" => service_id} = params) do
    with {:ok, service} <- get_service_for_cell(cell_id, service_id),
         :ok <- ensure_service_runtime(service),
         {:ok, chunk} <- parse_input(params) do
      :ok = ServiceRuntime.write_input(service_id, chunk)
      json(conn, %{ok: true})
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, :invalid_input} ->
        bad_request(conn, "data must be a string")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def chat_terminal_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- validate_chat_available(cell),
         :ok <- Events.subscribe_chat_terminal(cell_id) do
      session = TerminalRuntime.ensure_chat_session(cell_id)
      output = TerminalRuntime.read_chat_output(cell_id)

      stream_conn =
        conn
        |> put_resp_content_type("text/event-stream")
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_header("connection", "keep-alive")
        |> send_chunked(200)

      with {:ok, stream_conn} <- send_sse(stream_conn, "ready", session),
           {:ok, stream_conn} <- send_sse(stream_conn, "snapshot", %{output: output}) do
        idle_timeout_ms = parse_idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          stream_chat_terminal_events(stream_conn, cell_id, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, :chat_unavailable} ->
        conn
        |> put_status(:conflict)
        |> json(%{
          error: %{
            code: "chat_unavailable",
            message: "Chat terminal is unavailable until provisioning completes"
          }
        })

      {:error, reason} ->
        if contains_error?(reason, NotFound) do
          conn
          |> put_status(:not_found)
          |> json(%{error: %{code: "not_found", message: "Cell not found"}})
        else
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: %{code: "stream_failed", message: inspect(reason)}})
        end
    end
  end

  def chat_terminal_resize(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- validate_chat_available(cell),
         {:ok, cols, rows} <- parse_resize_params(params) do
      session = TerminalRuntime.resize_chat_session(cell_id, cols, rows)
      json(conn, %{ok: true, session: session})
    else
      {:error, :chat_unavailable} ->
        conn
        |> put_status(:conflict)
        |> json(%{
          error: %{
            code: "chat_unavailable",
            message: "Chat terminal is unavailable until provisioning completes"
          }
        })

      {:error, :invalid_resize} ->
        bad_request(conn, "cols and rows must be positive integers")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def chat_terminal_input(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- validate_chat_available(cell),
         {:ok, chunk} <- parse_input(params) do
      _session = TerminalRuntime.ensure_chat_session(cell_id)
      :ok = TerminalRuntime.write_chat_input(cell_id, chunk)
      :ok = Events.publish_chat_terminal_data(cell_id, chunk)
      json(conn, %{ok: true})
    else
      {:error, :chat_unavailable} ->
        conn
        |> put_status(:conflict)
        |> json(%{
          error: %{
            code: "chat_unavailable",
            message: "Chat terminal is unavailable until provisioning completes"
          }
        })

      {:error, :invalid_input} ->
        bad_request(conn, "data must be a string")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def chat_terminal_restart(conn, %{"id" => cell_id}) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- validate_chat_available(cell) do
      session = TerminalRuntime.restart_chat_session(cell_id)
      :ok = Events.publish_chat_terminal_exit(cell_id, 0, nil)
      json(conn, session)
    else
      {:error, :chat_unavailable} ->
        conn
        |> put_status(:conflict)
        |> json(%{
          error: %{
            code: "chat_unavailable",
            message: "Chat terminal is unavailable until provisioning completes"
          }
        })

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def services(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells) do
      services =
        Service
        |> Ash.Query.filter(expr(cell_id == ^cell_id))
        |> Ash.Query.sort(inserted_at: :asc)
        |> Ash.read!(domain: Cells)

      payload = Enum.map(services, &serialize_service_payload(&1, params))
      json(conn, %{services: payload})
    else
      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def services_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_cell_services(cell_id) do
      stream_conn =
        conn
        |> put_resp_content_type("text/event-stream")
        |> put_resp_header("cache-control", "no-cache")
        |> put_resp_header("connection", "keep-alive")
        |> send_chunked(200)

      with {:ok, stream_conn} <-
             send_sse(stream_conn, "ready", %{timestamp: System.system_time(:millisecond)}),
           {:ok, stream_conn} <- send_services_snapshot(stream_conn, cell_id, params),
           {:ok, stream_conn} <-
             send_sse(stream_conn, "snapshot", %{timestamp: System.system_time(:millisecond)}) do
        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          stream_service_events(stream_conn, cell_id, params)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, reason} ->
        if contains_error?(reason, NotFound) do
          conn
          |> put_status(:not_found)
          |> json(%{error: %{code: "not_found", message: "Cell not found"}})
        else
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: %{code: "stream_failed", message: inspect(reason)}})
        end
    end
  end

  def service_start(conn, %{"id" => cell_id, "service_id" => service_id}) do
    audit = read_audit_headers(conn)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, service} <- get_service_for_cell(cell_id, service_id),
         :ok <- ensure_runtime_start(service),
         {:ok, updated_service} <- Ash.get(Service, service.id, domain: Cells) do
      _ = record_service_activity(cell_id, service_id, "service.start", audit, %{})
      json(conn, serialize_service_payload(updated_service, %{}))
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def service_stop(conn, %{"id" => cell_id, "service_id" => service_id}) do
    audit = read_audit_headers(conn)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, service} <- get_service_for_cell(cell_id, service_id),
         :ok <- ensure_runtime_stop(service),
         {:ok, updated_service} <- Ash.get(Service, service.id, domain: Cells) do
      _ = record_service_activity(cell_id, service_id, "service.stop", audit, %{})
      json(conn, serialize_service_payload(updated_service, %{}))
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def service_restart(conn, %{"id" => cell_id, "service_id" => service_id}) do
    audit = read_audit_headers(conn)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, service} <- get_service_for_cell(cell_id, service_id),
         :ok <- ensure_runtime_restart(service),
         {:ok, updated_service} <- Ash.get(Service, service.id, domain: Cells) do
      _ =
        record_service_activity(cell_id, service_id, "service.restart", audit, %{
          serviceName: service.name
        })

      json(conn, serialize_service_payload(updated_service, %{}))
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def services_restart(conn, %{"id" => cell_id}) do
    audit = read_audit_headers(conn)

    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- restart_all_services(cell_id) do
      _ = record_service_activity(cell_id, nil, "services.restart", audit, %{})

      services =
        Service
        |> Ash.Query.filter(expr(cell_id == ^cell_id))
        |> Ash.Query.sort(inserted_at: :asc)
        |> Ash.read!(domain: Cells)

      json(conn, %{services: Enum.map(services, &serialize_service_payload(&1, %{}))})
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def services_start(conn, %{"id" => cell_id}) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- start_all_services(cell_id) do
      services =
        Service
        |> Ash.Query.filter(expr(cell_id == ^cell_id))
        |> Ash.Query.sort(inserted_at: :asc)
        |> Ash.read!(domain: Cells)

      json(conn, %{services: Enum.map(services, &serialize_service_payload(&1, %{}))})
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def services_stop(conn, %{"id" => cell_id}) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- stop_all_services(cell_id) do
      services =
        Service
        |> Ash.Query.filter(expr(cell_id == ^cell_id))
        |> Ash.Query.sort(inserted_at: :asc)
        |> Ash.read!(domain: Cells)

      json(conn, %{services: Enum.map(services, &serialize_service_payload(&1, %{}))})
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def activity(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells) do
      limit = parse_activity_limit(Map.get(params, "limit"))
      types = parse_activity_types(Map.get(params, "types"))
      cursor = parse_activity_cursor(Map.get(params, "cursor"))

      query =
        Activity
        |> Ash.Query.filter(expr(cell_id == ^cell_id))
        |> maybe_filter_activity_types(types)
        |> maybe_filter_activity_cursor(cursor)
        |> Ash.Query.sort(inserted_at: :desc, id: :desc)
        |> Ash.Query.limit(limit + 1)

      events = Ash.read!(query, domain: Cells)

      {page, next_cursor} =
        if length(events) > limit do
          sliced = Enum.take(events, limit)

          cursor_value =
            case List.last(sliced) do
              nil -> nil
              event -> encode_activity_cursor(event.inserted_at, event.id)
            end

          {sliced, cursor_value}
        else
          {events, nil}
        end

      json(conn, %{events: Enum.map(page, &serialize_activity/1), nextCursor: next_cursor})
    else
      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def timings_global(conn, params) do
    limit = parse_timing_limit(Map.get(params, "limit"))
    workflow = parse_timing_workflow(Map.get(params, "workflow"))
    run_id = Map.get(params, "runId")
    workspace_id = Map.get(params, "workspaceId")
    cell_id = Map.get(params, "cellId")

    timings =
      Timing
      |> maybe_filter_timing_cell_id(cell_id)
      |> maybe_filter_timing_workflow(workflow)
      |> maybe_filter_timing_run_id(run_id)
      |> maybe_filter_timing_workspace_id(workspace_id)
      |> Ash.Query.sort(inserted_at: :desc, id: :desc)
      |> Ash.Query.limit(1_000)
      |> Ash.read!(domain: Cells)

    payload_steps = timings |> Enum.take(limit) |> Enum.map(&serialize_timing/1)
    payload_runs = build_timing_runs(timings)

    json(conn, %{steps: payload_steps, runs: payload_runs})
  end

  def timings(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells) do
      limit = parse_timing_limit(Map.get(params, "limit"))
      workflow = parse_timing_workflow(Map.get(params, "workflow"))
      run_id = Map.get(params, "runId")

      timings =
        Timing
        |> Ash.Query.filter(expr(cell_id == ^cell_id))
        |> maybe_filter_timing_workflow(workflow)
        |> maybe_filter_timing_run_id(run_id)
        |> Ash.Query.sort(inserted_at: :desc, id: :desc)
        |> Ash.Query.limit(1_000)
        |> Ash.read!(domain: Cells)

      payload_steps = timings |> Enum.take(limit) |> Enum.map(&serialize_timing/1)
      payload_runs = build_timing_runs(timings)

      json(conn, %{steps: payload_steps, runs: payload_runs})
    else
      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def diff(conn, %{"id" => id} = params) do
    case Ash.get(Cell, id, domain: Cells) do
      {:ok, cell} ->
        case Diff.build_payload(cell, params) do
          {:ok, payload} ->
            json(conn, payload)

          {:error, {status, message}} ->
            conn
            |> put_status(status)
            |> json(%{message: message})
        end

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def resources(conn, %{"id" => id}) do
    case Ash.get(Cell, id, domain: Cells) do
      {:ok, %Cell{} = cell} ->
        include_history = parse_boolean_param(read_param(conn.params, "includeHistory"), false)
        include_averages = parse_boolean_param(read_param(conn.params, "includeAverages"), false)
        include_rollups = parse_boolean_param(read_param(conn.params, "includeRollups"), false)
        history_limit = parse_resource_limit(read_param(conn.params, "historyLimit"), 180)
        rollup_limit = parse_resource_limit(read_param(conn.params, "rollupLimit"), 96)

        summary =
          ResourceSummary.build(cell, %{
            include_history: include_history,
            include_averages: include_averages,
            include_rollups: include_rollups,
            history_limit: history_limit,
            rollup_limit: rollup_limit
          })

        resources = resource_snapshot(cell.id)

        json(
          conn,
          Map.merge(summary, %{
            resources: resources,
            failures: failure_states(cell, resources)
          })
        )

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  defp runtime_opts do
    Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts, [])
  end

  defp validate_workspace_id(workspace_id)
       when is_binary(workspace_id) and byte_size(workspace_id) > 0,
       do: :ok

  defp validate_workspace_id(_), do: {:error, :invalid_workspace_id}

  defp validate_description(nil), do: :ok
  defp validate_description(description) when is_binary(description), do: :ok
  defp validate_description(_), do: {:error, :invalid_description}

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

  defp fetch_workspace(workspace_id) when is_binary(workspace_id) do
    case Ash.get(Workspace, workspace_id, domain: Cells) do
      {:ok, workspace} -> workspace
      {:error, _error} -> nil
    end
  end

  defp fetch_workspace(_workspace_id), do: nil

  defp preload_workspaces(cells) when is_list(cells) do
    cells
    |> Enum.map(& &1.workspace_id)
    |> Enum.uniq()
    |> Enum.reduce(%{}, fn workspace_id, acc ->
      case fetch_workspace(workspace_id) do
        nil -> acc
        workspace -> Map.put(acc, workspace_id, workspace)
      end
    end)
  end

  defp parse_boolean_param(value, _default) when is_boolean(value), do: value
  defp parse_boolean_param("true", _default), do: true
  defp parse_boolean_param("1", _default), do: true
  defp parse_boolean_param("false", _default), do: false
  defp parse_boolean_param("0", _default), do: false
  defp parse_boolean_param(_value, default), do: default

  defp normalize_cell_status("provisioning"), do: "pending"
  defp normalize_cell_status(status), do: status

  defp serialize_cell(%Cell{} = cell, opts) do
    workspace = Map.get(opts, :workspace)
    include_setup_log = Map.get(opts, :include_setup_log, false)
    workspace_path = if workspace && is_binary(workspace.path), do: workspace.path, else: ""
    setup_payload = maybe_setup_log_payload(cell.id, include_setup_log)

    %{
      id: cell.id,
      name: cell.name,
      workspaceId: cell.workspace_id,
      description: cell.description,
      templateId: cell.template_id,
      workspaceRootPath: present_or_fallback(cell.workspace_root_path, workspace_path),
      workspacePath: present_or_fallback(cell.workspace_path, workspace_path),
      opencodeSessionId: cell.opencode_session_id,
      opencodeCommand: build_opencode_command(cell.workspace_path, cell.opencode_session_id),
      createdAt: maybe_to_iso8601(cell.inserted_at),
      status: normalize_cell_status(cell.status),
      lastSetupError: cell.last_setup_error,
      branchName: cell.branch_name,
      baseCommit: cell.base_commit,
      updatedAt: maybe_to_iso8601(cell.updated_at)
    }
    |> Map.merge(setup_payload)
    |> maybe_drop_nil("lastSetupError")
    |> maybe_drop_nil("branchName")
    |> maybe_drop_nil("baseCommit")
  end

  defp maybe_setup_log_payload(_cell_id, false), do: %{}

  defp maybe_setup_log_payload(cell_id, true) do
    output = TerminalRuntime.read_setup_output(cell_id)
    setup_log = output |> Enum.join("") |> String.trim()

    %{
      setupLog: if(setup_log == "", do: nil, else: setup_log),
      setupLogPath: nil
    }
  end

  defp present_or_fallback(value, _fallback) when is_binary(value) and byte_size(value) > 0,
    do: value

  defp present_or_fallback(_value, fallback), do: fallback

  defp build_opencode_command(workspace_path, session_id)
       when is_binary(workspace_path) and workspace_path != "" and is_binary(session_id) and
              session_id != "" do
    "opencode \"" <> workspace_path <> "\" --session \"" <> session_id <> "\""
  end

  defp build_opencode_command(_workspace_path, _session_id), do: nil

  defp maybe_drop_nil(map, key) do
    case Map.get(map, key) do
      nil -> Map.delete(map, key)
      _value -> map
    end
  end

  defp serialize_service(%Service{} = service) do
    %{
      id: service.id,
      cellId: service.cell_id,
      name: service.name,
      type: service.type,
      status: service.status,
      pid: service.pid,
      port: service.port,
      command: service.command,
      cwd: service.cwd,
      env: service.env,
      lastKnownError: service.last_known_error,
      insertedAt: maybe_to_iso8601(service.inserted_at),
      updatedAt: maybe_to_iso8601(service.updated_at)
    }
  end

  defp serialize_service_payload(%Service{} = service, params) do
    log_options = parse_log_options(params)
    include_resources = Map.get(log_options, :include_resources, false)
    {recent_logs, total_log_lines, has_more_logs} = service_log_tail(service, log_options)

    runtime_status = ServiceRuntime.runtime_status(service.id)

    process_alive =
      case runtime_status do
        %{status: "running"} -> true
        _other -> os_pid_alive?(service.pid)
      end

    {derived_status, derived_last_known_error} =
      derive_service_state(service.status, service.last_known_error, process_alive)

    derived_pid =
      case runtime_status do
        %{status: "running", pid: pid} when is_integer(pid) -> pid
        _other when process_alive -> service.pid
        _other -> nil
      end

    service =
      maybe_persist_derived_service(
        service,
        derived_status,
        derived_last_known_error,
        derived_pid
      )

    resource_payload =
      if include_resources do
        build_service_resource_payload(derived_pid, process_alive)
      else
        %{}
      end

    url = build_service_url(service.port)
    port_reachable = if is_integer(service.port), do: port_reachable?(service.port), else: nil

    %{
      id: service.id,
      name: service.name,
      type: service.type,
      status: derived_status,
      command: service.command,
      cwd: service.cwd,
      logPath: nil,
      lastKnownError: derived_last_known_error,
      env: service.env,
      updatedAt: maybe_to_iso8601(service.updated_at),
      recentLogs: recent_logs,
      totalLogLines: total_log_lines,
      hasMoreLogs: has_more_logs,
      processAlive: process_alive,
      portReachable: port_reachable,
      url: url,
      pid: derived_pid,
      port: service.port
    }
    |> Map.merge(resource_payload)
    |> drop_nil_values()
  end

  defp serialize_provisioning(nil), do: nil

  defp serialize_provisioning(%Provisioning{} = provisioning) do
    %{
      id: provisioning.id,
      cellId: provisioning.cell_id,
      attemptCount: provisioning.attempt_count,
      startMode: provisioning.start_mode,
      startedAt: maybe_to_iso8601(provisioning.started_at),
      finishedAt: maybe_to_iso8601(provisioning.finished_at),
      insertedAt: maybe_to_iso8601(provisioning.inserted_at),
      updatedAt: maybe_to_iso8601(provisioning.updated_at)
    }
  end

  defp serialize_agent_session(nil), do: nil

  defp serialize_agent_session(%AgentSession{} = session) do
    %{
      id: session.id,
      cellId: session.cell_id,
      sessionId: session.session_id,
      currentMode: session.current_mode,
      modelId: session.model_id,
      modelProviderId: session.model_provider_id,
      lastError: session.last_error,
      insertedAt: maybe_to_iso8601(session.inserted_at),
      updatedAt: maybe_to_iso8601(session.updated_at)
    }
  end

  defp serialize_activity(nil), do: nil

  defp serialize_activity(%Activity{} = activity) do
    %{
      id: activity.id,
      cellId: activity.cell_id,
      serviceId: activity.service_id,
      type: activity.type,
      source: activity.source,
      toolName: activity.tool_name,
      metadata: activity.metadata,
      createdAt: maybe_to_iso8601(activity.inserted_at)
    }
  end

  defp serialize_timing(nil), do: nil

  defp serialize_timing(%Timing{} = timing) do
    %{
      id: timing.id,
      cellId: timing.cell_id,
      cellName: timing.cell_name,
      workspaceId: timing.workspace_id,
      templateId: timing.template_id,
      runId: timing.run_id,
      workflow: timing.workflow,
      step: timing.step,
      status: timing.status,
      attempt: timing.attempt,
      error: timing.error,
      metadata: timing.metadata,
      durationMs: timing.duration_ms,
      createdAt: maybe_to_iso8601(timing.inserted_at)
    }
  end

  defp resource_snapshot(cell_id) do
    provisioning = find_one_by_cell(Provisioning, cell_id)
    services = list_by_cell(Service, cell_id)
    agent_session = find_one_by_cell(AgentSession, cell_id)
    latest_activity = find_latest_by_cell(Activity, cell_id)
    latest_timing = find_latest_by_cell(Timing, cell_id)

    %{
      provisioning: serialize_provisioning(provisioning),
      services: Enum.map(services, &serialize_service/1),
      agentSession: serialize_agent_session(agent_session),
      latestActivity: serialize_activity(latest_activity),
      latestTiming: serialize_timing(latest_timing)
    }
  end

  defp find_one_by_cell(resource, cell_id) do
    resource
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one(domain: Cells)
    |> case do
      {:ok, value} -> value
      {:error, _reason} -> nil
    end
  end

  defp find_latest_by_cell(resource, cell_id) do
    resource
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :desc)
    |> Ash.Query.limit(1)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, [value | _]} -> value
      {:ok, []} -> nil
      {:error, _reason} -> nil
    end
  end

  defp list_by_cell(resource, cell_id) do
    resource
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, values} -> values
      {:error, _reason} -> []
    end
  end

  defp maybe_filter_workspace(query, workspace_id)
       when is_binary(workspace_id) and byte_size(workspace_id) > 0 do
    Ash.Query.filter(query, expr(workspace_id == ^workspace_id))
  end

  defp maybe_filter_workspace(query, _workspace_id), do: query

  defp parse_activity_limit(value) when is_integer(value), do: clamp(value, 1, 200)

  defp parse_activity_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp(parsed, 1, 200)
      _result -> 50
    end
  end

  defp parse_activity_limit(_value), do: 50

  defp parse_activity_types(value) when is_binary(value) do
    types =
      value
      |> String.split(",")
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))

    if types == [], do: nil, else: types
  end

  defp parse_activity_types(_value), do: nil

  defp parse_activity_cursor(nil), do: nil

  defp parse_activity_cursor(value) when is_binary(value) do
    case String.split(value, ":", parts: 2) do
      [millis, id] when id != "" ->
        with {parsed_millis, ""} <- Integer.parse(millis),
             {:ok, datetime} <- DateTime.from_unix(parsed_millis, :millisecond) do
          %{created_at: datetime, id: id}
        else
          _error -> nil
        end

      _other ->
        nil
    end
  end

  defp parse_activity_cursor(_value), do: nil

  defp encode_activity_cursor(nil, _id), do: nil

  defp encode_activity_cursor(datetime, id) do
    Integer.to_string(DateTime.to_unix(datetime, :millisecond)) <> ":" <> id
  end

  defp maybe_filter_activity_types(query, nil), do: query
  defp maybe_filter_activity_types(query, []), do: query

  defp maybe_filter_activity_types(query, types) when is_list(types) do
    Ash.Query.filter(query, expr(type in ^types))
  end

  defp maybe_filter_activity_cursor(query, nil), do: query

  defp maybe_filter_activity_cursor(query, %{created_at: created_at, id: id}) do
    Ash.Query.filter(
      query,
      expr(inserted_at < ^created_at or (inserted_at == ^created_at and id < ^id))
    )
  end

  defp parse_timing_limit(value) when is_integer(value), do: clamp(value, 1, 1_000)

  defp parse_timing_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp(parsed, 1, 1_000)
      _result -> 200
    end
  end

  defp parse_timing_limit(_value), do: 200

  defp parse_timing_workflow("create"), do: "create"
  defp parse_timing_workflow("delete"), do: "delete"
  defp parse_timing_workflow(_value), do: nil

  defp maybe_filter_timing_workflow(query, nil), do: query

  defp maybe_filter_timing_workflow(query, workflow) do
    Ash.Query.filter(query, expr(workflow == ^workflow))
  end

  defp maybe_filter_timing_run_id(query, run_id)
       when is_binary(run_id) and byte_size(run_id) > 0 do
    Ash.Query.filter(query, expr(run_id == ^run_id))
  end

  defp maybe_filter_timing_run_id(query, _run_id), do: query

  defp maybe_filter_timing_workspace_id(query, workspace_id)
       when is_binary(workspace_id) and byte_size(workspace_id) > 0 do
    Ash.Query.filter(query, expr(workspace_id == ^workspace_id))
  end

  defp maybe_filter_timing_workspace_id(query, _workspace_id), do: query

  defp maybe_filter_timing_cell_id(query, cell_id)
       when is_binary(cell_id) and byte_size(cell_id) > 0 do
    Ash.Query.filter(query, expr(cell_id == ^cell_id))
  end

  defp maybe_filter_timing_cell_id(query, _cell_id), do: query

  defp build_timing_runs(timings) when is_list(timings) do
    timings
    |> Enum.group_by(& &1.run_id)
    |> Enum.map(fn {run_id, run_steps} ->
      ordered = Enum.sort_by(run_steps, & &1.inserted_at, {:asc, DateTime})
      first = List.first(ordered)
      last = List.last(ordered)
      total_step = Enum.find(ordered, &(&1.step == "total"))

      total_duration_ms =
        case total_step do
          nil -> Enum.reduce(ordered, 0, fn step, acc -> acc + (step.duration_ms || 0) end)
          step -> step.duration_ms || 0
        end

      status = if Enum.any?(ordered, &(&1.status == "error")), do: "error", else: "ok"
      attempt = ordered |> Enum.find_value(fn step -> step.attempt end)

      %{
        runId: run_id,
        cellId: first && first.cell_id,
        cellName: first && first.cell_name,
        workspaceId: first && first.workspace_id,
        templateId: first && first.template_id,
        workflow: first && first.workflow,
        status: status,
        startedAt: first && maybe_to_iso8601(first.inserted_at),
        finishedAt: last && maybe_to_iso8601(last.inserted_at),
        totalDurationMs: total_duration_ms,
        stepCount: length(ordered),
        attempt: attempt
      }
    end)
    |> Enum.sort_by(& &1.finishedAt, {:desc, String})
  end

  defp failure_states(cell, resources) do
    []
    |> maybe_add_failure(cell.status == "error" and is_nil(resources.provisioning), %{
      code: "provisioning_missing",
      resource: "provisioning",
      message: "Cell is in error status without provisioning state"
    })
    |> maybe_add_failure(cell.status in ["ready", "error"] and is_nil(resources.agentSession), %{
      code: "agent_session_missing",
      resource: "agent_session",
      message: "Cell lifecycle is missing an agent session"
    })
    |> maybe_add_service_failures(resources.services)
    |> maybe_add_failure(is_binary(agent_session_error(resources.agentSession)), %{
      code: "agent_session_error",
      resource: "agent_session",
      message: agent_session_error(resources.agentSession)
    })
  end

  defp maybe_add_service_failures(failures, services) do
    Enum.reduce(services, failures, fn service, acc ->
      should_add = service.status == "error" or is_binary(service.lastKnownError)

      maybe_add_failure(acc, should_add, %{
        code: "service_error",
        resource: "service",
        message: service.lastKnownError || "Service is in error status",
        serviceId: service.id,
        serviceName: service.name
      })
    end)
  end

  defp maybe_add_failure(failures, true, failure), do: [failure | failures]
  defp maybe_add_failure(failures, false, _failure), do: failures

  defp agent_session_error(%{lastError: last_error}) when is_binary(last_error), do: last_error
  defp agent_session_error(_session), do: nil

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)

  defp send_workspace_snapshot(conn, workspace_id) do
    Cell
    |> Ash.Query.filter(expr(workspace_id == ^workspace_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, cells} ->
        workspaces = preload_workspaces(cells)

        Enum.reduce_while(cells, {:ok, conn}, fn cell, {:ok, stream_conn} ->
          payload = serialize_cell(cell, %{workspace: Map.get(workspaces, cell.workspace_id)})

          case send_sse(stream_conn, "cell", payload) do
            {:ok, next_conn} -> {:cont, {:ok, next_conn}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp stream_workspace_events(conn, workspace_id, idle_timeout_ms) do
    receive do
      {:cell_status, %{workspace_id: ^workspace_id, cell_id: cell_id}} ->
        case Ash.get(Cell, cell_id, domain: Cells) do
          {:ok, cell} ->
            workspace = fetch_workspace(cell.workspace_id)

            case send_sse(conn, "cell", serialize_cell(cell, %{workspace: workspace})) do
              {:ok, next_conn} ->
                stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          {:error, %NotFound{}} ->
            case send_sse(conn, "cell_removed", %{id: cell_id}) do
              {:ok, next_conn} ->
                stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          {:error, _reason} ->
            stream_workspace_events(conn, workspace_id, idle_timeout_ms)
        end

      {:cell_removed, %{workspace_id: ^workspace_id, cell_id: cell_id}} ->
        case send_sse(conn, "cell_removed", %{id: cell_id}) do
          {:ok, next_conn} -> stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  defp send_timing_snapshot(conn, cell_id) do
    Timing
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, timings} ->
        Enum.reduce_while(timings, {:ok, conn}, fn timing, {:ok, stream_conn} ->
          case send_sse(stream_conn, "timing", serialize_timing(timing)) do
            {:ok, next_conn} -> {:cont, {:ok, next_conn}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp stream_timing_events(conn, cell_id, idle_timeout_ms) do
    receive do
      {:cell_timing, %{cell_id: ^cell_id, timing_id: timing_id}} ->
        case Ash.get(Timing, timing_id, domain: Cells) do
          {:ok, timing} ->
            case send_sse(conn, "timing", serialize_timing(timing)) do
              {:ok, next_conn} -> stream_timing_events(next_conn, cell_id, idle_timeout_ms)
              {:error, _reason} -> conn
            end

          {:error, _reason} ->
            stream_timing_events(conn, cell_id, idle_timeout_ms)
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  defp stream_setup_terminal_events(conn, cell_id, idle_timeout_ms) do
    receive do
      {:setup_terminal_data, %{cell_id: ^cell_id, chunk: chunk}} ->
        case send_sse(conn, "data", %{chunk: chunk}) do
          {:ok, next_conn} -> stream_setup_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: exit_code, signal: signal}} ->
        case send_sse(conn, "exit", %{exitCode: exit_code, signal: signal}) do
          {:ok, next_conn} -> stream_setup_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:setup_terminal_error, %{cell_id: ^cell_id, message: message}} ->
        case send_sse(conn, "error", %{message: message}) do
          {:ok, next_conn} -> stream_setup_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  defp stream_service_terminal_events(conn, cell_id, service_id, idle_timeout_ms) do
    receive do
      {:service_terminal_data, %{cell_id: ^cell_id, service_id: ^service_id, chunk: chunk}} ->
        case send_sse(conn, "data", %{chunk: chunk}) do
          {:ok, next_conn} ->
            stream_service_terminal_events(next_conn, cell_id, service_id, idle_timeout_ms)

          {:error, _reason} ->
            conn
        end

      {:service_terminal_exit,
       %{cell_id: ^cell_id, service_id: ^service_id, exit_code: exit_code, signal: signal}} ->
        case send_sse(conn, "exit", %{exitCode: exit_code, signal: signal}) do
          {:ok, next_conn} ->
            stream_service_terminal_events(next_conn, cell_id, service_id, idle_timeout_ms)

          {:error, _reason} ->
            conn
        end

      {:service_terminal_error, %{cell_id: ^cell_id, service_id: ^service_id, message: message}} ->
        case send_sse(conn, "error", %{message: message}) do
          {:ok, next_conn} ->
            stream_service_terminal_events(next_conn, cell_id, service_id, idle_timeout_ms)

          {:error, _reason} ->
            conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  defp stream_chat_terminal_events(conn, cell_id, idle_timeout_ms) do
    receive do
      {:chat_terminal_data, %{cell_id: ^cell_id, chunk: chunk}} ->
        case send_sse(conn, "data", %{chunk: chunk}) do
          {:ok, next_conn} -> stream_chat_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:chat_terminal_exit, %{cell_id: ^cell_id, exit_code: exit_code, signal: signal}} ->
        case send_sse(conn, "exit", %{exitCode: exit_code, signal: signal}) do
          {:ok, next_conn} -> stream_chat_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:chat_terminal_error, %{cell_id: ^cell_id, message: message}} ->
        case send_sse(conn, "error", %{message: message}) do
          {:ok, next_conn} -> stream_chat_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  defp send_services_snapshot(conn, cell_id, params) do
    Service
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, services} ->
        Enum.reduce_while(services, {:ok, conn}, fn service, {:ok, stream_conn} ->
          case send_sse(stream_conn, "service", serialize_service_payload(service, params)) do
            {:ok, next_conn} -> {:cont, {:ok, next_conn}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp stream_service_events(conn, cell_id, params) do
    receive do
      {:service_update, %{cell_id: ^cell_id, service_id: service_id}} ->
        case Ash.get(Service, service_id, domain: Cells) do
          {:ok, service} ->
            case send_sse(conn, "service", serialize_service_payload(service, params)) do
              {:ok, next_conn} -> stream_service_events(next_conn, cell_id, params)
              {:error, _reason} -> conn
            end

          {:error, _reason} ->
            stream_service_events(conn, cell_id, params)
        end
    after
      @service_stream_heartbeat_ms ->
        case send_sse(conn, "heartbeat", %{timestamp: System.system_time(:millisecond)}) do
          {:ok, next_conn} -> stream_service_events(next_conn, cell_id, params)
          {:error, _reason} -> conn
        end
    end
  end

  defp validate_chat_available(%Cell{status: "ready"}), do: :ok
  defp validate_chat_available(_cell), do: {:error, :chat_unavailable}

  defp parse_input(params) do
    case read_param(params, "data") do
      value when is_binary(value) -> {:ok, value}
      _value -> {:error, :invalid_input}
    end
  end

  defp parse_resize_params(params) do
    cols = parse_positive_integer(read_param(params, "cols"))
    rows = parse_positive_integer(read_param(params, "rows"))

    if is_integer(cols) and is_integer(rows) do
      {:ok, cols, rows}
    else
      {:error, :invalid_resize}
    end
  end

  defp parse_positive_integer(value) when is_integer(value) and value > 0, do: value

  defp parse_positive_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} when parsed > 0 -> parsed
      _result -> nil
    end
  end

  defp parse_positive_integer(_value), do: nil

  defp parse_log_options(params) do
    lines = parse_log_lines(Map.get(params, "logLines"))
    offset = parse_log_offset(Map.get(params, "logOffset"))
    include_resources = parse_boolean_param(Map.get(params, "includeResources"), false)
    %{lines: lines, offset: offset, include_resources: include_resources}
  end

  defp build_service_resource_payload(pid, process_alive) do
    sampled_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    %{
      cpuPercent: nil,
      rssBytes: nil,
      resourceSampledAt: sampled_at,
      resourceUnavailableReason: service_resource_unavailable_reason(pid, process_alive)
    }
  end

  defp service_resource_unavailable_reason(pid, _process_alive) when not is_integer(pid),
    do: "pid_missing"

  defp service_resource_unavailable_reason(_pid, false), do: "process_not_alive"
  defp service_resource_unavailable_reason(_pid, true), do: "sample_failed"

  defp parse_log_lines(value) when is_integer(value), do: clamp(value, 1, 2_000)

  defp parse_log_lines(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp(parsed, 1, 2_000)
      _result -> 200
    end
  end

  defp parse_log_lines(_value), do: 200

  defp parse_log_offset(value) when is_integer(value), do: max(value, 0)

  defp parse_log_offset(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> max(parsed, 0)
      _result -> 0
    end
  end

  defp parse_log_offset(_value), do: 0

  defp parse_resource_limit(value, _default) when is_integer(value), do: clamp(value, 1, 10_000)

  defp parse_resource_limit(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp(parsed, 1, 10_000)
      _result -> default
    end
  end

  defp parse_resource_limit(_value, default), do: default

  defp clamp(value, min, _max) when value < min, do: min
  defp clamp(value, _min, max) when value > max, do: max
  defp clamp(value, _min, _max), do: value

  defp get_service_for_cell(cell_id, service_id) do
    case Ash.get(Service, service_id, domain: Cells) do
      {:ok, %Service{cell_id: ^cell_id} = service} -> {:ok, service}
      {:ok, _service} -> {:error, :service_not_found}
      {:error, error} -> {:error, error}
    end
  end

  defp service_log_tail(%Service{} = service, %{lines: lines, offset: offset}) do
    chunks = TerminalRuntime.read_service_output(service.cell_id, service.id)

    if chunks == [] do
      {nil, nil, false}
    else
      output = Enum.join(chunks, "")
      normalized = String.replace(output, "\r\n", "\n") |> String.replace("\r", "\n")
      all_lines = String.split(normalized, "\n")
      total_lines = length(all_lines)

      end_index = max(total_lines - offset, 0)
      start_index = max(end_index - lines, 0)
      selected = Enum.slice(all_lines, start_index, end_index - start_index)
      content = selected |> Enum.join("\n") |> String.trim_trailing()

      {if(content == "", do: nil, else: content), total_lines, start_index > 0}
    end
  end

  defp derive_service_state("running", last_known_error, false) do
    {"error", last_known_error || "Process exited unexpectedly"}
  end

  defp derive_service_state("error", _last_known_error, true) do
    {"running", nil}
  end

  defp derive_service_state(status, last_known_error, _alive) do
    {status, last_known_error}
  end

  defp maybe_persist_derived_service(%Service{} = service, status, last_known_error, pid) do
    should_persist =
      status != service.status ||
        last_known_error != service.last_known_error ||
        pid != service.pid

    if should_persist do
      case Ash.update(service, %{status: status, last_known_error: last_known_error, pid: pid},
             domain: Cells
           ) do
        {:ok, updated} ->
          updated

        {:error, _error} ->
          %{service | status: status, last_known_error: last_known_error, pid: pid}
      end
    else
      service
    end
  end

  defp os_pid_alive?(pid) when is_integer(pid) and pid > 0 do
    case System.cmd("kill", ["-0", Integer.to_string(pid)], stderr_to_stdout: true) do
      {_output, 0} -> true
      {_output, _status} -> false
    end
  rescue
    _error ->
      false
  end

  defp os_pid_alive?(_pid), do: false

  defp port_reachable?(port) when is_integer(port) and port > 0 do
    case :gen_tcp.connect(~c"127.0.0.1", port, [:binary, active: false], 150) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        true

      {:error, _reason} ->
        false
    end
  end

  defp port_reachable?(_port), do: false

  defp build_service_url(port) when is_integer(port) and port > 0,
    do: "http://localhost:" <> Integer.to_string(port)

  defp build_service_url(_port), do: nil

  defp drop_nil_values(map) when is_map(map) do
    map
    |> Enum.reject(fn {key, value} ->
      is_nil(value) and not MapSet.member?(@preserve_nil_service_keys, key)
    end)
    |> Map.new()
  end

  defp ensure_service_runtime(%Service{} = service) do
    case ServiceRuntime.ensure_service_running(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

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
    services =
      Service
      |> Ash.Query.filter(expr(cell_id == ^cell_id))
      |> Ash.Query.sort(inserted_at: :asc)
      |> Ash.read!(domain: Cells)

    Enum.reduce_while(services, :ok, fn service, :ok ->
      case ensure_runtime_restart(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp start_all_services(cell_id) do
    services =
      Service
      |> Ash.Query.filter(expr(cell_id == ^cell_id))
      |> Ash.Query.sort(inserted_at: :asc)
      |> Ash.read!(domain: Cells)

    Enum.reduce_while(services, :ok, fn service, :ok ->
      case ensure_runtime_start(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp stop_all_services(cell_id) do
    services =
      Service
      |> Ash.Query.filter(expr(cell_id == ^cell_id))
      |> Ash.Query.sort(inserted_at: :asc)
      |> Ash.read!(domain: Cells)

    Enum.reduce_while(services, :ok, fn service, :ok ->
      case ensure_runtime_stop(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp record_service_activity(cell_id, service_id, type, audit, metadata) do
    attrs =
      %{
        cell_id: cell_id,
        type: type,
        source: audit.source,
        tool_name: audit.tool_name,
        metadata: merge_audit_metadata(audit, metadata || %{})
      }
      |> maybe_put_service_id(service_id)

    case Ash.create(Activity, attrs, domain: Cells) do
      {:ok, _activity} -> :ok
      {:error, _error} -> :ok
    end
  end

  defp maybe_put_service_id(attrs, nil), do: attrs
  defp maybe_put_service_id(attrs, service_id), do: Map.put(attrs, :service_id, service_id)

  defp read_audit_headers(conn) do
    %{
      source: request_header(conn, "x-hive-source"),
      tool_name: request_header(conn, "x-hive-tool"),
      audit_event: request_header(conn, "x-hive-audit-event"),
      service_name: request_header(conn, "x-hive-service-name")
    }
  end

  defp request_header(conn, header) do
    case Plug.Conn.get_req_header(conn, header) do
      [value | _rest] -> value
      [] -> nil
    end
  end

  defp merge_audit_metadata(audit, metadata) when is_map(metadata) do
    metadata
    |> maybe_put_metadata("auditEvent", audit.audit_event)
    |> maybe_put_metadata("serviceName", audit.service_name)
  end

  defp maybe_put_metadata(metadata, _key, nil), do: metadata
  defp maybe_put_metadata(metadata, key, value), do: Map.put(metadata, key, value)

  defp setup_state_for(%Cell{status: "ready"}), do: "completed"
  defp setup_state_for(%Cell{status: "error"}), do: "error"
  defp setup_state_for(_cell), do: "running"

  defp send_sse(conn, event, data) do
    encoded = Jason.encode!(data)

    conn
    |> chunk("event: #{event}\ndata: #{encoded}\n\n")
    |> case do
      {:ok, next_conn} -> {:ok, next_conn}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_idle_timeout_ms(nil, default), do: default

  defp parse_idle_timeout_ms(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {timeout, ""} when timeout >= 0 -> timeout
      _ -> default
    end
  end

  defp parse_idle_timeout_ms(_value, default), do: default

  defp read_param(params, key, fallback_key \\ nil) do
    Map.get(params, key) || if(fallback_key, do: Map.get(params, fallback_key), else: nil)
  end

  defp bad_request(conn, message) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: %{code: "bad_request", message: message}})
  end

  defp render_cell_error(conn, error) do
    {status, code} = classify_error(error)

    conn
    |> put_status(status)
    |> json(%{error: %{code: code, message: Exception.message(error)}})
  end

  defp classify_error(error) do
    cond do
      contains_error?(error, InvalidPrimaryKey) -> {:bad_request, "invalid_cell_id"}
      contains_error?(error, NotFound) -> {:not_found, "not_found"}
      true -> {:unprocessable_entity, "lifecycle_failed"}
    end
  end

  defp contains_error?(error, module) when is_atom(module) do
    case error do
      %{__struct__: ^module} ->
        true

      %{errors: errors} when is_list(errors) ->
        Enum.any?(errors, &contains_error?(&1, module))

      %{error: nested} ->
        contains_error?(nested, module)

      _ ->
        false
    end
  end
end
