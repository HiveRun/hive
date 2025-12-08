import { ChevronDown, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HiveObjectTemplateProps = {
  properties: Array<{ content: ReactNode; name?: string; key?: string }>;
  description?: ReactNode;
  title?: string;
  disabled?: boolean;
  readonly?: boolean;
  uiSchema?: Record<string, unknown>;
  schema?: unknown;
  formData?: unknown;
  canExpand?: (
    schema: unknown,
    uiSchema: unknown,
    formData: unknown
  ) => boolean;
  onAddClick?: (
    schema?: unknown,
    uiSchema?: unknown,
    formData?: unknown
  ) => void;
};

export function HiveObjectTemplate(props: HiveObjectTemplateProps) {
  const {
    properties,
    description,
    title,
    disabled,
    readonly,
    uiSchema,
    schema,
    formData,
    canExpand,
    onAddClick,
  } = props;

  const uiOptions =
    (uiSchema?.["ui:options"] as
      | { collapsed?: boolean; addButtonText?: string }
      | undefined) ?? {};
  const initialCollapsed = uiOptions.collapsed ?? false;
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const canShowAdd =
    typeof canExpand === "function"
      ? canExpand(schema, uiSchema, formData)
      : false;
  const showAdd = canShowAdd && !(disabled || readonly);
  const addLabel = uiOptions.addButtonText;
  const handleAdd = () => onAddClick?.(schema, uiSchema, formData);

  return (
    <div className="hive-object space-y-3">
      <div className="hive-array-heading">
        <button
          aria-expanded={!collapsed}
          className="hive-array-toggle"
          onClick={() => setCollapsed((prev) => !prev)}
          type="button"
        >
          <ChevronDown
            className={cn(
              "chevron h-5 w-5 shrink-0 text-[#f5a524] transition-transform",
              collapsed && "-rotate-90"
            )}
          />
          <span className="flex-1 text-[0.75rem] text-muted-foreground uppercase tracking-[0.22em]">
            {title || "Section"}
          </span>
        </button>
        {showAdd ? (
          <Button
            className="border-primary text-primary hover:bg-primary/10"
            onClick={handleAdd}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="h-4 w-4" /> {addLabel ?? "Add property"}
          </Button>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="space-y-3">
          {description}
          {properties.map((element) => (
            <div key={element.key ?? element.name}>{element.content}</div>
          ))}
        </div>
      )}
    </div>
  );
}
