defmodule HiveServerElixir.Opencode.EventEnvelope do
  @moduledoc false

  alias HiveServerElixir.Opencode.AgentEvent

  @spec get(term(), String.t()) :: term()
  def get(value, key) when is_map(value) and is_binary(key) do
    case Map.fetch(value, key) do
      {:ok, found} ->
        found

      :error ->
        case maybe_existing_atom(key) do
          atom when is_atom(atom) -> Map.get(value, atom)
          _other -> nil
        end
    end
  end

  def get(_value, _key), do: nil

  @spec payload(map()) :: map()
  def payload(%AgentEvent{} = event), do: payload(event.payload)

  def payload(event) when is_map(event) do
    get(event, "payload") || event || %{}
  end

  def payload(_event), do: %{}

  @spec properties(map()) :: map()
  def properties(event) do
    case get(payload(event), "properties") do
      value when is_map(value) -> value
      _other -> %{}
    end
  end

  @spec type(map()) :: String.t() | nil
  def type(%AgentEvent{} = event) do
    get(payload(event), "type") || event.event_type
  end

  def type(event) when is_map(event) do
    get(payload(event), "type")
  end

  def type(_event), do: nil

  @spec session_id(map()) :: String.t() | nil
  def session_id(event) when is_map(event) do
    properties = properties(event)

    get(properties, "sessionID") ||
      get(properties, "sessionId") ||
      get(properties, "session_id") ||
      get(event, "sessionID") ||
      get(event, "sessionId") ||
      get(event, "session_id")
  end

  def session_id(_event), do: nil

  @spec mode(map()) :: String.t() | nil
  def mode(event) do
    case get(properties(event), "agent") || get(properties(event), "currentMode") ||
           get(properties(event), "startMode") do
      "plan" -> "plan"
      "build" -> "build"
      _other -> nil
    end
  end

  @spec model_id(map()) :: String.t() | nil
  def model_id(event) do
    properties = properties(event)
    model = get(properties, "model") || %{}

    get(model, "modelID") ||
      get(model, "modelId") ||
      get(properties, "modelID") ||
      get(properties, "modelId")
  end

  @spec provider_id(map()) :: String.t() | nil
  def provider_id(event) do
    properties = properties(event)
    model = get(properties, "model") || %{}

    get(model, "providerID") ||
      get(model, "providerId") ||
      get(properties, "providerID") ||
      get(properties, "providerId")
  end

  defp maybe_existing_atom(key) when is_binary(key) do
    String.to_existing_atom(key)
  rescue
    ArgumentError -> nil
  end
end
