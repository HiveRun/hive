import type { FieldTemplateProps } from "@rjsf/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const isComplexSchema = (schema: FieldTemplateProps["schema"]) => {
  const schemaType = schema.type;
  if (Array.isArray(schemaType)) {
    return schemaType.includes("object") || schemaType.includes("array");
  }
  return schemaType === "object" || schemaType === "array";
};

const normalizeHeading = (
  label: FieldTemplateProps["label"],
  uiSchema: FieldTemplateProps["uiSchema"],
  schema: FieldTemplateProps["schema"],
  id: FieldTemplateProps["id"]
) => {
  const explicitTitle =
    label ||
    (uiSchema?.["ui:title"] as string | undefined) ||
    (schema.title as string | undefined);
  if (explicitTitle && explicitTitle.trim().length > 0) {
    return explicitTitle;
  }
  const tail = (id ?? "").split("_").pop() ?? "";
  if (!tail || tail === "root") {
    return;
  }
  return tail.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: composed field template requires multiple branches */
export function HiveFieldTemplate(props: FieldTemplateProps) {
  const {
    id,
    classNames,
    label,
    required,
    description,
    errors,
    help,
    hidden,
    children,
    // displayLabel intentionally ignored; legend visibility derives from heading/collapsible
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    displayLabel: _displayLabel,
    schema,
    uiSchema,
  } = props;

  const heading = normalizeHeading(label, uiSchema, schema, id);
  const legendTitle = heading?.trim();
  const collapsible = isComplexSchema(schema);
  const collapsedOption = (
    uiSchema?.["ui:options"] as { collapsed?: boolean } | undefined
  )?.collapsed;
  const [collapsed, setCollapsed] = useState(
    collapsible ? (collapsedOption ?? false) : false
  );

  if (hidden) {
    return <div className="hidden">{children}</div>;
  }

  if (id === "root") {
    return (
      <div className="hive-field-body">
        {description}
        <div>{children}</div>
        {errors}
        {help}
      </div>
    );
  }

  if (!(legendTitle || collapsible)) {
    return (
      <div className="space-y-2">
        {description}
        <div>{children}</div>
        {errors}
        {help}
      </div>
    );
  }

  const shouldRenderLegend = Boolean(legendTitle) || collapsible;
  const handleToggle = () => setCollapsed((prev) => !prev);

  return (
    <fieldset
      className={cn(classNames, "hive-fieldset", collapsed && "is-collapsed")}
      data-collapsed={collapsed}
      data-collapsible={collapsible}
      id={id}
      style={{ position: "relative" }}
    >
      {shouldRenderLegend ? (
        <legend>
          <button
            aria-expanded={!collapsed}
            aria-label={
              collapsible
                ? `${legendTitle ?? ""} section toggle`
                : (legendTitle ?? "")
            }
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-none px-3 py-2 text-left text-foreground",
              collapsible ? "cursor-pointer" : "cursor-default"
            )}
            data-collapsed={collapsed}
            data-collapsible={collapsible}
            onClick={handleToggle}
            type="button"
          >
            <span className="flex items-center gap-3 text-[0.72rem] uppercase tracking-[0.24em]">
              <ChevronDown
                className={cn(
                  "chevron h-5 w-5 shrink-0 text-[#f5a524] transition-transform",
                  collapsed && "-rotate-90 opacity-85"
                )}
              />
              {legendTitle ? (
                <span>
                  {legendTitle}
                  {required ? " *" : null}
                </span>
              ) : null}
            </span>
          </button>
        </legend>
      ) : null}

      <div className="hive-field-body" data-collapsed={collapsed}>
        {description}
        <div>{children}</div>
        {errors}
        {help}
      </div>
    </fieldset>
  );
}
