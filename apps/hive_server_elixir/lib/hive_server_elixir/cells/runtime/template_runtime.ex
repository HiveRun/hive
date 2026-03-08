defmodule HiveServerElixir.Cells.TemplateRuntime do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TemplateConfig
  alias HiveServerElixir.Cells.TerminalRuntime

  @shell System.find_executable("sh") || "/bin/sh"

  @spec prepare_cell(Cell.t()) :: {:ok, %{status: String.t(), last_setup_error: String.t() | nil}}
  def prepare_cell(%Cell{} = cell) do
    case TemplateConfig.fetch_template(cell.workspace_root_path, cell.template_id) do
      {:ok, template} ->
        with {:ok, services} <- ensure_services(cell, template),
             :ok <- run_setup_commands(cell, template),
             :ok <- start_services(services) do
          {:ok, %{status: "ready", last_setup_error: nil}}
        else
          {:error, message} ->
            :ok = ServiceRuntime.stop_cell_services(cell.id)
            {:ok, %{status: "error", last_setup_error: message}}
        end

      {:error, message} ->
        if ignorable_template_error?(message) do
          {:ok, %{status: "ready", last_setup_error: nil}}
        else
          {:ok, %{status: "error", last_setup_error: message}}
        end
    end
  end

  defp ignorable_template_error?(message) when is_binary(message) do
    String.contains?(message, "Template '") ||
      String.contains?(message, "Failed to load workspace config")
  end

  defp ignorable_template_error?(_message), do: false

  defp ensure_services(%Cell{} = cell, template) do
    existing_services = list_services(cell.id)

    template.services
    |> Enum.reduce_while({:ok, []}, fn service_definition, {:ok, acc} ->
      case ensure_service(cell, service_definition, existing_services) do
        {:ok, service} -> {:cont, {:ok, acc ++ [service]}}
        {:error, message} -> {:halt, {:error, message}}
      end
    end)
  end

  defp ensure_service(%Cell{} = cell, service_definition, existing_services) do
    case Enum.find(existing_services, &(&1.name == service_definition.name)) do
      %Service{} = service ->
        {:ok, service}

      nil ->
        attrs = %{
          cell_id: cell.id,
          name: service_definition.name,
          type: service_definition.type,
          command: service_definition.command,
          cwd: resolve_cwd(cell.workspace_path, service_definition.cwd),
          env: Map.merge(service_definition.env, base_env(cell, service_definition.name)),
          ready_timeout_ms: service_definition.ready_timeout_ms,
          definition: service_definition.definition
        }

        case Ash.create(Service, attrs, domain: Cells) do
          {:ok, service} ->
            {:ok, service}

          {:error, error} ->
            {:error, "Failed to create service '#{service_definition.name}': #{inspect(error)}"}
        end
    end
  end

  defp start_services(services) do
    Enum.reduce_while(services, :ok, fn service, :ok ->
      case ServiceRuntime.start_service(service) do
        :ok ->
          {:cont, :ok}

        {:error, reason} ->
          {:halt, {:error, "Failed to start service '#{service.name}': #{inspect(reason)}"}}
      end
    end)
  end

  defp run_setup_commands(%Cell{} = cell, template) do
    if template.setup == [] do
      :ok
    else
      :ok = emit_setup_line(cell.id, "[setup] Starting template setup for #{template.id}")

      template.setup
      |> Enum.reduce_while(:ok, fn command, :ok ->
        :ok = emit_setup_line(cell.id, "[setup] Running: #{command}")

        env =
          base_env(cell, template.id)
          |> Map.merge(template.env)
          |> Map.put("HIVE_WORKTREE_SETUP", "true")
          |> Map.put("HIVE_MAIN_REPO", cell.workspace_root_path)
          |> Map.put("FORCE_COLOR", "1")

        case System.cmd(@shell, ["-lc", command],
               cd: cell.workspace_path,
               env: Enum.to_list(env),
               stderr_to_stdout: true
             ) do
          {output, 0} ->
            emit_setup_output(cell.id, output)
            :ok = emit_setup_line(cell.id, "[setup] Completed: #{command}")
            {:cont, :ok}

          {output, exit_code} ->
            emit_setup_output(cell.id, output)
            :ok = emit_setup_line(cell.id, "[setup] Failed: #{command} (exit #{exit_code})")

            {:halt,
             {:error, "Template setup command failed with exit code #{exit_code}: #{command}"}}
        end
      end)
    end
  end

  defp emit_setup_line(cell_id, line) do
    emit_setup_output(cell_id, line <> "\n")
  end

  defp emit_setup_output(cell_id, output) when is_binary(output) do
    if output != "" do
      :ok = TerminalRuntime.append_setup_output(cell_id, output)
      :ok = Events.publish_setup_terminal_data(cell_id, output)
    end

    :ok
  end

  defp list_services(cell_id) do
    Service
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read!(domain: Cells)
  end

  defp resolve_cwd(workspace_path, nil), do: workspace_path

  defp resolve_cwd(workspace_path, cwd) when is_binary(cwd) do
    if Path.type(cwd) == :absolute do
      cwd
    else
      Path.expand(cwd, workspace_path)
    end
  end

  defp base_env(%Cell{} = cell, service_name) do
    %{
      "HIVE_CELL_ID" => cell.id,
      "HIVE_WORKSPACE_PATH" => cell.workspace_path,
      "HIVE_WORKSPACE_ROOT" => cell.workspace_root_path,
      "HIVE_SERVICE_NAME" => service_name
    }
  end
end
