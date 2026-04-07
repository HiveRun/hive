defmodule HiveServerElixirWeb.TemplatesControllerTest do
  use HiveServerElixirWeb.ConnCase

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Workspaces

  setup do
    previous_active_workspace_id = Workspaces.active_workspace_id()

    Workspace
    |> Ash.read!(domain: Cells)
    |> Enum.each(&Ash.destroy!(&1, domain: Cells))

    :ok = Workspaces.set_active_workspace_id(nil)

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)
    end)

    :ok
  end

  test "GET /api/templates returns templates, defaults, and agent defaults", %{conn: conn} do
    workspace_path = template_workspace_dir!("templates-list")
    write_workspace_config!(workspace_path)
    write_opencode_config!(workspace_path, "opencode/big-pickle")

    workspace = workspace!(workspace_path, "Templates Workspace")

    conn = get(conn, ~p"/api/templates?workspaceId=#{workspace.id}")

    assert %{
             "templates" => templates,
             "defaults" => defaults,
             "agentDefaults" => agent_defaults
           } = json_response(conn, 200)

    assert Enum.any?(templates, fn template ->
             template["id"] == "basic" and template["label"] == "Basic Template"
           end)

    assert defaults["templateId"] == "basic"
    assert defaults["startMode"] == "build"

    assert agent_defaults["providerId"] == "opencode"
    assert agent_defaults["modelId"] == "big-pickle"
  end

  test "GET /api/templates/:id returns template detail payload", %{conn: conn} do
    workspace_path = template_workspace_dir!("templates-detail")
    write_workspace_config!(workspace_path)
    workspace = workspace!(workspace_path, "Templates Detail")

    conn = get(conn, ~p"/api/templates/basic?workspaceId=#{workspace.id}")

    assert %{
             "id" => "basic",
             "label" => "Basic Template",
             "type" => "manual",
             "configJson" => config_json,
             "includeDirectories" => include_directories
           } = json_response(conn, 200)

    assert config_json["agent"]["providerId"] == "opencode"
    assert include_directories == ["apps"]
  end

  test "GET /api/templates/:id returns 404 for missing templates", %{conn: conn} do
    workspace_path = template_workspace_dir!("templates-missing")
    write_workspace_config!(workspace_path)
    workspace = workspace!(workspace_path, "Missing Template Workspace")

    conn = get(conn, ~p"/api/templates/unknown?workspaceId=#{workspace.id}")

    assert %{"message" => "Template 'unknown' not found"} = json_response(conn, 404)
  end

  test "GET /api/templates returns 400 when no workspace is active", %{conn: conn} do
    :ok = Workspaces.set_active_workspace_id(nil)

    conn = get(conn, ~p"/api/templates")

    assert %{"message" => message} = json_response(conn, 400)
    assert message =~ "No active workspace"
  end

  test "GET /api/templates falls back to x-workspace-id header", %{conn: conn} do
    workspace_path = template_workspace_dir!("templates-header")
    write_workspace_config!(workspace_path)

    workspace = workspace!(workspace_path, "Header Templates Workspace")

    conn =
      conn
      |> put_req_header("x-workspace-id", workspace.id)
      |> get(~p"/api/templates")

    assert %{"templates" => [%{"id" => "basic"}]} = json_response(conn, 200)
  end

  defp workspace!(path, label) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: label},
               domain: Cells
             )

    workspace
  end

  defp write_workspace_config!(workspace_path) do
    config = %{
      "templates" => %{
        "basic" => %{
          "label" => "Basic Template",
          "type" => "manual",
          "agent" => %{"providerId" => "opencode"},
          "includePatterns" => ["./apps/web/**", "./.env*"]
        }
      },
      "defaults" => %{"templateId" => "basic"},
      "opencode" => %{"defaultMode" => "build"}
    }

    File.write!(Path.join(workspace_path, "hive.config.json"), Jason.encode!(config))
  end

  defp write_opencode_config!(workspace_path, model) do
    File.write!(Path.join(workspace_path, "opencode.json"), Jason.encode!(%{"model" => model}))
  end

  defp template_workspace_dir!(suffix) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-templates-#{suffix}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)

    on_exit(fn ->
      File.rm_rf!(path)
    end)

    path
  end
end
