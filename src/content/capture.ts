import type { Declaration, ElementLink, Inspection, SourceRule } from "../shared/types";
import { isSensitiveName, redactInspection, sanitizedElement, sensitiveValues } from "./privacy";
import { classifyDeclarations } from "./cascade";

export function declarations(style: CSSStyleDeclaration): Declaration[] {
  return Array.from(style, (property) => ({
    property,
    value: isSensitiveName(property) ? "[redacted]" : style.getPropertyValue(property).trim(),
    important: style.getPropertyPriority(property) === "important",
  }));
}

export function uniqueSelector(element: Element): string {
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

export function parentOf(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement || (root instanceof ShadowRoot ? root.host : null);
}

const inheritedProperty = (name: string) => name.startsWith("--") ||
  /^(color$|font($|-)|line-height$|letter-spacing$|word-spacing$|text-align$|text-indent$|text-transform$|white-space$|visibility$|cursor$|direction$|writing-mode$|list-style($|-)|border-collapse$|border-spacing$|orphans$|widows$|quotes$)/.test(name);

function sourceRules(element: Element, ancestors: Element[]) {
  const rules: SourceRule[] = [];
  const inaccessible = new Set<string>();
  const notes = new Set<string>();
  const targets = [element, ...ancestors];
  const matched = new Map(targets.map((target) => [target, [] as SourceRule[]]));
  const visited = new Set<CSSStyleSheet>();
  let examined = 0;
  let currentRoot: Document | ShadowRoot;
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
      if (rule.constructor.name === "CSSPropertyRule") notes.add("@property registration may change CSS variable inheritance.");
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
          for (const target of targets) {
            if (target.getRootNode() !== currentRoot || !target.matches(rule.selectorText)) continue;
            const items = declarations(rule.style).filter((item) => target === element || inheritedProperty(item.property));
            if (items.length) matched.get(target)!.push({
              selector: rule.selectorText,
              origin,
              context,
              declarations: items,
            });
          }
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
  for (const root of new Set(targets.map((target) => target.getRootNode() as Document | ShadowRoot))) {
    currentRoot = root;
    visited.clear();
    [...root.styleSheets, ...root.adoptedStyleSheets].forEach((stylesheet) => sheet(stylesheet));
  }
  rules.push(...matched.get(element)!);
  const inherited = ancestors.map((ancestor) => ({
    element: uniqueSelector(ancestor),
    inline: "style" in ancestor ? declarations((ancestor as HTMLElement).style).filter((item) => inheritedProperty(item.property)) : [],
    rules: matched.get(ancestor)!,
  })).filter((entry) => entry.inline.length || entry.rules.length);
  if (element.closest("iframe, frame"))
    notes.add(
      "Frame contents are isolated. This inspection describes the frame element only.",
    );
  return { rules, inherited, inaccessible: [...inaccessible], notes: [...notes] };
}

export function capture(element: Element, link: (element: Element) => ElementLink): Inspection {
  const computed = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const safe = sanitizedElement(element);
  if (element.parentElement?.closest("[contenteditable]:not([contenteditable=false]), textarea, select")) {
    safe.textContent = "[redacted]";
    if (safe.hasAttribute("value")) safe.setAttribute("value", "[redacted]");
  }
  const html = safe.outerHTML;
  const root = element.getRootNode();
  const ancestors: Element[] = [];
  for (let parent = parentOf(element); parent; parent = parentOf(parent)) ancestors.push(parent);
  const source = sourceRules(element, ancestors.slice(0, 20));
  if (ancestors.length > 20) source.notes.push("Inherited source rules are limited to the nearest 20 ancestors.");
  const inline = "style" in element ? declarations((element as HTMLElement | SVGElement).style) : [];
  classifyDeclarations(element, inline, source.rules, !source.inaccessible.length && !source.notes.length && !(root instanceof ShadowRoot));
  source.notes.push("Active/overridden labels describe accessible author declarations for simple selectors. Unknown covers incomplete sources, layers, advanced selectors, logical/physical property conflicts, partial shorthand overrides, animations and transitions. Browser/user styles, pseudo-elements and shadow boundary cascade are not resolved.");
  source.notes.push("Inherited entries are ancestor declarations for common inherited properties and variables, not proof of inheritance; explicit inherit, @property and resets can change the result. Computed contains final values.");
  const children = [...element.children, ...(element.shadowRoot?.children || [])].filter((child) => !child.hasAttribute("data-layr-overlay"));
  if (children.length > 100) source.notes.push("Child navigation shows the first 100 elements. Select a child to continue exploring.");
  return redactInspection({
    hoverState: {
      hovered: element.matches(":hover"),
      focusWithin: element.matches(":focus-within"),
      expanded: element.getAttribute("aria-expanded"),
      state: element.getAttribute("data-state"),
    },
    tag: element.localName,
    text: (safe.textContent ?? "").trim().slice(0, 2000),
    id: element.id,
    classes: Array.from(element.classList),
    attributes: Array.from(safe.attributes, (attr): [string, string] => [
      attr.name,
      attr.value,
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
    inline,
    ...source,
    breadcrumb: [...ancestors].reverse().concat(element).map(link),
    children: children.slice(0, 100).map(link),
    rect: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
    capturedAt: new Date().toISOString(),
  }, sensitiveValues(element));
}
