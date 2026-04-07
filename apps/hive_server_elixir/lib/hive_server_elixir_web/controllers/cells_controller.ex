defmodule HiveServerElixirWeb.CellsController do
  use HiveServerElixirWeb, :controller

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Terminals
  alias HiveServerElixir.Cells.Terminals.Transport
  alias HiveServerElixirWeb.CellErrorResponse
  alias HiveServerElixirWeb.Cells.StreamTransport

  def terminal_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_cell_terminal(cell_id),
         {:ok, session} <- Terminals.ensure_session({:terminal, cell_id}) do
      stream_conn = StreamTransport.open_sse(conn)
      scope = {:terminal, cell_id}
      output = Terminals.read_output(scope)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "ready",
               Transport.sse_ready_payload(scope, session, nil)
             ),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               Transport.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_terminal_events(stream_conn, scope, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, reason} ->
        if match?({:not_found, _code}, CellErrorResponse.classify(reason)) do
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

  def terminal_resize(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params),
         {:ok, session} <- Terminals.resize_session({:terminal, cell_id}, cols, rows) do
      json(conn, %{ok: true, session: session})
    else
      {:error, :invalid_resize} -> bad_request(conn, "cols and rows must be positive integers")
      {:error, error} -> CellErrorResponse.render(conn, error)
    end
  end

  def terminal_input(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, chunk} <- StreamTransport.parse_input(params),
         :ok <- Terminals.write_input({:terminal, cell_id}, chunk) do
      json(conn, %{ok: true})
    else
      {:error, :invalid_input} -> bad_request(conn, "data must be a string")
      {:error, error} -> CellErrorResponse.render(conn, error)
    end
  end

  def setup_terminal_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_setup_terminal(cell_id),
         {:ok, session} <- Terminals.ensure_session({:setup, cell_id}) do
      stream_conn = StreamTransport.open_sse(conn)
      scope = {:setup, cell_id}

      ready_payload = Transport.sse_ready_payload(scope, session, cell)
      output = Terminals.read_output(scope)

      with {:ok, stream_conn} <- StreamTransport.send_event(stream_conn, "ready", ready_payload),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               Transport.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_terminal_events(stream_conn, scope, idle_timeout_ms)
        end
      else
        {:error, _reason} -> stream_conn
      end
    else
      {:error, reason} ->
        if match?({:not_found, _code}, CellErrorResponse.classify(reason)) do
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
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params),
         {:ok, session} <- Terminals.resize_session({:setup, cell_id}, cols, rows) do
      json(conn, %{ok: true, session: session})
    else
      {:error, :service_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{code: "not_found", message: "Service not found"}})

      {:error, :invalid_resize} ->
        bad_request(conn, "cols and rows must be positive integers")

      {:error, error} ->
        CellErrorResponse.render(conn, error)
    end
  end

  def setup_terminal_input(conn, %{"id" => cell_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, chunk} <- StreamTransport.parse_input(params),
         :ok <- Terminals.write_input({:setup, cell_id}, chunk) do
      json(conn, %{ok: true})
    else
      {:error, :service_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: %{code: "not_found", message: "Service not found"}})

      {:error, :invalid_input} ->
        bad_request(conn, "data must be a string")

      {:error, error} ->
        CellErrorResponse.render(conn, error)
    end
  end

  def service_terminal_stream(conn, %{"id" => cell_id, "service_id" => service_id} = params) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         {:ok, service} <- Terminals.get_service_for_cell(cell_id, service_id),
         :ok <- Terminals.ensure_service_runtime(service),
         :ok <- Events.subscribe_service_terminal(cell_id, service_id),
         {:ok, session} <- Terminals.ensure_session({:service, cell_id, service_id}) do
      scope = {:service, cell_id, service_id}
      output = Terminals.read_output(scope)

      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "ready",
               Transport.sse_ready_payload(scope, session, nil)
             ),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               Transport.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_terminal_events(stream_conn, scope, idle_timeout_ms)
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
        if match?({:not_found, _code}, CellErrorResponse.classify(reason)) do
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
    with {:ok, _service} <- Terminals.get_service_for_cell(cell_id, service_id),
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params),
         {:ok, session} <- Terminals.resize_session({:service, cell_id, service_id}, cols, rows) do
      json(conn, %{ok: true, session: session})
    else
      {:error, :invalid_resize} -> bad_request(conn, "cols and rows must be positive integers")
      {:error, error} -> CellErrorResponse.render(conn, error)
    end
  end

  def service_terminal_input(conn, %{"id" => cell_id, "service_id" => service_id} = params) do
    with {:ok, service} <- Terminals.get_service_for_cell(cell_id, service_id),
         :ok <- Terminals.ensure_service_runtime(service),
         {:ok, chunk} <- StreamTransport.parse_input(params),
         :ok <- Terminals.write_input({:service, cell_id, service_id}, chunk) do
      json(conn, %{ok: true})
    else
      {:error, :service_runtime_unavailable} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: %{code: "service_unavailable", message: "Service runtime unavailable"}})

      {:error, :invalid_input} ->
        bad_request(conn, "data must be a string")

      {:error, error} ->
        CellErrorResponse.render(conn, error)
    end
  end

  def chat_terminal_stream(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Terminals.validate_chat_available(cell),
         :ok <- Events.subscribe_chat_terminal(cell_id),
         {:ok, session} <- Terminals.ensure_session({:chat, cell_id}) do
      scope = {:chat, cell_id}
      output = Terminals.read_output(scope)

      stream_conn = StreamTransport.open_sse(conn)

      with {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "ready",
               Transport.sse_ready_payload(scope, session, nil)
             ),
           {:ok, stream_conn} <-
             StreamTransport.send_event(
               stream_conn,
               "snapshot",
               Transport.snapshot_payload(output)
             ) do
        idle_timeout_ms =
          StreamTransport.idle_timeout_ms(Map.get(params, "idleTimeoutMs"), 30_000)

        if Map.get(params, "initialOnly") in ["true", "1"] do
          stream_conn
        else
          StreamTransport.stream_terminal_events(stream_conn, scope, idle_timeout_ms)
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
        if match?({:not_found, _code}, CellErrorResponse.classify(reason)) do
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
         :ok <- Terminals.validate_chat_available(cell),
         {:ok, cols, rows} <- StreamTransport.parse_resize_params(params),
         {:ok, session} <- Terminals.resize_session({:chat, cell_id}, cols, rows) do
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
        CellErrorResponse.render(conn, error)
    end
  end

  def chat_terminal_input(conn, %{"id" => cell_id} = params) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Terminals.validate_chat_available(cell),
         {:ok, chunk} <- StreamTransport.parse_input(params),
         :ok <- Terminals.write_input({:chat, cell_id}, chunk) do
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
        CellErrorResponse.render(conn, error)
    end
  end

  def chat_terminal_restart(conn, %{"id" => cell_id}) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Terminals.validate_chat_available(cell),
         {:ok, session} <- Terminals.restart_session({:chat, cell_id}) do
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
        CellErrorResponse.render(conn, error)
    end
  end

  defp bad_request(conn, message) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: %{code: "bad_request", message: message}})
  end
end
