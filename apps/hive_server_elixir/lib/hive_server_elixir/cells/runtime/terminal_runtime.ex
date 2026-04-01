defmodule HiveServerElixir.Cells.TerminalRuntime do
  @moduledoc false

  use Supervisor

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Terminals.ChatSpec
  alias HiveServerElixir.Cells.Terminals.SessionServer
  alias HiveServerElixir.Cells.Terminals.SessionSpec
  alias HiveServerElixir.Opencode.ServerManager

  @shell System.find_executable("sh") || "/bin/sh"
  @default_cols 120
  @default_rows 36

  @type scope ::
          {:terminal, String.t()}
          | {:setup, String.t()}
          | {:chat, String.t()}
          | {:service, String.t(), String.t()}

  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    Supervisor.start_link(__MODULE__, :ok, name: name)
  end

  @impl true
  def init(:ok) do
    children = [
      {Registry, keys: :unique, name: registry_name()},
      {DynamicSupervisor, strategy: :one_for_one, name: supervisor_name()}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  def registry_name, do: __MODULE__.Registry
  def supervisor_name, do: __MODULE__.Supervisor

  @spec ensure_terminal_session(String.t() | Cell.t()) :: {:ok, map()} | {:error, term()}
  def ensure_terminal_session(%Cell{} = cell), do: ensure_session_for_spec(terminal_spec(cell))

  def ensure_terminal_session(cell_id) when is_binary(cell_id) do
    with {:ok, %Cell{} = cell} <- Ash.get(Cell, cell_id) do
      ensure_terminal_session(cell)
    end
  end

  @spec ensure_setup_session(String.t() | Cell.t()) :: {:ok, map()} | {:error, term()}
  def ensure_setup_session(%Cell{} = cell), do: ensure_session_for_spec(setup_spec(cell))

  def ensure_setup_session(cell_id) when is_binary(cell_id) do
    with {:ok, %Cell{} = cell} <- Ash.get(Cell, cell_id) do
      ensure_setup_session(cell)
    end
  end

  @spec ensure_service_session(Service.t()) :: {:ok, map()} | {:error, term()}
  def ensure_service_session(%Service{} = service),
    do: ensure_session_for_spec(service_spec(service))

  @spec ensure_service_session(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def ensure_service_session(cell_id, service_id)
      when is_binary(cell_id) and is_binary(service_id) do
    with {:ok, %Service{cell_id: ^cell_id} = service} <- Ash.get(Service, service_id) do
      ensure_service_session(service)
    else
      {:ok, _service} -> {:error, :service_not_found}
      error -> error
    end
  end

  @spec ensure_chat_session(String.t() | Cell.t()) :: {:ok, map()} | {:error, term()}
  def ensure_chat_session(%Cell{} = cell) do
    with {:ok, ensured_cell} <- ensure_remote_chat_session(cell),
         {:ok, spec} <- ChatSpec.build(ensured_cell) do
      ensure_session_for_spec(spec)
    end
  end

  def ensure_chat_session(cell_id) when is_binary(cell_id) do
    with {:ok, %Cell{} = cell} <- Ash.get(Cell, cell_id) do
      ensure_chat_session(cell)
    end
  end

  @spec read_terminal_output(String.t()) :: String.t()
  def read_terminal_output(cell_id) when is_binary(cell_id) do
    read_output({:terminal, cell_id})
  end

  @spec read_setup_output(String.t()) :: String.t()
  def read_setup_output(cell_id) when is_binary(cell_id) do
    read_output({:setup, cell_id})
  end

  @spec read_service_output(String.t(), String.t()) :: String.t()
  def read_service_output(cell_id, service_id)
      when is_binary(cell_id) and is_binary(service_id) do
    read_output({:service, cell_id, service_id})
  end

  @spec read_chat_output(String.t()) :: String.t()
  def read_chat_output(cell_id) when is_binary(cell_id) do
    read_output({:chat, cell_id})
  end

  @spec read_output(scope()) :: String.t()
  def read_output(scope) do
    case lookup_session(scope) do
      {:ok, pid} ->
        case GenServer.call(pid, :snapshot) do
          {:ok, output} -> output
          _other -> ""
        end

      :error ->
        ""
    end
  end

  @spec write_setup_input(String.t(), String.t()) :: :ok | {:error, term()}
  def write_terminal_input(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    write_input({:terminal, cell_id}, chunk)
  end

  @spec write_setup_input(String.t(), String.t()) :: :ok | {:error, term()}
  def write_setup_input(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    write_input({:setup, cell_id}, chunk)
  end

  @spec write_service_input(String.t(), String.t(), String.t()) :: :ok | {:error, term()}
  def write_service_input(cell_id, service_id, chunk)
      when is_binary(cell_id) and is_binary(service_id) and is_binary(chunk) do
    write_input({:service, cell_id, service_id}, chunk)
  end

  @spec write_chat_input(String.t(), String.t()) :: :ok | {:error, term()}
  def write_chat_input(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    write_input({:chat, cell_id}, chunk)
  end

  @spec write_input(scope(), String.t()) :: :ok | {:error, term()}
  def write_input(scope, chunk) when is_binary(chunk) do
    with {:ok, pid} <- ensure_session_process(scope),
         :ok <- GenServer.call(pid, {:write, chunk}) do
      :ok
    end
  end

  @spec append_setup_output(String.t(), String.t()) :: :ok | {:error, term()}
  def append_setup_output(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    inject_output({:setup, cell_id}, chunk)
  end

  @spec append_service_output(String.t(), String.t(), String.t()) :: :ok | {:error, term()}
  def append_service_output(cell_id, service_id, chunk)
      when is_binary(cell_id) and is_binary(service_id) and is_binary(chunk) do
    inject_output({:service, cell_id, service_id}, chunk)
  end

  @spec append_chat_output(String.t(), String.t()) :: :ok | {:error, term()}
  def append_chat_output(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    inject_output({:chat, cell_id}, chunk)
  end

  @spec inject_output(scope(), String.t()) :: :ok | {:error, term()}
  def inject_output(scope, chunk) when is_binary(chunk) do
    with {:ok, pid} <- ensure_session_process(scope),
         :ok <- GenServer.call(pid, {:inject, chunk}) do
      :ok
    end
  end

  @spec resize_setup_session(String.t(), pos_integer(), pos_integer()) ::
          {:ok, map()} | {:error, term()}
  def resize_terminal_session(cell_id, cols, rows),
    do: resize_session({:terminal, cell_id}, cols, rows)

  @spec resize_setup_session(String.t(), pos_integer(), pos_integer()) ::
          {:ok, map()} | {:error, term()}
  def resize_setup_session(cell_id, cols, rows), do: resize_session({:setup, cell_id}, cols, rows)

  @spec resize_service_session(String.t(), String.t(), pos_integer(), pos_integer()) ::
          {:ok, map()} | {:error, term()}
  def resize_service_session(cell_id, service_id, cols, rows),
    do: resize_session({:service, cell_id, service_id}, cols, rows)

  @spec resize_chat_session(String.t(), pos_integer(), pos_integer()) ::
          {:ok, map()} | {:error, term()}
  def resize_chat_session(cell_id, cols, rows), do: resize_session({:chat, cell_id}, cols, rows)

  @spec resize_session(scope(), pos_integer(), pos_integer()) :: {:ok, map()} | {:error, term()}
  def resize_session(scope, cols, rows) do
    with {:ok, pid} <- ensure_session_process(scope) do
      GenServer.call(pid, {:resize, cols, rows})
    end
  end

  @spec restart_chat_session(String.t()) :: {:ok, map()} | {:error, term()}
  def restart_terminal_session(cell_id) when is_binary(cell_id) do
    restart_session({:terminal, cell_id})
  end

  @spec restart_chat_session(String.t()) :: {:ok, map()} | {:error, term()}
  def restart_chat_session(cell_id) when is_binary(cell_id) do
    restart_session({:chat, cell_id})
  end

  @spec restart_setup_session(String.t()) :: {:ok, map()} | {:error, term()}
  def restart_setup_session(cell_id) when is_binary(cell_id) do
    restart_session({:setup, cell_id})
  end

  @spec restart_session(scope()) :: {:ok, map()} | {:error, term()}
  def restart_session(scope) do
    with {:ok, pid} <- ensure_session_process(scope),
         {:ok, spec} <- spec_for_scope(scope) do
      GenServer.call(
        pid,
        {:restart, spec,
         [
           publish_terminal_exit?: false,
           notify_service_runtime?: false,
           close_terminal_session?: false
         ]}
      )
    end
  end

  @spec close_scope(scope(), keyword()) :: :ok | {:error, term()}
  def close_scope(scope, opts \\ []) do
    case lookup_session(scope) do
      {:ok, pid} -> GenServer.call(pid, {:terminate, opts})
      :error -> :ok
    end
  end

  @spec runtime_status(scope()) :: %{status: String.t(), pid: integer() | nil} | nil
  def runtime_status(scope) do
    case lookup_session(scope) do
      {:ok, pid} ->
        case GenServer.call(pid, :runtime_status) do
          nil -> nil
          status -> status
        end

      :error ->
        nil
    end
  end

  @spec clear_cell(String.t()) :: :ok
  def clear_cell(cell_id) when is_binary(cell_id) do
    active_scopes()
    |> Enum.filter(&key_matches_cell?(&1, cell_id))
    |> Enum.each(fn scope ->
      :ok =
        close_scope(scope,
          publish_terminal_exit?: false,
          notify_service_runtime?: false,
          close_terminal_session?: true
        )

      case lookup_session(scope) do
        {:ok, pid} ->
          _ = DynamicSupervisor.terminate_child(supervisor_name(), pid)
          :ok

        :error ->
          :ok
      end
    end)

    close_terminal_sessions(cell_id)
    :ok
  end

  @spec ensure_session_for_spec(SessionSpec.t()) :: {:ok, map()} | {:error, term()}
  def ensure_session_for_spec(%SessionSpec{} = spec) do
    case lookup_session(spec.scope) do
      {:ok, pid} ->
        GenServer.call(pid, {:ensure_spec, spec})

      :error ->
        case DynamicSupervisor.start_child(supervisor_name(), {SessionServer, spec}) do
          {:ok, pid} -> GenServer.call(pid, :session)
          {:error, {:already_started, pid}} -> GenServer.call(pid, {:ensure_spec, spec})
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp ensure_session_process(scope) do
    case lookup_session(scope) do
      {:ok, pid} ->
        {:ok, pid}

      :error ->
        with {:ok, spec} <- spec_for_scope(scope),
             {:ok, _session} <- ensure_session_for_spec(spec),
             {:ok, pid} <- lookup_session(scope) do
          {:ok, pid}
        end
    end
  end

  defp spec_for_scope({:terminal, cell_id}) do
    with {:ok, %Cell{} = cell} <- Ash.get(Cell, cell_id) do
      {:ok, terminal_spec(cell)}
    end
  end

  defp spec_for_scope({:setup, cell_id}) do
    with {:ok, %Cell{} = cell} <- Ash.get(Cell, cell_id) do
      {:ok, setup_spec(cell)}
    end
  end

  defp spec_for_scope({:chat, cell_id}) do
    with {:ok, %Cell{} = cell} <- Ash.get(Cell, cell_id) do
      ChatSpec.build(cell)
    end
  end

  defp spec_for_scope({:service, cell_id, service_id}) do
    with {:ok, %Service{cell_id: ^cell_id} = service} <- Ash.get(Service, service_id) do
      {:ok, service_spec(service)}
    else
      {:ok, _service} -> {:error, :service_not_found}
      error -> error
    end
  end

  defp ensure_remote_chat_session(%Cell{} = cell) do
    session_id = cell.opencode_session_id
    opts = [base_url: ServerManager.resolved_base_url(), directory: cell.workspace_path]

    case remote_session_exists?(session_id, opts) do
      true ->
        {:ok, cell}

      false ->
        desired_model = desired_chat_model(cell)

        with {:ok, %{"id" => remote_session_id}} <-
               OpenCode.Generated.Operations.session_create(%{}, opts),
             {:ok, updated_cell} <-
               Ash.update(cell, %{opencode_session_id: remote_session_id}, action: :update),
             :ok <- sync_agent_session_identity(updated_cell.id, remote_session_id),
             :ok <- sync_agent_session_model(updated_cell.id, desired_model),
             :ok <-
               prime_remote_chat_session(
                 updated_cell.id,
                 updated_cell.workspace_path,
                 desired_model
               ) do
          {:ok, updated_cell}
        else
          {:error, _reason} -> {:ok, cell}
          :error -> {:ok, cell}
        end
    end
  end

  defp remote_session_exists?(session_id, _opts) when not is_binary(session_id), do: false

  defp remote_session_exists?(session_id, opts) do
    case OpenCode.Generated.Operations.session_messages(session_id, opts) do
      {:ok, _payload} -> true
      {:error, {404, _body}} -> false
      {:error, {400, _body}} -> false
      {:error, _reason} -> false
      :error -> false
    end
  end

  defp sync_agent_session_identity(cell_id, session_id) do
    case AgentSession.fetch_for_cell(cell_id) do
      %AgentSession{} = agent_session ->
        case Ash.update(agent_session, %{session_id: session_id}, action: :sync_session_identity) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        :ok
    end
  end

  defp prime_remote_chat_session(cell_id, workspace_path, desired_model) do
    case AgentSession.fetch_for_cell(cell_id) do
      %AgentSession{} = agent_session ->
        params = %{
          agent: agent_session.current_mode || agent_session.start_mode || "plan",
          noReply: true,
          parts: [%{type: "text", text: ""}]
        }

        {provider_id, model_id} =
          case desired_model do
            %{provider_id: provider_id, model_id: model_id} -> {provider_id, model_id}
            _other -> {agent_session.model_provider_id, agent_session.model_id}
          end

        params =
          if is_binary(provider_id) and is_binary(model_id) do
            Map.put(params, :model, %{
              providerID: provider_id,
              modelID: model_id
            })
          else
            params
          end

        case OpenCode.Generated.Operations.session_prompt(
               agent_session.session_id,
               params,
               base_url: ServerManager.resolved_base_url(),
               directory: workspace_path
             ) do
          {:ok, _payload} -> :ok
          {:error, error} -> {:error, error}
          :error -> {:error, :prompt_failed}
        end

      nil ->
        :ok
    end
  end

  defp sync_agent_session_model(_cell_id, nil), do: :ok

  defp sync_agent_session_model(cell_id, %{provider_id: provider_id, model_id: model_id}) do
    case AgentSession.fetch_for_cell(cell_id) do
      %AgentSession{} = agent_session ->
        case Ash.update(
               agent_session,
               %{model_provider_id: provider_id, model_id: model_id, resume_on_startup: true},
               action: :sync_runtime_details
             ) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        :ok
    end
  end

  defp desired_chat_model(%Cell{} = cell) do
    with {:ok, payload} <-
           OpenCode.Generated.Operations.config_providers(
             directory: cell.workspace_path,
             base_url: ServerManager.resolved_base_url()
           ),
         defaults when is_map(defaults) <- Map.get(payload, "default") do
      cond do
        is_binary(defaults["openai"]) ->
          %{provider_id: "openai", model_id: defaults["openai"]}

        map_size(defaults) > 0 ->
          {provider_id, model_id} = Enum.at(defaults, 0)
          %{provider_id: provider_id, model_id: model_id}

        true ->
          nil
      end
    else
      _other -> nil
    end
  end

  defp setup_spec(%Cell{} = cell) do
    env = %{
      "HIVE_CELL_ID" => cell.id,
      "HIVE_WORKSPACE_PATH" => cell.workspace_path,
      "HIVE_WORKSPACE_ROOT" => cell.workspace_root_path,
      "MISE_TRUSTED_CONFIG_PATHS" => cell.workspace_path,
      "TERM" => "xterm-256color",
      "COLORTERM" => System.get_env("COLORTERM") || "truecolor"
    }

    init_script =
      [
        "cd #{ChatSpec.shell_escape(cell.workspace_path)}",
        export_lines(env),
        "exec #{@shell} -i"
      ]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join(" && ")

    %SessionSpec{
      scope: {:setup, cell.id},
      kind: :setup,
      command: @shell,
      args: ["-lc", init_script],
      cwd: cell.workspace_path,
      buffer_kind: :default,
      fingerprint: "setup|" <> cell.workspace_path,
      allow_control_input: true,
      plan_mode: false,
      session_prefix: "setup_terminal",
      cols: @default_cols,
      rows: @default_rows
    }
  end

  defp terminal_spec(%Cell{} = cell) do
    shell = System.get_env("SHELL") || System.find_executable("bash") || @shell

    init_script =
      [
        "cd #{ChatSpec.shell_escape(cell.workspace_path)}",
        "exec #{ChatSpec.shell_escape(shell)} -i"
      ]
      |> Enum.join(" && ")

    %SessionSpec{
      scope: {:terminal, cell.id},
      kind: :terminal,
      command: @shell,
      args: ["-lc", init_script],
      cwd: cell.workspace_path,
      buffer_kind: :default,
      fingerprint: "terminal|" <> cell.workspace_path,
      allow_control_input: true,
      plan_mode: false,
      session_prefix: "terminal",
      cols: @default_cols,
      rows: @default_rows
    }
  end

  defp service_spec(%Service{} = service) do
    command_line = "exec " <> service.command

    script =
      [
        "cd #{ChatSpec.shell_escape(valid_cwd(service.cwd))}",
        export_lines(service.env || %{}),
        command_line
      ]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join(" && ")

    %SessionSpec{
      scope: {:service, service.cell_id, service.id},
      kind: :service,
      command: @shell,
      args: ["-lc", script],
      cwd: valid_cwd(service.cwd),
      buffer_kind: :default,
      fingerprint:
        [
          service.cell_id,
          service.id,
          service.command,
          valid_cwd(service.cwd),
          Jason.encode!(service.env || %{})
        ]
        |> Enum.join("|"),
      allow_control_input: true,
      plan_mode: false,
      session_prefix: "service_terminal",
      cols: @default_cols,
      rows: @default_rows
    }
  end

  defp valid_cwd(cwd) when is_binary(cwd) do
    if File.dir?(cwd), do: cwd, else: File.cwd!()
  end

  defp valid_cwd(_cwd), do: File.cwd!()

  defp export_lines(env) when map_size(env) == 0, do: ""

  defp export_lines(env) do
    env
    |> Enum.map(fn {key, value} -> "export #{key}=#{ChatSpec.shell_escape(to_string(value))}" end)
    |> Enum.join(" && ")
  end

  defp lookup_session(scope) do
    case Registry.lookup(registry_name(), scope) do
      [{pid, _value}] -> {:ok, pid}
      [] -> :error
    end
  end

  defp active_scopes do
    Registry.select(registry_name(), [{{:"$1", :_, :_}, [], [:"$1"]}])
  end

  defp close_terminal_sessions(cell_id) do
    alias HiveServerElixir.Cells.TerminalSession
    import Ash.Expr
    require Ash.Query

    try do
      TerminalSession
      |> Ash.Query.filter(expr(cell_id == ^cell_id))
      |> Ash.read!()
      |> Enum.each(fn terminal_session ->
        _ = Ash.update(terminal_session, %{}, action: :close)
      end)
    rescue
      _error -> :ok
    catch
      _kind, _reason -> :ok
    end
  end

  defp key_matches_cell?({:terminal, key_cell_id}, cell_id), do: key_cell_id == cell_id
  defp key_matches_cell?({:setup, key_cell_id}, cell_id), do: key_cell_id == cell_id
  defp key_matches_cell?({:chat, key_cell_id}, cell_id), do: key_cell_id == cell_id

  defp key_matches_cell?({:service, key_cell_id, _service_id}, cell_id),
    do: key_cell_id == cell_id
end
