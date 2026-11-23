import type { Declaration, Inspection, SourceRule } from "./types";

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

export const ruleCSS = (rule: SourceRule) =>
  `/* ${rule.origin}${rule.active === false ? " · inactive at capture" : ""} */\n${rule.context.join(" → ")}${rule.context.length ? "\n" : ""}${rule.selector} {\n${cssDeclarations(rule.declarations)}\n}`;

export function availableCSS(data: Inspection): string {
  return [
    `/* Inline declarations */\nelement.style {\n${cssDeclarations(data.inline)}\n}`,
    "/* Matching source CSS: applied / overridden only where determinable; unknown otherwise. */",
    ...data.rules.map(ruleCSS),
    ...data.inherited.flatMap((ancestor) => [`/* Inherited candidates from ${ancestor.element}; not proof of inheritance */`,
      ...(ancestor.inline.length ? [`element.style {\n${cssDeclarations(ancestor.inline)}\n}`] : []), ...ancestor.rules.map(ruleCSS)]),
    "/* Inactive conditional rules */", ...(data.inactiveRules || []).map(ruleCSS),
    "/* State and pseudo-element definitions; active labels refer to capture time */", ...(data.stateRules || []).map(ruleCSS),
    "/* Computed CSS — final browser values, not source declarations */", computedCSS(data),
    ...(data.variables?.length ? [`/* CSS variable computed values and accessible declarations */\n${JSON.stringify(data.variables, null, 2)}`] : []),
    ...(data.pseudos || []).map((pseudo) => `/* ${pseudo.selector} computed values */\n${JSON.stringify(pseudo.computed, null, 2)}`),
    ...data.inaccessible.map((origin) => `/* Source unavailable: ${origin} */`), ...data.notes.map((note) => `/* ${note} */`),
  ].join("\n\n");
}

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
    `## HTML${data.htmlTruncated ? " (truncated: bounded capture)" : ""}\n\`\`\`html\n${data.html}\n\`\`\``,
    `## Layout (viewport bounds; transforms included)\n${JSON.stringify(data.rect, null, 2)}`,
    `## Computed CSS — final browser values\n\`\`\`css\n${computedCSS(data)}\n\`\`\``,
    ...(data.variables?.length ? [`## CSS variables — captured computed values and accessible sources\n${JSON.stringify(data.variables, null, 2)}`] : []),
    `## Inline declarations\n\`\`\`css\n${cssDeclarations(data.inline) || "/* none */"}\n\`\`\``,
    `## Matching source CSS\nStatus labels describe accessible author declarations only; unknown means the cascade could not be resolved.\n\`\`\`css\n${source || "/* no accessible direct matches */"}\n\`\`\``,
    `## Inherited source candidates\n${data.inherited.map((ancestor) => [
      `From: ${ancestor.element}`,
      ancestor.inline.length ? `element.style {\n${cssDeclarations(ancestor.inline)}\n}` : "",
      ...ancestor.rules.map((rule) => `/* ${rule.origin} ${rule.context.join(" → ")} */\n${rule.selector} {\n${cssDeclarations(rule.declarations)}\n}`),
    ].filter(Boolean).join("\n")).join("\n\n") || "(none accessible)"}`,
    `## DOM path\n${data.breadcrumb.map((item) => item.label).join(" > ")}`,
    `## Source limitations\n${[...data.inaccessible.map((origin) => `Unreadable stylesheet (browser access restriction): ${origin}`), ...data.notes].join("\n") || "No additional source restrictions detected."}`,
    `## States & pseudo-elements\n${(data.stateRules || []).map(ruleCSS).join("\n\n") || "No accessible state rules captured."}\n${JSON.stringify({ states: data.states, pseudos: data.pseudos }, null, 2)}`,
    `## Inactive conditional CSS\n${(data.inactiveRules || []).map(ruleCSS).join("\n\n") || "(none accessible)"}`,
    ...(data.images?.length ? [`## Images\n${JSON.stringify(data.images, null, 2)}`] : []),
    ...(data.icons?.length ? [`## Icons\n${JSON.stringify(data.icons, null, 2)}`] : []),
    ...(data.tree ? [`## Captured hierarchy\n${JSON.stringify(data.tree, null, 2)}`] : []),
    "Form values, editable content, sensitive attributes, URL parameters and recognized secrets are redacted. Redaction is heuristic; review before sharing. This is a snapshot; refresh to capture later changes. Clipboard only.",
  ].join("\n\n");
}
