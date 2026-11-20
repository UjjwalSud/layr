import type { Declaration, Inspection, SourceRule } from "../shared/types";

export function declarations(style: CSSStyleDeclaration): Declaration[] {
  return Array.from(style, (property) => ({
    property,
    value: style.getPropertyValue(property).trim(),
    important: style.getPropertyPriority(property) === "important",
  }));
}

function uniqueSelector(element: Element): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    if (current.id) {
      const id = `#${CSS.escape(current.id)}`;
      if (root.querySelectorAll(id).length === 1) {
        parts.unshift(id);
        break;
      }
    }
    let part = CSS.escape(current.localName);
    const parent: Element | null = current.parentElement;
    const siblings = parent
      ? Array.from(parent.children).filter(
          (child) => child.localName === current!.localName,
        )
      : [];
    if (siblings.length > 1)
      part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    const candidate = parts.join(" > ");
    if (root.querySelectorAll(candidate).length === 1) return candidate;
    current = parent;
  }
  return parts.join(" > ");
}

function isPassword(element: Element): boolean {
  return (
    element.localName === "input" &&
    element.getAttribute("type")?.toLowerCase() === "password"
  );
}

function safeHTML(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const input of [clone, ...clone.querySelectorAll("input")]) {
    if (isPassword(input)) input.setAttribute("value", "[redacted]");
  }
  return clone.outerHTML;
}

function sourceRules(element: Element) {
  const rules: SourceRule[] = [];
  const inaccessible = new Set<string>();
  const notes = new Set<string>();
  const root = element.getRootNode() as Document | ShadowRoot;
  const sheets = [...root.styleSheets, ...root.adoptedStyleSheets];
  const visited = new Set<CSSStyleSheet>();
  let examined = 0;
  function walk(
    list: CSSRuleList,
    origin: string,
    context: string[],
    parentSelector?: string,
  ) {
    for (const rule of Array.from(list)) {
      if (++examined > 50000) {
        notes.add(
          "CSS scan stopped at 50,000 rules to keep this page responsive.",
        );
        return;
      }
      if (rule instanceof CSSImportRule) {
        if (rule.media.length && !matchMedia(rule.media.mediaText).matches)
          continue;
        if (rule.supportsText && !CSS.supports(rule.supportsText)) continue;
        if (rule.styleSheet)
          sheet(rule.styleSheet, [...context, `@import ${rule.href}`]);
        continue;
      }
      if (
        rule instanceof CSSMediaRule &&
        !matchMedia(rule.conditionText).matches
      )
        continue;
      if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText))
        continue;
      if (rule instanceof CSSStyleRule) {
        // Nesting resolution needs a selector parser; don't invent selector matches.
        if (parentSelector) {
          notes.add(
            "Nested CSS selectors are omitted; their final values remain in Computed.",
          );
          continue;
        }
        try {
          if (element.matches(rule.selectorText))
            rules.push({
              selector: rule.selectorText,
              origin,
              context,
              declarations: declarations(rule.style),
            });
        } catch {
          notes.add("Some selectors could not be evaluated by the browser.");
        }
        if (rule.cssRules?.length)
          walk(rule.cssRules, origin, context, rule.selectorText);
      } else if ("cssRules" in rule) {
        const heading = rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();
        if (
          rule instanceof CSSMediaRule ||
          rule instanceof CSSSupportsRule ||
          rule.constructor.name === "CSSLayerBlockRule"
        ) {
          walk(
            (rule as CSSGroupingRule).cssRules,
            origin,
            [...context, heading],
            parentSelector,
          );
        } else if (!rule.constructor.name.includes("Keyframes")) {
          notes.add(
            `${heading || "Conditional rule"} is omitted because its element-specific condition cannot be reliably evaluated.`,
          );
        }
      }
    }
  }
  function sheet(stylesheet: CSSStyleSheet, context: string[] = []) {
    if (visited.has(stylesheet) || stylesheet.disabled) return;
    visited.add(stylesheet);
    if (
      stylesheet.media.length &&
      !matchMedia(stylesheet.media.mediaText).matches
    )
      return;
    const origin =
      stylesheet.href ||
      (stylesheet.ownerNode ? "Inline <style>" : "Constructed stylesheet");
    try {
      walk(stylesheet.cssRules, origin, context);
    } catch {
      inaccessible.add(origin);
    }
  }
  sheets.forEach((stylesheet) => sheet(stylesheet));
  if (element.closest("iframe, frame"))
    notes.add(
      "Frame contents are isolated. This inspection describes the frame element only.",
    );
  return { rules, inaccessible: [...inaccessible], notes: [...notes] };
}

export function capture(element: Element): Inspection {
  const computed = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const html = safeHTML(element);
  const root = element.getRootNode();
  return {
    tag: element.localName,
    text: (element.textContent ?? "").trim().slice(0, 2000),
    id: element.id,
    classes: Array.from(element.classList),
    attributes: Array.from(element.attributes, (attr) => [
      attr.name,
      isPassword(element) && attr.name.toLowerCase() === "value"
        ? "[redacted]"
        : attr.value,
    ]),
    html: html.slice(0, 60000),
    htmlTruncated: html.length > 60000,
    selector: uniqueSelector(element),
    scope:
      root instanceof ShadowRoot
        ? `Shadow root of ${uniqueSelector(root.host)} (selector is unique within this root)`
        : "Document",
    computed: Object.fromEntries(
      Array.from(computed, (property) => [
        property,
        computed.getPropertyValue(property).trim(),
      ]),
    ),
    inline:
      "style" in element
        ? declarations((element as HTMLElement | SVGElement).style)
        : [],
    ...sourceRules(element),
    rect: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
    capturedAt: new Date().toISOString(),
  };
}
