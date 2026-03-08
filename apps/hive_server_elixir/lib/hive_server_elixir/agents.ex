defmodule HiveServerElixir.Agents do
  @moduledoc false

  use Ash.Domain

  alias HiveServerElixir.Agents.ProviderCatalog
  alias HiveServerElixir.Agents.SessionView
  alias HiveServerElixir.Agents.Support.SessionViewBuilder
  alias HiveServerElixir.Cells.AgentSessionRead

  resources do
    resource ProviderCatalog
    resource SessionView
  end

  @type provider_payload :: %{
          models: [map()],
          defaults: map(),
          providers: [map()]
        }

  @spec provider_payload_for_workspace(String.t() | nil) ::
          {:ok, provider_payload()} | {:error, {atom(), String.t()} | term()}
  def provider_payload_for_workspace(workspace_id) do
    ProviderCatalog
    |> Ash.ActionInput.for_action(:for_workspace, %{workspace_id: workspace_id})
    |> Ash.run_action(domain: __MODULE__)
    |> normalize_result()
  end

  @spec provider_payload_for_session(String.t()) ::
          {:ok, provider_payload()} | {:error, {atom(), String.t()} | term()}
  def provider_payload_for_session(session_id) when is_binary(session_id) do
    ProviderCatalog
    |> Ash.ActionInput.for_action(:for_session, %{session_id: session_id})
    |> Ash.run_action(domain: __MODULE__)
    |> normalize_result()
  end

  @spec session_payload_for_cell(String.t()) :: {:ok, map() | nil} | {:error, term()}
  def session_payload_for_cell(cell_id) when is_binary(cell_id) do
    AgentSessionRead.payload_for_cell(cell_id)
  end

  @spec messages_payload_for_session(String.t()) ::
          {:ok, %{messages: [map()]}} | {:error, {atom(), String.t()} | term()}
  def messages_payload_for_session(session_id) when is_binary(session_id) do
    SessionView
    |> Ash.ActionInput.for_action(:messages_for_session, %{session_id: session_id})
    |> Ash.run_action(domain: __MODULE__)
    |> normalize_result()
  end

  @spec event_snapshot_for_session(String.t()) ::
          {:ok, map()} | {:error, {atom(), String.t()} | term()}
  def event_snapshot_for_session(session_id) when is_binary(session_id) do
    AgentSessionRead.snapshot_for_session(session_id)
  end

  @spec set_session_mode(String.t(), String.t()) ::
          {:ok, map()} | {:error, {atom(), String.t()} | term()}
  def set_session_mode(session_id, mode) when is_binary(session_id) and is_binary(mode) do
    SessionViewBuilder.set_session_mode(session_id, mode)
  end

  @spec empty_provider_payload(String.t()) :: map()
  def empty_provider_payload(message) when is_binary(message) do
    %{models: [], defaults: %{}, providers: [], message: message}
  end

  defp normalize_result({:ok, payload}), do: {:ok, payload}

  defp normalize_result({:error, %Ash.Error.Unknown{errors: errors} = error}) do
    case Enum.find_value(errors, &extract_known_error/1) do
      nil -> {:error, error}
      known_error -> {:error, known_error}
    end
  end

  defp normalize_result(other), do: other

  defp extract_known_error(%{value: value}) when is_list(value) do
    case value do
      [{status, message}] when status in [:bad_request, :not_found] and is_binary(message) ->
        {status, message}

      _other ->
        nil
    end
  end

  defp extract_known_error(_error), do: nil
end
