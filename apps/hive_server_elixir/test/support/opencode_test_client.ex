defmodule HiveServerElixir.Opencode.TestClient do
  @moduledoc false

  @spec request(map()) :: {:ok, term()} | {:error, term()} | :error
  def request(operation) do
    opts = Map.get(operation, :opts, [])
    callback = Keyword.get(opts, :test_client_callback)

    if is_function(callback, 1) do
      callback.(operation)
    else
      {:ok, default_response(operation)}
    end
  end

  defp default_response(operation) do
    url = Map.get(operation, :url, "")

    cond do
      String.contains?(url, "/config/providers") ->
        default_catalog()

      String.contains?(url, "/session/") and String.ends_with?(url, "/message") ->
        default_messages()

      true ->
        %{}
    end
  end

  defp default_catalog do
    %{
      "default" => %{"opencode" => "big-pickle"},
      "providers" => [
        %{
          "id" => "opencode",
          "name" => "OpenCode",
          "models" => %{
            "big-pickle" => %{"id" => "big-pickle", "name" => "Big Pickle"}
          }
        }
      ]
    }
  end

  defp default_messages do
    [
      %{
        "info" => %{
          "id" => "message-user-1",
          "role" => "user",
          "sessionID" => "session-test-1",
          "time" => %{"created" => 1_704_067_200_000}
        },
        "parts" => [
          %{"id" => "part-user-1", "type" => "text", "text" => "Summarize project status"}
        ]
      },
      %{
        "info" => %{
          "id" => "message-assistant-1",
          "role" => "assistant",
          "sessionID" => "session-test-1",
          "finish" => "stop",
          "time" => %{"created" => 1_704_067_201_000, "completed" => 1_704_067_202_000}
        },
        "parts" => [
          %{
            "id" => "part-assistant-1",
            "type" => "text",
            "text" => "Status is green."
          }
        ]
      }
    ]
  end
end
