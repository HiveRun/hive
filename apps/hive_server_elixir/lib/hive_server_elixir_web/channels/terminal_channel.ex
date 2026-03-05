defmodule HiveServerElixirWeb.TerminalChannel do
  @moduledoc false

  use HiveServerElixirWeb, :channel

  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.TerminalRuntime

  @impl true
  def join("setup_terminal:" <> cell_id, _payload, socket) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_setup_terminal(cell_id) do
      session = TerminalRuntime.ensure_setup_session(cell_id)
      output = TerminalRuntime.read_setup_output(cell_id)

      socket =
        socket
        |> assign(:terminal_kind, :setup)
        |> assign(:cell_id, cell_id)

      send(
        self(),
        {:terminal_ready,
         %{session: session, setupState: setup_state_for(cell), lastSetupError: nil}}
      )

      send(self(), {:terminal_snapshot, output})
      {:ok, socket}
    else
      {:error, reason} -> {:error, %{reason: error_message(reason, "Cell not found")}}
    end
  end

  def join("service_terminal:" <> key, _payload, socket) do
    with {:ok, cell_id, service_id} <- parse_service_key(key),
         {:ok, _service} <- get_service_for_cell(cell_id, service_id),
         :ok <- Events.subscribe_service_terminal(cell_id, service_id) do
      session = TerminalRuntime.ensure_service_session(cell_id, service_id)
      output = TerminalRuntime.read_service_output(cell_id, service_id)

      socket =
        socket
        |> assign(:terminal_kind, :service)
        |> assign(:cell_id, cell_id)
        |> assign(:service_id, service_id)

      send(self(), {:terminal_ready, %{session: session}})
      send(self(), {:terminal_snapshot, output})
      {:ok, socket}
    else
      {:error, :invalid_topic} -> {:error, %{reason: "Invalid service terminal topic"}}
      {:error, :service_not_found} -> {:error, %{reason: "Service not found"}}
      {:error, reason} -> {:error, %{reason: error_message(reason, "Service not found")}}
    end
  end

  def join("chat_terminal:" <> cell_id, _payload, socket) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- validate_chat_available(cell),
         :ok <- Events.subscribe_chat_terminal(cell_id) do
      session = TerminalRuntime.ensure_chat_session(cell_id)
      output = TerminalRuntime.read_chat_output(cell_id)

      socket =
        socket
        |> assign(:terminal_kind, :chat)
        |> assign(:cell_id, cell_id)

      send(self(), {:terminal_ready, %{session: session}})
      send(self(), {:terminal_snapshot, output})
      {:ok, socket}
    else
      {:error, :chat_unavailable} ->
        {:error, %{reason: "Chat terminal is unavailable until provisioning completes"}}

      {:error, reason} ->
        {:error, %{reason: error_message(reason, "Cell not found")}}
    end
  end

  @impl true
  def handle_in("terminal_message", %{"type" => "ping"}, socket) do
    push(socket, "terminal_event", %{type: "pong"})
    {:noreply, socket}
  end

  def handle_in("terminal_message", %{"type" => "input", "data" => chunk}, socket)
      when is_binary(chunk) do
    case socket.assigns.terminal_kind do
      :setup ->
        :ok = TerminalRuntime.write_setup_input(socket.assigns.cell_id, chunk)
        :ok = Events.publish_setup_terminal_data(socket.assigns.cell_id, chunk)

      :service ->
        :ok =
          TerminalRuntime.write_service_input(
            socket.assigns.cell_id,
            socket.assigns.service_id,
            chunk
          )

        :ok =
          Events.publish_service_terminal_data(
            socket.assigns.cell_id,
            socket.assigns.service_id,
            chunk
          )

      :chat ->
        :ok = TerminalRuntime.write_chat_input(socket.assigns.cell_id, chunk)
        :ok = Events.publish_chat_terminal_data(socket.assigns.cell_id, chunk)
    end

    {:noreply, socket}
  end

  def handle_in("terminal_message", %{"type" => "resize", "cols" => cols, "rows" => rows}, socket) do
    with {:ok, parsed_cols, parsed_rows} <- parse_resize_params(cols, rows) do
      session =
        case socket.assigns.terminal_kind do
          :setup ->
            TerminalRuntime.resize_setup_session(socket.assigns.cell_id, parsed_cols, parsed_rows)

          :service ->
            TerminalRuntime.resize_service_session(
              socket.assigns.cell_id,
              socket.assigns.service_id,
              parsed_cols,
              parsed_rows
            )

          :chat ->
            TerminalRuntime.resize_chat_session(socket.assigns.cell_id, parsed_cols, parsed_rows)
        end

      push(socket, "terminal_event", %{type: "resized", session: session})
      {:noreply, socket}
    else
      {:error, :invalid_resize} ->
        push(socket, "terminal_event", %{
          type: "error",
          message: "cols and rows must be positive integers"
        })

        {:noreply, socket}
    end
  end

  def handle_in(
        "terminal_message",
        %{"type" => "restart"},
        %{assigns: %{terminal_kind: :chat}} = socket
      ) do
    session = TerminalRuntime.restart_chat_session(socket.assigns.cell_id)
    :ok = Events.publish_chat_terminal_exit(socket.assigns.cell_id, 0, nil)
    push(socket, "terminal_event", %{type: "ready", session: session})
    push(socket, "terminal_event", %{type: "snapshot", output: []})
    {:noreply, socket}
  end

  def handle_in("terminal_message", %{"type" => "restart"}, socket) do
    push(socket, "terminal_event", %{type: "error", message: "Restart is unsupported"})
    {:noreply, socket}
  end

  def handle_in("terminal_message", _payload, socket) do
    push(socket, "terminal_event", %{type: "error", message: "Unsupported message"})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:terminal_ready, payload}, socket) do
    push(socket, "terminal_event", Map.put(payload, :type, "ready"))
    {:noreply, socket}
  end

  def handle_info({:terminal_snapshot, output}, socket) do
    push(socket, "terminal_event", %{type: "snapshot", output: output})
    {:noreply, socket}
  end

  def handle_info(
        {:setup_terminal_data, %{cell_id: cell_id, chunk: chunk}},
        %{assigns: %{terminal_kind: :setup, cell_id: cell_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "data", chunk: chunk})
    {:noreply, socket}
  end

  def handle_info(
        {:setup_terminal_exit, %{cell_id: cell_id, exit_code: exit_code, signal: signal}},
        %{assigns: %{terminal_kind: :setup, cell_id: cell_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "exit", exitCode: exit_code, signal: signal})
    {:noreply, socket}
  end

  def handle_info(
        {:setup_terminal_error, %{cell_id: cell_id, message: message}},
        %{assigns: %{terminal_kind: :setup, cell_id: cell_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "error", message: message})
    {:noreply, socket}
  end

  def handle_info(
        {:service_terminal_data, %{cell_id: cell_id, service_id: service_id, chunk: chunk}},
        %{assigns: %{terminal_kind: :service, cell_id: cell_id, service_id: service_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "data", chunk: chunk})
    {:noreply, socket}
  end

  def handle_info(
        {:service_terminal_exit,
         %{cell_id: cell_id, service_id: service_id, exit_code: exit_code, signal: signal}},
        %{assigns: %{terminal_kind: :service, cell_id: cell_id, service_id: service_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "exit", exitCode: exit_code, signal: signal})
    {:noreply, socket}
  end

  def handle_info(
        {:service_terminal_error, %{cell_id: cell_id, service_id: service_id, message: message}},
        %{assigns: %{terminal_kind: :service, cell_id: cell_id, service_id: service_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "error", message: message})
    {:noreply, socket}
  end

  def handle_info(
        {:chat_terminal_data, %{cell_id: cell_id, chunk: chunk}},
        %{assigns: %{terminal_kind: :chat, cell_id: cell_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "data", chunk: chunk})
    {:noreply, socket}
  end

  def handle_info(
        {:chat_terminal_exit, %{cell_id: cell_id, exit_code: exit_code, signal: signal}},
        %{assigns: %{terminal_kind: :chat, cell_id: cell_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "exit", exitCode: exit_code, signal: signal})
    {:noreply, socket}
  end

  def handle_info(
        {:chat_terminal_error, %{cell_id: cell_id, message: message}},
        %{assigns: %{terminal_kind: :chat, cell_id: cell_id}} = socket
      ) do
    push(socket, "terminal_event", %{type: "error", message: message})
    {:noreply, socket}
  end

  def handle_info(_message, socket), do: {:noreply, socket}

  defp validate_chat_available(%Cell{status: "ready"}), do: :ok
  defp validate_chat_available(_cell), do: {:error, :chat_unavailable}

  defp parse_resize_params(cols, rows) do
    parsed_cols = parse_positive_integer(cols)
    parsed_rows = parse_positive_integer(rows)

    if is_integer(parsed_cols) and is_integer(parsed_rows) do
      {:ok, parsed_cols, parsed_rows}
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

  defp parse_service_key(key) when is_binary(key) do
    case String.split(key, ":", parts: 2) do
      [cell_id, service_id] when byte_size(cell_id) > 0 and byte_size(service_id) > 0 ->
        {:ok, cell_id, service_id}

      _parts ->
        {:error, :invalid_topic}
    end
  end

  defp setup_state_for(%Cell{status: "ready"}), do: "completed"
  defp setup_state_for(%Cell{status: "error"}), do: "error"
  defp setup_state_for(_cell), do: "running"

  defp error_message(reason, fallback) do
    if contains_error?(reason, NotFound) do
      fallback
    else
      inspect(reason)
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
