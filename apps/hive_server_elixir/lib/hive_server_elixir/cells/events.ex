defmodule HiveServerElixir.Cells.Events do
  @moduledoc false

  @pubsub HiveServerElixir.PubSub

  @spec publish_cell_status(String.t(), String.t()) :: :ok
  def publish_cell_status(workspace_id, cell_id)
      when is_binary(workspace_id) and is_binary(cell_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      workspace_topic(workspace_id),
      {:cell_status, %{workspace_id: workspace_id, cell_id: cell_id}}
    )
  end

  @spec publish_cell_removed(String.t(), String.t()) :: :ok
  def publish_cell_removed(workspace_id, cell_id)
      when is_binary(workspace_id) and is_binary(cell_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      workspace_topic(workspace_id),
      {:cell_removed, %{workspace_id: workspace_id, cell_id: cell_id}}
    )
  end

  @spec subscribe_workspace(String.t()) :: :ok | {:error, term()}
  def subscribe_workspace(workspace_id) when is_binary(workspace_id) do
    Phoenix.PubSub.subscribe(@pubsub, workspace_topic(workspace_id))
  end

  @spec publish_cell_timing(String.t(), String.t()) :: :ok
  def publish_cell_timing(cell_id, timing_id) when is_binary(cell_id) and is_binary(timing_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      timing_topic(cell_id),
      {:cell_timing, %{cell_id: cell_id, timing_id: timing_id}}
    )
  end

  @spec subscribe_cell_timing(String.t()) :: :ok | {:error, term()}
  def subscribe_cell_timing(cell_id) when is_binary(cell_id) do
    Phoenix.PubSub.subscribe(@pubsub, timing_topic(cell_id))
  end

  @spec publish_setup_terminal_data(String.t(), String.t()) :: :ok
  def publish_setup_terminal_data(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      setup_terminal_topic(cell_id),
      {:setup_terminal_data, %{cell_id: cell_id, chunk: chunk}}
    )
  end

  @spec publish_setup_terminal_exit(String.t(), integer() | nil, String.t() | nil) :: :ok
  def publish_setup_terminal_exit(cell_id, exit_code, signal \\ nil)
      when is_binary(cell_id) and (is_integer(exit_code) or is_nil(exit_code)) and
             (is_binary(signal) or is_nil(signal)) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      setup_terminal_topic(cell_id),
      {:setup_terminal_exit, %{cell_id: cell_id, exit_code: exit_code, signal: signal}}
    )
  end

  @spec subscribe_setup_terminal(String.t()) :: :ok | {:error, term()}
  def subscribe_setup_terminal(cell_id) when is_binary(cell_id) do
    Phoenix.PubSub.subscribe(@pubsub, setup_terminal_topic(cell_id))
  end

  @spec publish_setup_terminal_error(String.t(), String.t()) :: :ok
  def publish_setup_terminal_error(cell_id, message)
      when is_binary(cell_id) and is_binary(message) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      setup_terminal_topic(cell_id),
      {:setup_terminal_error, %{cell_id: cell_id, message: message}}
    )
  end

  @spec publish_service_terminal_data(String.t(), String.t(), String.t()) :: :ok
  def publish_service_terminal_data(cell_id, service_id, chunk)
      when is_binary(cell_id) and is_binary(service_id) and is_binary(chunk) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      service_terminal_topic(cell_id, service_id),
      {:service_terminal_data, %{cell_id: cell_id, service_id: service_id, chunk: chunk}}
    )
  end

  @spec publish_service_terminal_exit(String.t(), String.t(), integer() | nil, String.t() | nil) ::
          :ok
  def publish_service_terminal_exit(cell_id, service_id, exit_code, signal \\ nil)
      when is_binary(cell_id) and is_binary(service_id) and
             (is_integer(exit_code) or is_nil(exit_code)) and
             (is_binary(signal) or is_nil(signal)) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      service_terminal_topic(cell_id, service_id),
      {:service_terminal_exit,
       %{cell_id: cell_id, service_id: service_id, exit_code: exit_code, signal: signal}}
    )
  end

  @spec publish_service_terminal_error(String.t(), String.t(), String.t()) :: :ok
  def publish_service_terminal_error(cell_id, service_id, message)
      when is_binary(cell_id) and is_binary(service_id) and is_binary(message) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      service_terminal_topic(cell_id, service_id),
      {:service_terminal_error, %{cell_id: cell_id, service_id: service_id, message: message}}
    )
  end

  @spec subscribe_service_terminal(String.t(), String.t()) :: :ok | {:error, term()}
  def subscribe_service_terminal(cell_id, service_id)
      when is_binary(cell_id) and is_binary(service_id) do
    Phoenix.PubSub.subscribe(@pubsub, service_terminal_topic(cell_id, service_id))
  end

  @spec publish_service_update(String.t(), String.t()) :: :ok
  def publish_service_update(cell_id, service_id)
      when is_binary(cell_id) and is_binary(service_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      services_topic(cell_id),
      {:service_update, %{cell_id: cell_id, service_id: service_id}}
    )
  end

  @spec subscribe_cell_services(String.t()) :: :ok | {:error, term()}
  def subscribe_cell_services(cell_id) when is_binary(cell_id) do
    Phoenix.PubSub.subscribe(@pubsub, services_topic(cell_id))
  end

  @spec publish_chat_terminal_data(String.t(), String.t()) :: :ok
  def publish_chat_terminal_data(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      chat_terminal_topic(cell_id),
      {:chat_terminal_data, %{cell_id: cell_id, chunk: chunk}}
    )
  end

  @spec publish_chat_terminal_exit(String.t(), integer() | nil, String.t() | nil) :: :ok
  def publish_chat_terminal_exit(cell_id, exit_code, signal \\ nil)
      when is_binary(cell_id) and (is_integer(exit_code) or is_nil(exit_code)) and
             (is_binary(signal) or is_nil(signal)) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      chat_terminal_topic(cell_id),
      {:chat_terminal_exit, %{cell_id: cell_id, exit_code: exit_code, signal: signal}}
    )
  end

  @spec publish_chat_terminal_error(String.t(), String.t()) :: :ok
  def publish_chat_terminal_error(cell_id, message)
      when is_binary(cell_id) and is_binary(message) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      chat_terminal_topic(cell_id),
      {:chat_terminal_error, %{cell_id: cell_id, message: message}}
    )
  end

  @spec subscribe_chat_terminal(String.t()) :: :ok | {:error, term()}
  def subscribe_chat_terminal(cell_id) when is_binary(cell_id) do
    Phoenix.PubSub.subscribe(@pubsub, chat_terminal_topic(cell_id))
  end

  @spec workspace_topic(String.t()) :: String.t()
  def workspace_topic(workspace_id), do: "workspace:" <> workspace_id

  @spec timing_topic(String.t()) :: String.t()
  def timing_topic(cell_id), do: "timings:" <> cell_id

  @spec setup_terminal_topic(String.t()) :: String.t()
  def setup_terminal_topic(cell_id), do: "setup_terminal:" <> cell_id

  @spec service_terminal_topic(String.t(), String.t()) :: String.t()
  def service_terminal_topic(cell_id, service_id),
    do: "service_terminal:" <> cell_id <> ":" <> service_id

  @spec chat_terminal_topic(String.t()) :: String.t()
  def chat_terminal_topic(cell_id), do: "chat_terminal:" <> cell_id

  @spec services_topic(String.t()) :: String.t()
  def services_topic(cell_id), do: "services:" <> cell_id
end
