import type { ArrayFieldTemplateProps } from "@rjsf/utils";
import { ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HiveArrayTemplate(props: ArrayFieldTemplateProps) {
  const { canAdd, disabled, idSchema, items, onAddClick, readonly, title } =
    props;

  const collapsedOption = (
    props.uiSchema?.["ui:options"] as { collapsed?: boolean } | undefined
  )?.collapsed;
  const [collapsed, setCollapsed] = useState(
    collapsedOption !== undefined ? collapsedOption : items.length === 0
  );

  const handleAdd = () => onAddClick({});
  const handleToggle = () => setCollapsed((prev) => !prev);

  return (
    <div className="hive-array space-y-3" id={idSchema.$id}>
      <div className="hive-array-heading">
        <button
          aria-expanded={!collapsed}
          className="hive-array-toggle"
          onClick={handleToggle}
          type="button"
        >
          <ChevronDown
            className={cn(
              "chevron h-5 w-5 shrink-0 text-[#f5a524] transition-transform",
              collapsed && "-rotate-90"
            )}
          />
          <span className="flex-1 text-[0.75rem] text-muted-foreground uppercase tracking-[0.22em]">
            {title || "Items"}
          </span>
        </button>
        {canAdd && !disabled && !readonly ? (
          <Button
            className="border-primary text-primary hover:bg-primary/10"
            onClick={handleAdd}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              className={cn(
                "hive-array-card",
                "flex flex-col gap-2 rounded-none border border-border/60 bg-card/20 px-3 py-3"
              )}
              key={item.key}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">{item.children}</div>
                {item.hasRemove && (
                  <Button
                    aria-label="Remove item"
                    className="border-destructive text-destructive hover:bg-destructive/10"
                    disabled={disabled || readonly}
                    onClick={item.onDropIndexClick(item.index)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
