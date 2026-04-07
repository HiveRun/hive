defmodule HiveServerElixir.Cells.TemplateRuntime do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TemplateConfig
  alias HiveServerElixir.Cells.Terminals.SetupRunner

  @service_create_attempts 5
  @service_create_retry_ms 100

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
    port_map = build_service_port_map(template.services)

    template.services
    |> Enum.reduce_while({:ok, []}, fn service_definition, {:ok, acc} ->
      case ensure_service(cell, service_definition, existing_services, template.env, port_map) do
        {:ok, service} -> {:cont, {:ok, acc ++ [service]}}
        {:error, message} -> {:halt, {:error, message}}
      end
    end)
  end

  defp ensure_service(
         %Cell{} = cell,
         service_definition,
         existing_services,
         template_env,
         port_map
       ) do
    case Enum.find(existing_services, &(&1.name == service_definition.name)) do
      %Service{} = service ->
        {:ok, service}

      nil ->
        command =
          interpolate_port_tokens(service_definition.command, port_map, service_definition.name)

        attrs = %{
          cell_id: cell.id,
          name: service_definition.name,
          type: service_definition.type,
          command: command,
          cwd: resolve_cwd(cell.workspace_path, service_definition.cwd),
          env:
            build_service_env(
              cell,
              service_definition.name,
              template_env,
              service_definition.env,
              port_map
            ),
          port: Map.get(port_map, service_definition.name),
          ready_timeout_ms: service_definition.ready_timeout_ms,
          definition: service_definition.definition
        }

        case create_service_with_retry(attrs) do
          {:ok, service} ->
            {:ok, service}

          {:error, error} ->
            {:error, "Failed to create service '#{service_definition.name}': #{inspect(error)}"}
        end
    end
  end

  defp create_service_with_retry(attrs, attempts_left \\ @service_create_attempts)

  defp create_service_with_retry(attrs, attempts_left) when attempts_left > 1 do
    case Ash.create(Service, attrs) do
      {:ok, service} ->
        {:ok, service}

      {:error, error} ->
        if busy_sqlite_error?(error) do
          Process.sleep(@service_create_retry_ms)
          create_service_with_retry(attrs, attempts_left - 1)
        else
          {:error, error}
        end
    end
  end

  defp create_service_with_retry(attrs, _attempts_left) do
    Ash.create(Service, attrs)
  end

  defp busy_sqlite_error?(error) do
    inspect(error) |> String.contains?("Database busy")
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
    SetupRunner.run(cell, %{
      id: template.id,
      env:
        base_env(cell, template.id)
        |> Map.merge(template.env)
        |> Map.put("HIVE_WORKTREE_SETUP", "true")
        |> Map.put("HIVE_MAIN_REPO", cell.workspace_root_path)
        |> Map.put("FORCE_COLOR", "1"),
      setup: template.setup
    })
  end

  defp list_services(cell_id) do
    Service
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read!()
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
      "HIVE_SERVICE_NAME" => service_name,
      "MISE_TRUSTED_CONFIG_PATHS" => cell.workspace_path
    }
  end

  defp build_service_env(%Cell{} = cell, service_name, template_env, service_env, port_map) do
    current_port = Map.get(port_map, service_name)

    base_env(cell, service_name)
    |> Map.merge(shared_port_env(port_map))
    |> maybe_put_port(current_port, service_name)
    |> Map.merge(template_env)
    |> Map.merge(service_env)
    |> Map.new(fn {key, value} ->
      {key, interpolate_port_tokens(to_string(value), port_map, service_name)}
    end)
  end

  defp shared_port_env(port_map) do
    Enum.reduce(port_map, %{}, fn {service_name, port}, acc ->
      Map.put(acc, "#{sanitize_service_name(service_name)}_PORT", Integer.to_string(port))
    end)
  end

  defp maybe_put_port(env, nil, _service_name), do: env

  defp maybe_put_port(env, port, service_name) do
    port_string = Integer.to_string(port)

    env
    |> Map.put("PORT", port_string)
    |> Map.put("SERVICE_PORT", port_string)
    |> Map.put("#{sanitize_service_name(service_name)}_PORT", port_string)
  end

  defp build_service_port_map(service_definitions) do
    Enum.reduce(service_definitions, %{}, fn service_definition, acc ->
      Map.put(acc, service_definition.name, reserve_port())
    end)
  end

  defp interpolate_port_tokens(value, port_map, current_service_name) when is_binary(value) do
    Regex.replace(~r/\$(?:\{?PORT(?::([A-Za-z0-9_-]+))?\}?)/, value, fn match, target ->
      target_name = if target in [nil, ""], do: current_service_name, else: target

      case Map.get(port_map, target_name) do
        nil -> match
        port -> Integer.to_string(port)
      end
    end)
  end

  defp interpolate_port_tokens(value, _port_map, _current_service_name), do: value

  defp sanitize_service_name(service_name) do
    service_name
    |> String.upcase()
    |> String.replace(~r/[^A-Z0-9]+/, "_")
  end

  defp reserve_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, {_address, port}} = :inet.sockname(socket)
    :ok = :gen_tcp.close(socket)
    port
  end
end
