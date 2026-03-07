defmodule HiveServerElixir.Cells.Diff do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell

  @workspace_ref "HEAD"
  @patch_context_arg "--unified=200"
  @untracked_args ["ls-files", "--others", "--exclude-standard"]

  @spec build_payload(Cell.t(), map()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def build_payload(%Cell{} = cell, params) do
    with :ok <- validate_diff_ready(cell),
         {:ok, request} <- parse_request(cell, params),
         {:ok, payload} <- build_response(cell, request) do
      {:ok, payload}
    end
  end

  defp validate_diff_ready(%Cell{status: status})
       when status in ["spawning", "pending", "deleting"] do
    {:error, {:conflict, "Cell workspace is not ready yet"}}
  end

  defp validate_diff_ready(%Cell{workspace_path: workspace_path})
       when not is_binary(workspace_path) or workspace_path == "" do
    {:error, {:conflict, "Cell workspace path is not available yet"}}
  end

  defp validate_diff_ready(%Cell{}), do: :ok

  defp parse_request(%Cell{} = cell, params) do
    mode = parse_mode(Map.get(params, "mode"))
    include_summary = Map.get(params, "summary") != "none"
    files = parse_files(Map.get(params, "files"))

    if mode == "branch" and blank?(cell.base_commit) do
      {:error, {:bad_request, "Cell is missing base commit metadata"}}
    else
      {:ok, %{mode: mode, files: files, include_summary: include_summary}}
    end
  end

  defp build_response(cell, %{mode: mode, files: files, include_summary: include_summary}) do
    workspace_path = cell.workspace_path

    with requested_base_commit <- if(mode == "branch", do: cell.base_commit, else: nil),
         {:ok, summary} <-
           maybe_build_summary(workspace_path, mode, requested_base_commit, include_summary),
         resolved_base_commit <- resolve_base_commit(summary, requested_base_commit),
         {:ok, details} <-
           maybe_build_details(workspace_path, mode, resolved_base_commit, files, summary) do
      {:ok,
       %{
         mode: mode,
         baseCommit: (summary && summary.base_commit) || resolved_base_commit,
         headCommit: (summary && summary.head_commit) || nil,
         files: (summary && summary.files) || [],
         details: details
       }
       |> maybe_drop_nil(:details)}
    else
      {:error, :head_missing} -> {:error, {:conflict, "Cell workspace is not ready yet"}}
      {:error, {:git_failed, message}} -> {:error, {:unprocessable_entity, message}}
      {:error, {:invalid_diff_request, message}} -> {:error, {:bad_request, message}}
    end
  end

  defp maybe_build_summary(_workspace_path, _mode, _base_commit, false), do: {:ok, nil}

  defp maybe_build_summary(workspace_path, mode, base_commit, true) do
    with {:ok, files} <- build_file_summaries(workspace_path, mode, base_commit),
         {:ok, head_commit} <- resolve_head_commit(workspace_path) do
      resolved_base = if mode == "workspace", do: head_commit, else: base_commit

      {:ok,
       %{
         mode: mode,
         base_commit: resolved_base,
         head_commit: head_commit,
         files: files
       }}
    end
  end

  defp maybe_build_details(_workspace_path, _mode, _base_commit, [], _summary), do: {:ok, nil}

  defp maybe_build_details(workspace_path, mode, base_commit, files, summary) do
    summary_by_path =
      case summary do
        nil -> %{}
        %{files: summary_files} -> Map.new(summary_files, fn file -> {file.path, file} end)
      end

    range_args = build_range_args(mode, base_commit)

    files
    |> Enum.uniq()
    |> Enum.reduce_while({:ok, []}, fn path, {:ok, acc} ->
      summary_item = Map.get(summary_by_path, path)

      with {:ok, resolved_summary} <-
             maybe_resolve_summary(workspace_path, mode, base_commit, path, summary_item),
           {:ok, detail} <-
             build_file_detail(workspace_path, range_args, mode, base_commit, resolved_summary) do
        {:cont, {:ok, [detail | acc]}}
      else
        {:ok, nil} -> {:cont, {:ok, acc}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, details} -> {:ok, Enum.reverse(details)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_resolve_summary(_workspace_path, _mode, _base_commit, _path, summary)
       when is_map(summary),
       do: {:ok, summary}

  defp maybe_resolve_summary(workspace_path, mode, base_commit, path, nil) do
    compute_single_file_summary(workspace_path, mode, base_commit, path)
  end

  defp compute_single_file_summary(workspace_path, mode, base_commit, path) do
    range_args = build_range_args(mode, base_commit)

    with {:ok, numstat_out} <-
           run_git(["diff", "--numstat" | range_args] ++ ["--", path], workspace_path),
         {:ok, status_out} <-
           run_git(["diff", "--name-status" | range_args] ++ ["--", path], workspace_path) do
      stats_map = parse_numstat(numstat_out)
      status_map = parse_name_status(status_out)
      stats = Map.get(stats_map, path)
      status = Map.get(status_map, path)

      cond do
        is_map(stats) or is_binary(status) ->
          {:ok,
           %{
             path: path,
             status: status || "modified",
             additions: (stats && stats.additions) || 0,
             deletions: (stats && stats.deletions) || 0
           }}

        true ->
          case untracked_file?(workspace_path, path) do
            {:ok, true} ->
              additions =
                workspace_path
                |> Path.join(path)
                |> read_file()
                |> count_lines()

              {:ok, %{path: path, status: "added", additions: additions, deletions: 0}}

            {:ok, false} ->
              {:ok, nil}

            {:error, reason} ->
              {:error, reason}
          end
      end
    end
  end

  defp build_file_detail(_workspace_path, _range_args, _mode, _base_commit, nil), do: {:ok, nil}

  defp build_file_detail(workspace_path, range_args, mode, base_commit, summary) do
    patch_args = ["diff", @patch_context_arg | range_args] ++ ["--", summary.path]

    patch =
      case run_git(patch_args, workspace_path) do
        {:ok, out} -> out
        {:error, _reason} -> ""
      end

    before_ref = if mode == "workspace", do: @workspace_ref, else: base_commit

    before_content = read_git_file(workspace_path, before_ref, summary.path)
    after_content = read_file(Path.join(workspace_path, summary.path))

    resolved_before = if summary.status == "added", do: "", else: before_content || ""
    resolved_after = if summary.status == "deleted", do: "", else: after_content || ""

    {:ok,
     %{
       path: summary.path,
       status: summary.status,
       additions: summary.additions,
       deletions: summary.deletions,
       beforeContent: resolved_before,
       afterContent: resolved_after,
       patch: patch
     }}
  end

  defp build_file_summaries(workspace_path, mode, base_commit) do
    range_args = build_range_args(mode, base_commit)

    with {:ok, numstat_out} <-
           run_git(["diff", "--numstat" | range_args] ++ ["--"], workspace_path),
         {:ok, status_out} <-
           run_git(["diff", "--name-status" | range_args] ++ ["--"], workspace_path),
         {:ok, untracked_out} <- run_git(@untracked_args, workspace_path) do
      stats_map = parse_numstat(numstat_out)
      status_map = parse_name_status(status_out)
      files = parse_lines(untracked_out)

      {stats_map, status_map} =
        include_untracked_files(workspace_path, files, stats_map, status_map)

      all_paths = Map.keys(stats_map) ++ Map.keys(status_map)

      payload =
        all_paths
        |> Enum.uniq()
        |> Enum.sort()
        |> Enum.map(fn path ->
          stats = Map.get(stats_map, path)
          status = Map.get(status_map, path, "modified")

          %{
            path: path,
            status: status,
            additions: (stats && stats.additions) || 0,
            deletions: (stats && stats.deletions) || 0
          }
        end)

      {:ok, payload}
    end
  end

  defp include_untracked_files(workspace_path, files, stats_map, status_map) do
    Enum.reduce(files, {stats_map, status_map}, fn file_path, {acc_stats, acc_status} ->
      next_status = Map.put_new(acc_status, file_path, "added")

      next_stats =
        if Map.has_key?(acc_stats, file_path) do
          acc_stats
        else
          additions =
            workspace_path
            |> Path.join(file_path)
            |> read_file()
            |> count_lines()

          Map.put(acc_stats, file_path, %{additions: additions, deletions: 0})
        end

      {next_stats, next_status}
    end)
  end

  defp parse_numstat(output) do
    output
    |> parse_lines()
    |> Enum.reduce(%{}, fn line, acc ->
      case String.split(line, "\t") do
        [raw_additions, raw_deletions | raw_path_parts] ->
          path =
            raw_path_parts
            |> Enum.join("\t")
            |> normalize_numstat_path()

          Map.put(acc, path, %{
            additions: parse_count(raw_additions),
            deletions: parse_count(raw_deletions)
          })

        _other ->
          acc
      end
    end)
  end

  defp normalize_numstat_path(path) do
    case String.split(path, " => ", parts: 2) do
      [_source, target] when is_binary(target) and target != "" -> target
      _other -> path
    end
  end

  defp parse_name_status(output) do
    output
    |> parse_lines()
    |> Enum.reduce(%{}, fn line, acc ->
      parts = String.split(line, "\t", trim: true)

      case parts do
        [code | rest] when rest != [] ->
          path = List.last(rest)

          if is_binary(path) and path != "" do
            Map.put(acc, path, map_git_status(code))
          else
            acc
          end

        _other ->
          acc
      end
    end)
  end

  defp map_git_status(code) do
    case String.upcase(String.slice(code || "", 0, 1)) do
      "A" -> "added"
      "D" -> "deleted"
      _other -> "modified"
    end
  end

  defp parse_mode("branch"), do: "branch"
  defp parse_mode(_mode), do: "workspace"

  defp parse_files(nil), do: []

  defp parse_files(value) when is_binary(value) do
    value
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp parse_files(_value), do: []

  defp parse_count("-"), do: 0

  defp parse_count(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> parsed
      _other -> 0
    end
  end

  defp parse_count(_value), do: 0

  defp parse_lines(output) when is_binary(output) do
    output
    |> String.split("\n")
    |> Enum.map(&String.trim_trailing/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp run_git(args, cwd) do
    case System.cmd("git", args, cd: cwd, stderr_to_stdout: true) do
      {stdout, 0} -> {:ok, String.trim_trailing(stdout)}
      {error, _code} -> {:error, {:git_failed, String.trim(error)}}
    end
  rescue
    ErlangError -> {:error, {:git_failed, "Failed to execute git command"}}
  end

  defp resolve_head_commit(workspace_path) do
    case run_git(["rev-parse", "HEAD"], workspace_path) do
      {:ok, ""} -> {:error, :head_missing}
      {:ok, head_commit} -> {:ok, head_commit}
      {:error, reason} -> {:error, reason}
    end
  end

  defp resolve_base_commit(nil, requested), do: requested
  defp resolve_base_commit(summary, _requested), do: summary.base_commit

  defp build_range_args("workspace", _base_commit), do: [@workspace_ref]

  defp build_range_args("branch", base_commit) when is_binary(base_commit) and base_commit != "",
    do: [base_commit]

  defp build_range_args("branch", _base_commit), do: raise("Base commit is required")

  defp untracked_file?(workspace_path, path) do
    case run_git(@untracked_args ++ ["--", path], workspace_path) do
      {:ok, out} -> {:ok, out != ""}
      {:error, reason} -> {:error, reason}
    end
  end

  defp read_git_file(_workspace_path, nil, _path), do: nil

  defp read_git_file(workspace_path, ref, path) do
    case run_git(["show", "#{ref}:#{path}"], workspace_path) do
      {:ok, content} -> content
      {:error, _reason} -> nil
    end
  end

  defp read_file(path) do
    case File.read(path) do
      {:ok, content} -> content
      {:error, _reason} -> nil
    end
  end

  defp count_lines(nil), do: 0
  defp count_lines(content), do: length(String.split(content, "\n"))

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  defp maybe_drop_nil(map, key) do
    case Map.get(map, key) do
      nil -> Map.delete(map, key)
      _value -> map
    end
  end
end
