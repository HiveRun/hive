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
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace

  def create(conn, params) do
    workspace_id = read_param(params, "workspaceId", "workspace_id")
    description = read_param(params, "description")

    with :ok <- validate_workspace_id(workspace_id),
         :ok <- validate_description(description),
         {:ok, cell} <-
           Cells.create_cell(%{
             workspace_id: workspace_id,
             description: description,
             runtime_opts: runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      conn
      |> put_status(:created)
      |> json(%{cell: serialize_cell(cell)})
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
        json(conn, %{cell: serialize_cell(cell)})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def resume(conn, %{"id" => id}) do
    case Cells.resume_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_ingest: false}) do
      {:ok, cell} ->
        :ok = Events.publish_cell_status(cell.workspace_id, cell.id)
        json(conn, %{cell: serialize_cell(cell)})

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def delete(conn, %{"id" => id}) do
    case Cells.delete_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_stop: false}) do
      {:ok, %Cell{} = cell} ->
        :ok = Events.publish_cell_removed(cell.workspace_id, cell.id)
        json(conn, %{cell: serialize_cell(cell)})

      {:error, error} ->
        render_cell_error(conn, error)
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
         {:ok, _service} <- get_service_for_cell(cell_id, service_id),
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
    with {:ok, _service} <- get_service_for_cell(cell_id, service_id),
         {:ok, chunk} <- parse_input(params) do
      _session = TerminalRuntime.ensure_service_session(cell_id, service_id)
      :ok = TerminalRuntime.write_service_input(cell_id, service_id, chunk)
      :ok = Events.publish_service_terminal_data(cell_id, service_id, chunk)
      json(conn, %{ok: true})
    else
      {:error, :invalid_input} -> bad_request(conn, "data must be a string")
      {:error, error} -> render_cell_error(conn, error)
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

  def resources(conn, %{"id" => id}) do
    case Ash.get(Cell, id, domain: Cells) do
      {:ok, %Cell{} = cell} ->
        resources = resource_snapshot(cell.id)

        json(conn, %{
          cell: serialize_cell(cell),
          resources: resources,
          failures: failure_states(cell, resources)
        })

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

  defp serialize_cell(%Cell{} = cell) do
    %{
      id: cell.id,
      workspaceId: cell.workspace_id,
      description: cell.description,
      status: cell.status,
      insertedAt: maybe_to_iso8601(cell.inserted_at),
      updatedAt: maybe_to_iso8601(cell.updated_at)
    }
  end

  defp serialize_service(%Service{} = service) do
    %{
      id: service.id,
      cellId: service.cell_id,
      name: service.name,
      status: service.status,
      lastKnownError: service.last_known_error,
      insertedAt: maybe_to_iso8601(service.inserted_at),
      updatedAt: maybe_to_iso8601(service.updated_at)
    }
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
      insertedAt: maybe_to_iso8601(activity.inserted_at)
    }
  end

  defp serialize_timing(nil), do: nil

  defp serialize_timing(%Timing{} = timing) do
    %{
      id: timing.id,
      cellId: timing.cell_id,
      workflow: timing.workflow,
      status: timing.status,
      step: timing.step,
      runId: timing.run_id,
      error: timing.error,
      durationMs: timing.duration_ms,
      insertedAt: maybe_to_iso8601(timing.inserted_at)
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
        Enum.reduce_while(cells, {:ok, conn}, fn cell, {:ok, stream_conn} ->
          case send_sse(stream_conn, "cell", serialize_cell(cell)) do
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
            case send_sse(conn, "cell", serialize_cell(cell)) do
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

  defp get_service_for_cell(cell_id, service_id) do
    case Ash.get(Service, service_id, domain: Cells) do
      {:ok, %Service{cell_id: ^cell_id} = service} -> {:ok, service}
      {:ok, _service} -> {:error, :service_not_found}
      {:error, error} -> {:error, error}
    end
  end

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
