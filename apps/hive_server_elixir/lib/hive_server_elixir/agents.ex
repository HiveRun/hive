defmodule HiveServerElixir.Agents do
  @moduledoc false

  use Ash.Domain

  alias HiveServerElixir.AshActionResult
  alias HiveServerElixir.Agents.ProviderCatalog
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.AgentSessionMessages

  resources do
    resource ProviderCatalog
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
    |> AshActionResult.normalize()
  end

  @spec provider_payload_for_session(String.t()) ::
          {:ok, provider_payload()} | {:error, {atom(), String.t()} | term()}
  def provider_payload_for_session(session_id) when is_binary(session_id) do
    ProviderCatalog
    |> Ash.ActionInput.for_action(:for_session, %{session_id: session_id})
    |> Ash.run_action(domain: __MODULE__)
    |> AshActionResult.normalize()
  end

  @spec session_payload_for_cell(String.t()) :: {:ok, map() | nil} | {:error, term()}
  def session_payload_for_cell(cell_id) when is_binary(cell_id) do
    AgentSession.payload_for_cell(cell_id)
  end

  @spec messages_payload_for_session(String.t()) ::
          {:ok, %{messages: [map()]}} | {:error, {atom(), String.t()} | term()}
  def messages_payload_for_session(session_id) when is_binary(session_id) do
    AgentSessionMessages.for_session(session_id)
  end

  @spec event_snapshot_for_session(String.t()) ::
          {:ok, map()} | {:error, {atom(), String.t()} | term()}
  def event_snapshot_for_session(session_id) when is_binary(session_id) do
    AgentSession.event_snapshot_for_session(session_id)
  end

  @spec set_session_mode(String.t(), String.t()) ::
          {:ok, map()} | {:error, {atom(), String.t()} | term()}
  def set_session_mode(session_id, mode) when is_binary(session_id) and is_binary(mode) do
    AgentSession.set_mode_payload(session_id, mode)
  end

  @spec empty_provider_payload(String.t()) :: map()
  def empty_provider_payload(message) when is_binary(message) do
    %{models: [], defaults: %{}, providers: [], message: message}
  end
end
