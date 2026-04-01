defmodule HiveServerElixir.Cells.Terminals.ChatSpec do
  @moduledoc false

  alias HiveServerElixir.Cells.AgentSessionRead
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Terminals.SessionSpec
  alias HiveServerElixir.Opencode.ServerManager

  @default_theme_mode "dark"
  @default_leader_keybind "ctrl+x"
  @ctrl_c_keybind "ctrl+c"
  @ctrl_d_keybind "ctrl+d"
  @embedded_control_keybinds MapSet.new([@ctrl_c_keybind, @ctrl_d_keybind])
  @source_override_only_keybinds MapSet.new(["leader"])
  @workspace_config_candidates ["@opencode.json", "opencode.json"]
  @shell System.find_executable("sh") || "/bin/sh"
  @terminal_name "xterm-256color"
  @hive_theme_name "hive-resonant"

  @hive_embedded_browser_safe_keybinds %{
    "leader" => @default_leader_keybind,
    "app_exit" => "<leader>q",
    "command_list" => "<leader>p",
    "display_thinking" => "<leader>i",
    "input_delete" => "delete,shift+delete",
    "input_delete_line" => "alt+shift+d",
    "input_delete_to_line_end" => "alt+k",
    "input_delete_to_line_start" => "alt+u",
    "input_delete_word_backward" => "ctrl+backspace,alt+backspace",
    "input_line_end" => "end",
    "input_line_home" => "home",
    "input_move_left" => "left",
    "input_move_right" => "right",
    "input_newline" => "shift+return,alt+return,ctrl+return",
    "input_select_line_end" => "shift+end",
    "input_select_line_home" => "shift+home",
    "input_undo" => "super+z,alt+z",
    "input_word_backward" => "ctrl+left,alt+b",
    "input_word_forward" => "ctrl+right,alt+f",
    "model_favorite_toggle" => "<leader>o",
    "model_provider_list" => "<leader>z",
    "session_delete" => "<leader>d",
    "session_rename" => "<leader>k",
    "stash_delete" => "<leader>d",
    "theme_list" => "<leader>j",
    "variant_cycle" => "<leader>t"
  }

  @hive_theme_content ~S|{
  "$schema": "https://opencode.ai/theme.json",
  "defs": {
    "obsidian": "#070504",
    "graphite": "#15110E",
    "basalt": "#241C17",
    "amber": "#F5A524",
    "honey": "#FFC857",
    "signal": "#FF8F1F",
    "pollen": "#FFE9A8",
    "teal": "#2DD4BF",
    "violet": "#7C5BFF",
    "magma": "#FF5C5C",
    "chlorophyll": "#8EDB5D",
    "soot": "#0F0B09",
    "fog": "#C4B89F",
    "steel": "#8A7A63",
    "ivory": "#F4E6CD",
    "daylight": "#F6F1E6",
    "parchment": "#EFE5CF",
    "ink": "#2B2520"
  },
  "theme": {
    "primary": { "dark": "amber", "light": "signal" },
    "secondary": { "dark": "amber", "light": "amber" },
    "accent": { "dark": "honey", "light": "signal" },
    "error": { "dark": "magma", "light": "magma" },
    "warning": { "dark": "signal", "light": "signal" },
    "success": { "dark": "chlorophyll", "light": "chlorophyll" },
    "info": { "dark": "honey", "light": "violet" },
    "text": { "dark": "ivory", "light": "ink" },
    "textMuted": { "dark": "fog", "light": "steel" },
    "background": { "dark": "obsidian", "light": "daylight" },
    "backgroundPanel": { "dark": "graphite", "light": "parchment" },
    "backgroundElement": { "dark": "basalt", "light": "parchment" },
    "backgroundMenu": { "dark": "graphite", "light": "parchment" },
    "border": { "dark": "#4A382C", "light": "#C7BDA6" },
    "borderActive": { "dark": "amber", "light": "signal" },
    "borderSubtle": { "dark": "#33271F", "light": "#D9D0BD" },
    "diffAdded": { "dark": "teal", "light": "#2F7D4A" },
    "diffRemoved": { "dark": "magma", "light": "#B93D3D" },
    "diffContext": { "dark": "fog", "light": "#766C60" },
    "diffHunkHeader": { "dark": "honey", "light": "amber" },
    "diffHighlightAdded": { "dark": "chlorophyll", "light": "#2F7D4A" },
    "diffHighlightRemoved": { "dark": "magma", "light": "#B93D3D" },
    "diffAddedBg": { "dark": "#12352D", "light": "#DDEDD9" },
    "diffRemovedBg": { "dark": "#3D1717", "light": "#F3D9D8" },
    "diffContextBg": { "dark": "graphite", "light": "daylight" },
    "diffLineNumber": { "dark": "steel", "light": "steel" },
    "diffAddedLineNumberBg": { "dark": "#164439", "light": "#D5E8D0" },
    "diffRemovedLineNumberBg": { "dark": "#4A1E1E", "light": "#EED1D0" },
    "markdownText": { "dark": "ivory", "light": "ink" },
    "markdownHeading": { "dark": "honey", "light": "signal" },
    "markdownLink": { "dark": "honey", "light": "#2A7D86" },
    "markdownLinkText": { "dark": "pollen", "light": "#A35D11" },
    "markdownCode": { "dark": "honey", "light": "#A35D11" },
    "markdownBlockQuote": { "dark": "steel", "light": "steel" },
    "markdownEmph": { "dark": "signal", "light": "signal" },
    "markdownStrong": { "dark": "amber", "light": "signal" },
    "markdownHorizontalRule": { "dark": "basalt", "light": "#D9D0BD" },
    "markdownListItem": { "dark": "amber", "light": "signal" },
    "markdownListEnumeration": { "dark": "honey", "light": "amber" },
    "markdownImage": { "dark": "honey", "light": "#2A7D86" },
    "markdownImageText": { "dark": "pollen", "light": "#A35D11" },
    "markdownCodeBlock": { "dark": "ivory", "light": "ink" },
    "syntaxComment": { "dark": "steel", "light": "steel" },
    "syntaxKeyword": { "dark": "signal", "light": "signal" },
    "syntaxFunction": { "dark": "honey", "light": "amber" },
    "syntaxVariable": { "dark": "ivory", "light": "#4A3D2D" },
    "syntaxString": { "dark": "chlorophyll", "light": "#2F7D4A" },
    "syntaxNumber": { "dark": "honey", "light": "violet" },
    "syntaxType": { "dark": "amber", "light": "signal" },
    "syntaxOperator": { "dark": "steel", "light": "#6A6359" },
    "syntaxPunctuation": { "dark": "fog", "light": "#7B7368" },
    "thinkingOpacity": 0.9
  }
}
|

  @spec build(Cell.t()) :: {:ok, SessionSpec.t()} | {:error, term()}
  def build(%Cell{} = cell) do
    with {:ok, payload} <- AgentSessionRead.payload_for_cell(cell.id),
         session_id <- (payload && Map.get(payload, :id)) || cell.opencode_session_id,
         true <- is_binary(session_id) and byte_size(String.trim(session_id)) > 0 do
      preferred_model =
        to_model_value(Map.get(payload, :modelProviderId), Map.get(payload, :modelId))

      start_mode =
        normalize_start_mode(Map.get(payload, :currentMode) || Map.get(payload, :startMode))

      merged_config =
        create_merged_inline_config(cell.workspace_path, preferred_model, start_mode)

      theme_mode = @default_theme_mode

      env =
        create_theme_env(cell.workspace_path, theme_mode, merged_config.config)
        |> Map.put("TERM", @terminal_name)
        |> Map.put("COLORTERM", System.get_env("COLORTERM") || "truecolor")

      command_line =
        shell_join([
          resolve_opencode_binary(),
          "attach",
          ServerManager.resolved_base_url(),
          "--dir",
          cell.workspace_path,
          "--session",
          session_id
        ])

      script =
        [
          "cd #{shell_escape(cell.workspace_path)}",
          export_lines(env),
          "exec #{command_line}"
        ]
        |> Enum.reject(&(&1 == ""))
        |> Enum.join(" && ")

      fingerprint =
        [
          cell.workspace_path,
          session_id,
          ServerManager.resolved_base_url(),
          preferred_model || "",
          start_mode || "",
          theme_mode
        ]
        |> Enum.join("|")

      {:ok,
       %SessionSpec{
         scope: {:chat, cell.id},
         kind: :chat,
         command: @shell,
         args: ["-lc", script],
         cwd: cell.workspace_path,
         buffer_kind: :chat,
         fingerprint: fingerprint,
         allow_control_input: merged_config.allow_embedded_control_input,
         plan_mode: start_mode == "plan",
         session_prefix: "chat_terminal"
       }}
    else
      _other -> {:error, :chat_session_unavailable}
    end
  end

  @spec shell_escape(String.t()) :: String.t()
  def shell_escape(value) when is_binary(value) do
    "'" <> String.replace(value, "'", "'\\''") <> "'"
  end

  @spec shell_join([String.t()]) :: String.t()
  def shell_join(parts) when is_list(parts) do
    parts
    |> Enum.map(&shell_escape/1)
    |> Enum.join(" ")
  end

  defp resolve_opencode_binary do
    case System.get_env("HIVE_OPENCODE_BIN") do
      nil ->
        "opencode"

      value ->
        trimmed = String.trim(value)
        if trimmed == "", do: "opencode", else: trimmed
    end
  end

  defp normalize_start_mode("plan"), do: "plan"
  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode(_value), do: nil

  defp to_model_value(nil, nil), do: nil
  defp to_model_value(nil, model_id) when is_binary(model_id), do: model_id

  defp to_model_value(provider_id, model_id)
       when is_binary(provider_id) and is_binary(model_id) and model_id != "" do
    if String.contains?(model_id, "/") do
      model_id
    else
      provider_id <> "/" <> model_id
    end
  end

  defp to_model_value(_provider_id, _model_id), do: nil

  defp create_merged_inline_config(workspace_path, preferred_model, start_mode) do
    inline_config = parse_inline_config(System.get_env("OPENCODE_CONFIG_CONTENT"))
    workspace_config = read_workspace_config(workspace_path)
    workspace_keybinds = normalize_keybinds(Map.get(workspace_config, "keybinds"))
    inline_keybinds = normalize_keybinds(Map.get(inline_config, "keybinds"))
    keybinds = merge_browser_safe_keybinds(workspace_keybinds, inline_keybinds)

    config =
      inline_config
      |> Map.put("plugin", [])
      |> maybe_put("model", preferred_model)
      |> maybe_put("default_agent", start_mode)
      |> Map.put("keybinds", keybinds)
      |> Map.put("theme", @hive_theme_name)

    %{config: config, allow_embedded_control_input: allows_embedded_control_input?(keybinds)}
  end

  defp parse_inline_config(nil), do: %{}

  defp parse_inline_config(content) when is_binary(content) do
    case Jason.decode(content) do
      {:ok, decoded} when is_map(decoded) -> decoded
      _other -> %{}
    end
  end

  defp read_workspace_config(workspace_path) do
    Enum.find_value(@workspace_config_candidates, %{}, fn candidate ->
      config_path = Path.join(workspace_path, candidate)

      with {:ok, contents} <- File.read(config_path),
           {:ok, decoded} when is_map(decoded) <- Jason.decode(contents) do
        decoded
      else
        _other -> nil
      end
    end)
  end

  defp normalize_keybinds(candidate) when is_map(candidate) do
    candidate
    |> Enum.reduce(%{}, fn {key, value}, acc ->
      value = if(is_binary(value), do: String.trim(value), else: "")
      if value == "", do: acc, else: Map.put(acc, to_string(key), value)
    end)
  end

  defp normalize_keybinds(_candidate), do: %{}

  defp merge_browser_safe_keybinds(workspace_keybinds, inline_keybinds) do
    [workspace_keybinds, inline_keybinds]
    |> Enum.reduce(@hive_embedded_browser_safe_keybinds, fn source, acc ->
      Enum.reduce(source, acc, fn {key, value}, merged ->
        case Map.fetch(@hive_embedded_browser_safe_keybinds, key) do
          {:ok, aliases} ->
            if MapSet.member?(@source_override_only_keybinds, key) do
              Map.put(merged, key, value)
            else
              Map.put(merged, key, merge_keybind_combos(value, aliases))
            end

          _other ->
            Map.put(merged, key, value)
        end
      end)
    end)
  end

  defp merge_keybind_combos(primary, aliases) do
    primary_combos = split_keybind_combos(primary)

    if Enum.any?(primary_combos, &(String.downcase(&1) == "none")) do
      "none"
    else
      {merged, _seen} =
        Enum.reduce(primary_combos ++ split_keybind_combos(aliases), {[], MapSet.new()}, fn combo,
                                                                                            {values,
                                                                                             seen} ->
          normalized = String.downcase(combo)

          if MapSet.member?(seen, normalized) do
            {values, seen}
          else
            {values ++ [combo], MapSet.put(seen, normalized)}
          end
        end)

      Enum.join(merged, ",")
    end
  end

  defp split_keybind_combos(value) do
    value
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp allows_embedded_control_input?(keybinds) do
    Enum.any?(Map.values(keybinds), fn keybind ->
      Enum.any?(split_keybind_combos(keybind), fn combo ->
        MapSet.member?(@embedded_control_keybinds, String.downcase(combo))
      end)
    end)
  end

  defp create_theme_env(workspace_path, theme_mode, merged_inline_config) do
    config_root = Path.join(workspace_path, ".opencode")
    theme_dir = Path.join(config_root, "themes")
    theme_path = Path.join(theme_dir, @hive_theme_name <> ".json")
    state_home = Path.join(config_root, "state")
    state_dir = Path.join(state_home, "opencode")
    kv_path = Path.join(state_dir, "kv.json")
    config_home = Path.join(config_root, "config")
    home_dir = Path.join(config_root, "home")

    env = %{
      "OPENCODE_CONFIG_CONTENT" => Jason.encode!(merged_inline_config),
      "OPENCODE_EXPERIMENTAL_PLAN_MODE" => "1"
    }

    case ensure_theme_files(
           theme_dir,
           theme_path,
           state_dir,
           kv_path,
           config_home,
           home_dir,
           theme_mode
         ) do
      {:ok, _result} ->
        env
        |> Map.put("XDG_STATE_HOME", state_home)
        |> Map.put("XDG_CONFIG_HOME", config_home)
        |> Map.put("HOME", home_dir)

      {:error, _reason} ->
        env
    end
  end

  defp ensure_theme_files(
         theme_dir,
         theme_path,
         state_dir,
         kv_path,
         config_home,
         home_dir,
         theme_mode
       ) do
    with :ok <- File.mkdir_p(theme_dir),
         :ok <- File.mkdir_p(state_dir),
         :ok <- File.mkdir_p(config_home),
         :ok <- File.mkdir_p(home_dir),
         :ok <- maybe_write(theme_path, @hive_theme_content),
         :ok <- maybe_write_kv(kv_path, theme_mode) do
      {:ok, :written}
    end
  end

  defp maybe_write(path, desired) do
    case File.read(path) do
      {:ok, ^desired} -> :ok
      _other -> File.write(path, desired)
    end
  end

  defp maybe_write_kv(path, theme_mode) do
    current =
      case File.read(path) do
        {:ok, contents} ->
          case Jason.decode(contents) do
            {:ok, decoded} when is_map(decoded) -> decoded
            _other -> %{}
          end

        _other ->
          %{}
      end

    desired =
      current
      |> Map.put("theme", @hive_theme_name)
      |> Map.put("theme_mode", theme_mode)

    encoded = Jason.encode_to_iodata!(desired, pretty: true)
    File.write(path, encoded)
  end

  defp export_lines(env) do
    env
    |> Enum.map(fn {key, value} -> "export #{key}=#{shell_escape(to_string(value))}" end)
    |> Enum.join(" && ")
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
