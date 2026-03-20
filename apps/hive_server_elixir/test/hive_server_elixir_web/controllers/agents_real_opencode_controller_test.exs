defmodule HiveServerElixirWeb.AgentsRealOpencodeControllerTest do
  use HiveServerElixirWeb.ConnCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.ServerManager
  alias HiveServerElixir.OpencodeRealServer

  setup_all do
    if System.find_executable("opencode") do
      :ok
    else
      {:skip, "opencode executable not available"}
    end
  end

  setup do
    previous_base_url = Application.get_env(:hive_server_elixir, :opencode_base_url)

    workspace_path = tmp_workspace_path!("opencode/big-pickle")
    second_workspace_path = tmp_workspace_path!("opencode/big-pickle")

    on_exit(fn ->
      restore_env(:opencode_base_url, previous_base_url)
      File.rm_rf!(workspace_path)
      File.rm_rf!(second_workspace_path)
    end)

    {:ok, workspace_path: workspace_path, second_workspace_path: second_workspace_path}
  end

  test "GET /api/agents/models returns models through an externally provided real opencode server",
       %{conn: conn, workspace_path: workspace_path} do
    server = OpencodeRealServer.start!()
    Application.put_env(:hive_server_elixir, :opencode_base_url, server.url)

    on_exit(fn ->
      OpencodeRealServer.stop(server)
    end)

    workspace = workspace!(workspace_path)

    conn = get(conn, ~p"/api/agents/models?workspaceId=#{workspace.id}")

    assert %{
             "models" => models,
             "defaults" => defaults,
             "providers" => providers
           } = json_response(conn, 200)

    assert Enum.any?(models, &(&1["id"] == "big-pickle" and &1["provider"] == "opencode"))
    assert defaults["opencode"] == "big-pickle"
    assert Enum.any?(providers, &(&1["id"] == "opencode"))
  end

  test "GET /api/agents/models works through the managed shared OpenCode server", %{
    conn: conn,
    workspace_path: workspace_path
  } do
    start_supervised!({ServerManager, timeout_ms: 15_000})
    workspace = workspace!(workspace_path)

    conn = get(conn, ~p"/api/agents/models?workspaceId=#{workspace.id}")

    assert %{
             "models" => models,
             "defaults" => defaults,
             "providers" => providers
           } = json_response(conn, 200)

    assert Enum.any?(models, &(&1["id"] == "big-pickle" and &1["provider"] == "opencode"))
    assert defaults["opencode"] == "big-pickle"
    assert Enum.any?(providers, &(&1["id"] == "opencode"))
  end

  test "one managed shared OpenCode server can serve multiple workspaces", %{
    conn: conn,
    workspace_path: workspace_path,
    second_workspace_path: second_workspace_path
  } do
    start_supervised!({ServerManager, timeout_ms: 15_000})

    first_workspace = workspace!(workspace_path)
    second_workspace = workspace!(second_workspace_path)

    first_conn = get(conn, ~p"/api/agents/models?workspaceId=#{first_workspace.id}")

    assert %{"models" => first_models, "providers" => first_providers} =
             json_response(first_conn, 200)

    second_conn = build_conn() |> get(~p"/api/agents/models?workspaceId=#{second_workspace.id}")

    assert %{"models" => second_models, "providers" => second_providers} =
             json_response(second_conn, 200)

    assert first_models != []
    assert second_models != []
    assert first_providers != []
    assert second_providers != []
  end

  defp workspace!(workspace_path) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: workspace_path, label: Path.basename(workspace_path)},
               domain: Cells
             )

    workspace
  end

  defp tmp_workspace_path!(model) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-real-opencode-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)
    File.write!(Path.join(path, "hive.config.json"), "{}\n")
    File.write!(Path.join(path, "@opencode.json"), Jason.encode!(%{"model" => model}))
    path
  end

  defp restore_env(key, nil), do: Application.delete_env(:hive_server_elixir, key)
  defp restore_env(key, value), do: Application.put_env(:hive_server_elixir, key, value)
end
