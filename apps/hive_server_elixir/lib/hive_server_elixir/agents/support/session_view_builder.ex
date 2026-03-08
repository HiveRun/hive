defmodule HiveServerElixir.Agents.Support.SessionViewBuilder do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.AgentSessionRead

  @spec set_session_mode(String.t(), String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def set_session_mode(session_id, mode) when is_binary(session_id) and is_binary(mode) do
    normalized_mode = normalize_mode(mode)

    if normalized_mode in ["plan", "build"] do
      with {:ok, context} <- AgentSessionRead.context_for_session(session_id),
           {:ok, %AgentSession{} = agent_session} <- resolve_persisted_session(context),
           {:ok, updated_session} <-
             Ash.update(agent_session, %{mode: normalized_mode}, action: :set_mode, domain: Cells) do
        updated_context = %{context | agent_session: updated_session}
        {:ok, AgentSessionRead.payload_from_context(updated_context)}
      else
        {:error, {_, _} = reason} -> {:error, reason}
        {:error, _error} -> {:error, {:bad_request, "Failed to update session mode"}}
      end
    else
      {:error, {:bad_request, "mode must be either 'plan' or 'build'"}}
    end
  end

  defp normalize_mode("plan"), do: "plan"
  defp normalize_mode("build"), do: "build"
  defp normalize_mode(_mode), do: nil

  defp resolve_persisted_session(%{agent_session: %AgentSession{} = session}), do: {:ok, session}
  defp resolve_persisted_session(_context), do: {:error, {:not_found, "Agent session not found"}}
end
