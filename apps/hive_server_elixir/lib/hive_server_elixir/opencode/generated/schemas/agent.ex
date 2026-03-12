defmodule HiveServerElixir.Opencode.Generated.Agent do
  @moduledoc """
  Provides struct and type for a Agent
  """

  @type t :: %__MODULE__{
          color: String.t() | nil,
          description: String.t() | nil,
          hidden: boolean | nil,
          mode: String.t(),
          model: HiveServerElixir.Opencode.Generated.AgentModel.t() | nil,
          name: String.t(),
          native: boolean | nil,
          options: map,
          permission: [HiveServerElixir.Opencode.Generated.PermissionRule.t()],
          prompt: String.t() | nil,
          steps: integer | nil,
          temperature: number | nil,
          topP: number | nil,
          variant: String.t() | nil
        }

  defstruct [
    :color,
    :description,
    :hidden,
    :mode,
    :model,
    :name,
    :native,
    :options,
    :permission,
    :prompt,
    :steps,
    :temperature,
    :topP,
    :variant
  ]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      color: :string,
      description: :string,
      hidden: :boolean,
      mode: {:enum, ["subagent", "primary", "all"]},
      model: {HiveServerElixir.Opencode.Generated.AgentModel, :t},
      name: :string,
      native: :boolean,
      options: :map,
      permission: [{HiveServerElixir.Opencode.Generated.PermissionRule, :t}],
      prompt: :string,
      steps: :integer,
      temperature: :number,
      topP: :number,
      variant: :string
    ]
  end
end
