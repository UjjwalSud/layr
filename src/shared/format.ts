import type { Declaration, Inspection } from "./types";

export const cssDeclarations = (items: Declaration[]) =>
  items
    .map(
      (item) =>
        `  ${item.property}: ${item.value}${item.important ? " !important" : ""};`,
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
    `## Attributes\n${data.attributes.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") || "(none)"}`,
    `## HTML${data.htmlTruncated ? " (truncated at 60,000 characters)" : ""}\n\`\`\`html\n${data.html}\n\`\`\``,
    `## Layout (viewport bounds; transforms included)\n${JSON.stringify(data.rect, null, 2)}`,
    `## Computed CSS — final browser values\n\`\`\`css\n${computedCSS(data)}\n\`\`\``,
    `## Inline declarations\n\`\`\`css\n${cssDeclarations(data.inline) || "/* none */"}\n\`\`\``,
    `## Matching declared CSS — direct matches, not cascade winners\nInherited ancestor rules, pseudo-elements, and browser defaults are not listed.\n\`\`\`css\n${source || "/* no accessible direct matches */"}\n\`\`\``,
    `## Source limitations\n${[...data.inaccessible.map((origin) => `Unreadable stylesheet (browser access restriction): ${origin}`), ...data.notes].join("\n") || "No additional source restrictions detected."}`,
    "Password input values are redacted. This is a snapshot; refresh to capture later changes.",
  ].join("\n\n");
}
