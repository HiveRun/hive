defmodule HiveServerElixirWeb.CellsController do
  use HiveServerElixirWeb, :controller

  import Ash.Expr
  require Ash.Query

  alias Ash.Error.Invalid.InvalidPrimaryKey
  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixirWeb.Cells.StreamTransport
  alias HiveServerElixirWeb.CellsSerializer
  alias HiveServerElixirWeb.TerminalEvents
  @service_stream_heartbeat_ms 15_000

  def workspace_stream(conn, %{"workspace_id" => workspace_id} = params) do
    with {:ok, _workspace} <- Ash.get(Workspace, workspace_id, domain: Cells),
         :ok <- Events.subscribe_workspace(workspace_id) do
      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(stream_conn, "ready", %{
               timestamp: System.system_time(:millisecond)
             }),
           {:ok, stream_conn} <- send_workspace_snapshot(stream_conn, workspace_id),
           {:ok, stream_conn} <-
             StreamTransport.send_event(stream_conn, "snapshot", %{
               timestamp: System.system_time(:millisecond)
             }) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

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
      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(stream_conn, "ready", %{
               timestamp: System.system_time(:millisecond)
             }),
           {:ok, stream_conn} <- send_timing_snapshot(stream_conn, cell_id),
           {:ok, stream_conn} <-
             StreamTransport.send_event(stream_conn, "snapshot", %{
               timestamp: System.system_time(:millisecond)
             }) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

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
      stream_conn = StreamTransport.open_sse(conn)

      session = TerminalEvents.ensure_session(:setup, cell_id, nil)
      ready_payload = TerminalEvents.ready_payload(:setup, session, cell)
      output = TerminalEvents.read_output(:setup, cell_id, nil)

      with {:ok, stream_conn} <- StreamTransport.send_event(stream_conn, "ready", ready_payload),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               TerminalEvents.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_setup_terminal_events(stream_conn, cell_id, idle_timeout_ms)
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
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params) do
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
         {:ok, chunk} <- StreamTransport.parse_input(params) do
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
      session = TerminalEvents.ensure_session(:service, cell_id, service_id)
      output = TerminalEvents.read_output(:service, cell_id, service_id)

      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "ready",
               TerminalEvents.ready_payload(:service, session, nil)
             ),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               TerminalEvents.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_service_terminal_events(
            stream_conn,
            cell_id,
            service_id,
            idle_timeout_ms
          )
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
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params) do
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
         {:ok, chunk} <- StreamTransport.parse_input(params) do
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
      session = TerminalEvents.ensure_session(:chat, cell_id, nil)
      output = TerminalEvents.read_output(:chat, cell_id, nil)

      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <- StreamTransport.send_event(stream_conn, "ready", session),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               TerminalEvents.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_chat_terminal_events(stream_conn, cell_id, idle_timeout_ms)
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
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params) do
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
         {:ok, chunk} <- StreamTransport.parse_input(params) do
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

  def services_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_cell_services(cell_id) do
      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(stream_conn, "ready", %{
               timestamp: System.system_time(:millisecond)
             }),
           {:ok, stream_conn} <- send_services_snapshot(stream_conn, cell_id, params),
           {:ok, stream_conn} <-
             StreamTransport.send_event(stream_conn, "snapshot", %{
               timestamp: System.system_time(:millisecond)
             }) do
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

  defp serialize_cell(%Cell{} = cell, opts) do
    CellsSerializer.serialize_cell(cell,
      workspace: Map.get(opts, :workspace),
      include_setup_log: Map.get(opts, :include_setup_log, false)
    )
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

          case StreamTransport.send_event(stream_conn, "cell", payload) do
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

            case StreamTransport.send_event(
                   conn,
                   "cell",
                   serialize_cell(cell, %{workspace: workspace})
                 ) do
              {:ok, next_conn} ->
                stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          {:error, %NotFound{}} ->
            case StreamTransport.send_event(conn, "cell_removed", %{id: cell_id}) do
              {:ok, next_conn} ->
                stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          {:error, _reason} ->
            stream_workspace_events(conn, workspace_id, idle_timeout_ms)
        end

      {:cell_removed, %{workspace_id: ^workspace_id, cell_id: cell_id}} ->
        case StreamTransport.send_event(conn, "cell_removed", %{id: cell_id}) do
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
          case StreamTransport.send_event(stream_conn, "timing", serialize_timing(timing)) do
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
            case StreamTransport.send_event(conn, "timing", serialize_timing(timing)) do
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

  defp send_services_snapshot(conn, cell_id, params) do
    cell_id
    |> ServiceSnapshot.list_transport_payloads(parse_log_options(params))
    |> Enum.reduce_while({:ok, conn}, fn service_payload, {:ok, stream_conn} ->
      case StreamTransport.send_event(stream_conn, "service", service_payload) do
        {:ok, next_conn} -> {:cont, {:ok, next_conn}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp stream_service_events(conn, cell_id, params) do
    receive do
      {:service_update, %{cell_id: ^cell_id, service_id: service_id}} ->
        case Ash.get(Service, service_id, domain: Cells) do
          {:ok, service} ->
            case StreamTransport.send_event(
                   conn,
                   "service",
                   ServiceSnapshot.transport_payload(service, parse_log_options(params))
                 ) do
              {:ok, next_conn} -> stream_service_events(next_conn, cell_id, params)
              {:error, _reason} -> conn
            end

          {:error, _reason} ->
            stream_service_events(conn, cell_id, params)
        end
    after
      @service_stream_heartbeat_ms ->
        case StreamTransport.send_event(conn, "heartbeat", %{
               timestamp: System.system_time(:millisecond)
             }) do
          {:ok, next_conn} -> stream_service_events(next_conn, cell_id, params)
          {:error, _reason} -> conn
        end
    end
  end

  defp validate_chat_available(%Cell{} = cell) do
    if CellStatus.ready?(cell), do: :ok, else: {:error, :chat_unavailable}
  end

  defp validate_chat_available(_cell), do: {:error, :chat_unavailable}

  defp parse_log_options(params) do
    lines = parse_log_lines(Map.get(params, "logLines"))
    offset = parse_log_offset(Map.get(params, "logOffset"))
    include_resources = parse_boolean_param(Map.get(params, "includeResources"), false)
    %{lines: lines, offset: offset, include_resources: include_resources}
  end

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

  defp ensure_service_runtime(%Service{} = service) do
    case ServiceRuntime.ensure_service_running(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
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
