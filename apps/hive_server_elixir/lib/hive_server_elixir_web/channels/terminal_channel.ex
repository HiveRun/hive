defmodule HiveServerElixirWeb.TerminalChannel do
  @moduledoc false

  use HiveServerElixirWeb, :channel

  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Terminals
  alias HiveServerElixir.Cells.Terminals.Transport
  alias HiveServerElixirWeb.Cells.StreamTransport

  @impl true
  def join("terminal:" <> cell_id, _payload, socket) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_cell_terminal(cell_id),
         {:ok, session} <- Terminals.ensure_session({:terminal, cell_id}) do
      scope = {:terminal, cell_id}
      output = Terminals.read_output(scope)

      socket =
        socket
        |> assign(:terminal_kind, :terminal)
        |> assign(:cell_id, cell_id)

      send(self(), {:terminal_ready, Transport.ready_event(scope, session, nil)})
      send(self(), {:terminal_snapshot, Transport.snapshot_event(output)})
      {:ok, socket}
    else
      {:error, reason} -> {:error, %{reason: error_message(reason, "Cell not found")}}
    end
  end

  def join("setup_terminal:" <> cell_id, _payload, socket) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Events.subscribe_setup_terminal(cell_id),
         {:ok, session} <- Terminals.ensure_session({:setup, cell_id}) do
      scope = {:setup, cell_id}
      output = Terminals.read_output(scope)

      socket =
        socket
        |> assign(:terminal_kind, :setup)
        |> assign(:cell_id, cell_id)

      send(
        self(),
        {:terminal_ready, Transport.ready_event(scope, session, cell)}
      )

      send(self(), {:terminal_snapshot, Transport.snapshot_event(output)})
      {:ok, socket}
    else
      {:error, reason} -> {:error, %{reason: error_message(reason, "Cell not found")}}
    end
  end

  def join("service_terminal:" <> key, _payload, socket) do
    with {:ok, cell_id, service_id} <- parse_service_key(key),
         {:ok, service} <- Terminals.get_service_for_cell(cell_id, service_id),
         :ok <- Terminals.ensure_service_runtime(service),
         :ok <- Events.subscribe_service_terminal(cell_id, service_id),
         {:ok, session} <- Terminals.ensure_session({:service, cell_id, service_id}) do
      scope = {:service, cell_id, service_id}
      output = Terminals.read_output(scope)

      socket =
        socket
        |> assign(:terminal_kind, :service)
        |> assign(:cell_id, cell_id)
        |> assign(:service_id, service_id)

      send(self(), {:terminal_ready, Transport.ready_event(scope, session, nil)})
      send(self(), {:terminal_snapshot, Transport.snapshot_event(output)})
      {:ok, socket}
    else
      {:error, :invalid_topic} -> {:error, %{reason: "Invalid service terminal topic"}}
      {:error, :service_not_found} -> {:error, %{reason: "Service not found"}}
      {:error, :service_runtime_unavailable} -> {:error, %{reason: "Service runtime unavailable"}}
      {:error, reason} -> {:error, %{reason: error_message(reason, "Service not found")}}
    end
  end

  def join("chat_terminal:" <> cell_id, _payload, socket) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells),
         :ok <- Terminals.validate_chat_available(cell),
         :ok <- Events.subscribe_chat_terminal(cell_id),
         {:ok, session} <- Terminals.ensure_session({:chat, cell_id}) do
      scope = {:chat, cell_id}
      output = Terminals.read_output(scope)

      socket =
        socket
        |> assign(:terminal_kind, :chat)
        |> assign(:cell_id, cell_id)

      send(self(), {:terminal_ready, Transport.ready_event(scope, session, nil)})
      send(self(), {:terminal_snapshot, Transport.snapshot_event(output)})
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
      :terminal ->
        case Terminals.write_input({:terminal, socket.assigns.cell_id}, chunk) do
          :ok ->
            :ok

          {:error, reason} ->
            push(socket, "terminal_event", %{type: "error", message: inspect(reason)})
        end

      :setup ->
        case Terminals.write_input({:setup, socket.assigns.cell_id}, chunk) do
          :ok ->
            :ok

          {:error, reason} ->
            push(socket, "terminal_event", %{type: "error", message: inspect(reason)})
        end

      :service ->
        case Terminals.write_input(
               {:service, socket.assigns.cell_id, socket.assigns.service_id},
               chunk
             ) do
          :ok ->
            :ok

          {:error, :not_running} ->
            push(socket, "terminal_event", %{type: "error", message: "Service is not running"})
        end

      :chat ->
        case Terminals.write_input({:chat, socket.assigns.cell_id}, chunk) do
          :ok ->
            :ok

          {:error, reason} ->
            push(socket, "terminal_event", %{type: "error", message: inspect(reason)})
        end
    end

    {:noreply, socket}
  end

  def handle_in("terminal_message", %{"type" => "resize", "cols" => cols, "rows" => rows}, socket) do
    with {:ok, parsed_cols, parsed_rows} <-
           StreamTransport.parse_resize_params(%{"cols" => cols, "rows" => rows}) do
      scope = terminal_scope(socket)

      case Terminals.resize_session(scope, parsed_cols, parsed_rows) do
        {:ok, session} ->
          push(socket, "terminal_event", Transport.resized_event(session))
          {:noreply, socket}

        {:error, reason} ->
          push(socket, "terminal_event", %{type: "error", message: inspect(reason)})
          {:noreply, socket}
      end
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
        %{assigns: %{terminal_kind: :terminal}} = socket
      ) do
    scope = {:terminal, socket.assigns.cell_id}

    case Terminals.restart_session(scope) do
      {:ok, session} ->
        push(socket, "terminal_event", Transport.ready_event(scope, session, nil))
        push(socket, "terminal_event", Transport.snapshot_event(""))

      {:error, reason} ->
        push(socket, "terminal_event", %{type: "error", message: inspect(reason)})
    end

    {:noreply, socket}
  end

  def handle_in(
        "terminal_message",
        %{"type" => "restart"},
        %{assigns: %{terminal_kind: :chat}} = socket
      ) do
    scope = {:chat, socket.assigns.cell_id}

    case Terminals.restart_session(scope) do
      {:ok, session} ->
        push(socket, "terminal_event", Transport.ready_event(scope, session, nil))
        push(socket, "terminal_event", Transport.snapshot_event(""))

      {:error, reason} ->
        push(socket, "terminal_event", %{type: "error", message: inspect(reason)})
    end

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
    push(socket, "terminal_event", payload)
    {:noreply, socket}
  end

  def handle_info({:terminal_snapshot, payload}, socket) do
    push(socket, "terminal_event", payload)
    {:noreply, socket}
  end

  def handle_info(message, socket) do
    case Transport.channel_event(message, terminal_scope(socket)) do
      {:ok, payload} ->
        push(socket, "terminal_event", payload)
        {:noreply, socket}

      :ignore ->
        {:noreply, socket}
    end
  end

  defp terminal_scope(%{assigns: %{terminal_kind: :terminal, cell_id: cell_id}}),
    do: {:terminal, cell_id}

  defp terminal_scope(%{assigns: %{terminal_kind: :setup, cell_id: cell_id}}),
    do: {:setup, cell_id}

  defp terminal_scope(%{assigns: %{terminal_kind: :chat, cell_id: cell_id}}), do: {:chat, cell_id}

  defp terminal_scope(%{
         assigns: %{terminal_kind: :service, cell_id: cell_id, service_id: service_id}
       }) do
    {:service, cell_id, service_id}
  end

  defp parse_service_key(key) when is_binary(key) do
    case String.split(key, ":", parts: 2) do
      [cell_id, service_id] when byte_size(cell_id) > 0 and byte_size(service_id) > 0 ->
        {:ok, cell_id, service_id}

      _parts ->
        {:error, :invalid_topic}
    end
  end

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
