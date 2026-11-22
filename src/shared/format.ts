import type { Declaration, Inspection } from "./types";

export const cssDeclarations = (items: Declaration[]) =>
  items
    .map(
      (item) =>
        `  ${item.property}: ${item.value}${item.important ? " !important" : ""};${item.status ? ` /* ${item.status} */` : ""}`,
    )
    .join("\n");
export const computedCSS = (data: Inspection) =>
  `${data.selector} {\n${Object.entries(data.computed)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n")}\n}`;

export function inspectionText(data: Inspection): string {
  const source = data.rules
    .map(
      (rule) =>
        `${rule.context.join(" → ")}${rule.context.length ? "\n" : ""}/* ${rule.origin} */\n${rule.selector} {\n${cssDeclarations(rule.declarations)}\n}`,
    )
    .join("\n\n");
  return [
    "# Layr inspection",
    `Captured: ${data.capturedAt}\nSelector: ${data.selector}\nScope: ${data.scope}\nTag: ${data.tag}\nID: ${data.id || "(none)"}\nClasses: ${data.classes.join(" ") || "(none)"}`,
    `## Element text\n${data.text || "(empty)"}`,
    ...(data.hoverState ? [`## Captured interaction state\n${JSON.stringify(data.hoverState, null, 2)}`] : []),
    `## Attributes\n${data.attributes.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") || "(none)"}`,
    `## HTML${data.htmlTruncated ? " (truncated at 60,000 characters)" : ""}\n\`\`\`html\n${data.html}\n\`\`\``,
    `## Layout (viewport bounds; transforms included)\n${JSON.stringify(data.rect, null, 2)}`,
    `## Computed CSS — final browser values\n\`\`\`css\n${computedCSS(data)}\n\`\`\``,
    `## Inline declarations\n\`\`\`css\n${cssDeclarations(data.inline) || "/* none */"}\n\`\`\``,
    `## Matching source CSS\nStatus labels describe accessible author declarations only; unknown means the cascade could not be resolved.\n\`\`\`css\n${source || "/* no accessible direct matches */"}\n\`\`\``,
    `## Inherited source candidates\n${data.inherited.map((ancestor) => [
      `From: ${ancestor.element}`,
      ancestor.inline.length ? `element.style {\n${cssDeclarations(ancestor.inline)}\n}` : "",
      ...ancestor.rules.map((rule) => `/* ${rule.origin} ${rule.context.join(" → ")} */\n${rule.selector} {\n${cssDeclarations(rule.declarations)}\n}`),
    ].filter(Boolean).join("\n")).join("\n\n") || "(none accessible)"}`,
    `## DOM path\n${data.breadcrumb.map((item) => item.label).join(" > ")}`,
    `## Source limitations\n${[...data.inaccessible.map((origin) => `Unreadable stylesheet (browser access restriction): ${origin}`), ...data.notes].join("\n") || "No additional source restrictions detected."}`,
    "Form values, editable content, sensitive attributes, URL parameters and recognized secrets are redacted. Redaction is heuristic; review before sharing. This is a snapshot; refresh to capture later changes. Copying does not contact an AI service.",
  ].join("\n\n");
}
