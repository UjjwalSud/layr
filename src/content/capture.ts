import type { Declaration, ElementLink, ElementTree, Inspection, SourceRule } from "../shared/types";
import { isSensitiveName, redactInspection, sanitizedElement, sensitiveValues } from "./privacy";
import { classifyDeclarations } from "./cascade";
import { captureAssets, capturePseudos } from "./media";
import { annotateVariableValues, captureVariables } from "./variables";
import { variableReferences } from "../shared/variables";

export function declarations(style: CSSStyleDeclaration): Declaration[] {
  // CSSOM enumerates empty longhands for pending var() shorthands. Recover the
  // serialized shorthand through CSSOM itself, without interpreting its value.
  const properties = Array.from(style).filter((property) => property.startsWith("--") || style.getPropertyValue(property).trim());
  for (const match of style.cssText.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/gi)) {
    const property = match[1];
    if (!property.startsWith("--") && !properties.includes(property) && variableReferences(style.getPropertyValue(property)).length) properties.push(property);
  }
  return properties.map((property) => ({
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

function sourceRules(element: Element, ancestors: Element[], computed: CSSStyleDeclaration, ancestorsComplete: boolean) {
  const rules: SourceRule[] = [];
  const stateRules: SourceRule[] = [];
  const inactiveRules: SourceRule[] = [];
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
    applicable = true,
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
        if (rule.styleSheet)
          sheet(rule.styleSheet, [...context, `@import ${rule.href}${rule.media.length ? ` ${rule.media.mediaText}` : ""}${rule.supportsText ? ` supports(${rule.supportsText})` : ""}`], applicable &&
            (!rule.media.length || matchMedia(rule.media.mediaText).matches) && (!rule.supportsText || CSS.supports(rule.supportsText)));
        continue;
      }
      const active = applicable && (!(rule instanceof CSSMediaRule) || matchMedia(rule.conditionText).matches) &&
        (!(rule instanceof CSSSupportsRule) || CSS.supports(rule.conditionText));
      if (rule instanceof CSSStyleRule) {
        // Nesting resolution needs a selector parser; don't invent selector matches.
        if (parentSelector) {
          notes.add(
            "Nested CSS selectors are omitted; their final values remain in Computed.",
          );
          continue;
        }
        try {
          // Only generalize simple, non-functional state selectors. Rewriting
          // :not(), :is(), attribute strings, nesting or escapes would invent matches.
          for (const selector of rule.selectorText.split(",")) {
            const states = selector.match(/:(?:hover|focus-visible|focus-within|focus|active|disabled|checked|selected)\b/g) || [];
            const pseudo = selector.match(/::?(before|after)\s*$/)?.[1];
            if ((!states.length && !pseudo) || /[()\[\]\\]/.test(selector)) continue;
            const structural = selector.replace(/::?(before|after)\s*$/, "").replace(/:(?:hover|focus-visible|focus-within|focus|active|disabled|checked|selected)\b/g, ":is(*)").trim() || "*";
            if (element.getRootNode() !== currentRoot || !element.matches(structural)) continue;
            const current = selector.replace(/::?(before|after)\s*$/, "").trim() || "*";
            let stateActive = false;
            try { stateActive = element.matches(current); } catch { /* :selected is not a standard CSS pseudo-class. */ }
            stateRules.push({ selector: selector.trim(), origin, context, declarations: declarations(rule.style),
              active: active && stateActive, states: [...new Set(states)], ...(pseudo ? { pseudo: `::${pseudo}` } : {}) });
          }
          for (const target of targets) {
            if (target.getRootNode() !== currentRoot || !target.matches(rule.selectorText)) continue;
            const items = declarations(rule.style).filter((item) => target === element || inheritedProperty(item.property));
            if (items.length && (active || target === element)) (active ? matched.get(target)! : inactiveRules).push({
              selector: rule.selectorText,
              origin,
              context,
              declarations: items,
              ...(!active ? { active: false } : {}),
            });
          }
        } catch {
          notes.add("Some selectors could not be evaluated by the browser.");
        }
        if (rule.cssRules?.length)
          walk(rule.cssRules, origin, context, rule.selectorText, active);
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
            active,
          );
        } else if (!rule.constructor.name.includes("Keyframes")) {
          notes.add(
            `${heading || "Conditional rule"} is omitted because its element-specific condition cannot be reliably evaluated.`,
          );
        }
      }
    }
  }
  function sheet(stylesheet: CSSStyleSheet, context: string[] = [], applicable = true) {
    if (visited.has(stylesheet)) return;
    visited.add(stylesheet);
    const origin =
      stylesheet.href ||
      (stylesheet.ownerNode ? "Inline <style>" : "Constructed stylesheet");
    try {
      const conditions = stylesheet.media.length ? [...context, `@media ${stylesheet.media.mediaText}`] : context;
      walk(stylesheet.cssRules, origin, stylesheet.disabled ? [...conditions, "Stylesheet disabled"] : conditions, undefined,
        applicable && !stylesheet.disabled && (!stylesheet.media.length || matchMedia(stylesheet.media.mediaText).matches));
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
  const variables = captureVariables(computed, targets.map((target) => ({ element: target, label: uniqueSelector(target),
    inline: "style" in target ? declarations((target as HTMLElement | SVGElement).style) : [], rules: matched.get(target)!,
  })), !inaccessible.size && !notes.size && ancestorsComplete && !(element.getRootNode() instanceof ShadowRoot));
  return { rules, stateRules, inactiveRules, inherited, variables, inaccessible: [...inaccessible], notes: [...notes] };
}

function capturedTree(element: Element, safe: Element, link: (element: Element) => ElementLink): ElementTree {
  let remaining = 120;
  function visit(node: Element, sanitized: Element | null, depth: number): ElementTree {
    remaining--;
    const children: ElementTree[] = [];
    const nodes = Array.from(node.children).map((child, index) => ({ child, index })).filter(({ child }) => !child.hasAttribute("data-layr-overlay"));
    if (depth < 5) for (const { child, index } of nodes) {
      if (remaining <= 0) break;
      children.push(visit(child, sanitized?.children[index] ?? null, depth + 1));
    }
    return { ...link(node), text: sanitized ? Array.from(sanitized.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent).join(" ").trim().slice(0, 160) : "", children, truncated: children.length < nodes.length };
  }
  return visit(element, safe, 0);
}

export function capture(element: Element, link: (element: Element) => ElementLink): Inspection {
  const computed = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  let subtreeTruncated = false;
  const safe = sanitizedElement(element, () => { subtreeTruncated = true; });
  if (element.parentElement?.closest("[contenteditable]:not([contenteditable=false]), textarea, select")) {
    safe.textContent = "[redacted]";
    if (safe.hasAttribute("value")) safe.setAttribute("value", "[redacted]");
  }
  const html = safe.outerHTML;
  const root = element.getRootNode();
  const ancestors: Element[] = [];
  for (let parent = parentOf(element); parent; parent = parentOf(parent)) ancestors.push(parent);
  const source = sourceRules(element, ancestors.slice(0, 20), computed, ancestors.length <= 20);
  if (subtreeTruncated) source.notes.push("HTML capture is limited to 2,000 nodes and 80 levels to avoid cloning large page subtrees.");
  if (ancestors.length > 20) source.notes.push("Inherited source rules are limited to the nearest 20 ancestors.");
  const inline = "style" in element ? declarations((element as HTMLElement | SVGElement).style) : [];
  classifyDeclarations(element, inline, source.rules, !source.inaccessible.length && !source.notes.length && !(root instanceof ShadowRoot));
  for (const items of [inline, ...source.rules.map((rule) => rule.declarations), ...source.inactiveRules.map((rule) => rule.declarations),
    ...source.inherited.flatMap((ancestor) => [ancestor.inline, ...ancestor.rules.map((rule) => rule.declarations)])]) annotateVariableValues(items, computed);
  source.notes.push("Variable values and declaration annotations are browser-computed values on the selected element at capture time, not hypothetical evaluations of overridden rules. Dependency values are captured on the declaring element. Empty values may mean empty, missing or invalid variables (including cycles). Source winners stay candidates when the cascade is incomplete or unsupported; source line numbers are unavailable. Reference scanning is bounded to 64 references and 20,000 characters per declaration.");
  source.notes.push("Applied/overridden labels describe accessible author declarations for simple selectors. Unknown covers incomplete sources, layers, advanced selectors, logical/physical property conflicts, partial shorthand overrides, animations and transitions. Browser/user styles and shadow boundary cascade are not resolved. Source line numbers are unavailable through CSSOM.");
  source.notes.push("State candidates cover simple accessible selectors only. Functional, nested and escaped state selectors are not generalized. State labels describe capture time; no webpage state is forced. Normal/hover computed comparisons are unavailable without changing webpage state.");
  source.notes.push("Inherited entries are ancestor declarations for common inherited properties and variables, not proof of inheritance; explicit inherit, @property and resets can change the result. Computed contains final values.");
  const children = [...element.children, ...(element.shadowRoot?.children || [])].filter((child) => !child.hasAttribute("data-layr-overlay"));
  if (children.length > 100) source.notes.push("Child navigation shows the first 100 elements. Select a child to continue exploring.");
  return redactInspection({
    tree: capturedTree(element, safe, link),
    ...captureAssets(element, computed),
    pseudos: capturePseudos(element),
    states: Object.fromEntries([":hover", ":focus", ":focus-visible", ":focus-within", ":active", ":disabled", ":checked"].map((state) => [state, element.matches(state)]).concat(
      element instanceof HTMLOptionElement ? [["selected", element.selected]] : [])),
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
    htmlTruncated: subtreeTruncated || html.length > 60000,
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
  }, [...sensitiveValues(element), ...Array.from(computed).filter((name) => name.startsWith("--") && isSensitiveName(name))
    .map((name) => computed.getPropertyValue(name).trim()).filter((value) => value.length >= 4)]);
}
