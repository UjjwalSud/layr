// Sanitize before data leaves the page context, including HTML descendants.
const sensitiveName = /password|passwd|secret|token|api[-_]?key|authorization|cookie|session|credit|card[-_]?number|\bcvv\b|\bcvc\b|\bssn\b/i;
export const isSensitiveName = (name: string) => sensitiveName.test(name);
export function redactText(text: string): string {
  return text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\bBearer\s+[\w.+/=-]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[redacted]")
    .replace(/((?:password|passwd|secret|token|api[-_]?key|authorization|session)\s*["']?\s*[:=]\s*["']?)[^\s"'<>;,}]+/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[redacted number]")
    .replace(/([?&#][\w.%+-]+=)[^\s"'<>#&)]*/g, "$1[redacted]");
}

export function sanitizedElement(element: Element): Element {
  // An inert document prevents sanitized src/style URLs from loading resources.
  const inert = document.implementation.createHTMLDocument("");
  const clone = inert.importNode(element, true) as Element;
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    // Form values and editable text may contain arbitrary private user input.
    if (node.matches("input, textarea, select, [contenteditable]:not([contenteditable=false]), script")) {
      if (node.matches("input")) node.setAttribute("value", "[redacted]");
      else node.textContent = "[redacted]";
    }
    for (const attr of Array.from(node.attributes)) {
      if (sensitiveName.test(attr.name) || /^(on|srcdoc$)/i.test(attr.name) ||
          (attr.name === "value" && node.matches("input, option, button")))
        node.setAttribute(attr.name, "[redacted]");
      else node.setAttribute(attr.name, redactText(attr.value));
    }
    if (node.matches("meta") && sensitiveName.test(node.getAttribute("name") || ""))
      node.setAttribute("content", "[redacted]");
    if (sensitiveName.test(`${node.getAttribute("name") || ""} ${node.id} ${node.getAttribute("autocomplete") || ""}`)) {
      if (node.hasAttribute("value")) node.setAttribute("value", "[redacted]");
      if (!node.matches("input")) node.textContent = "[redacted]";
    }
  }
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    node.textContent = node.nodeType === Node.COMMENT_NODE ? "[redacted comment]" : redactText(node.textContent || "");
  }
  return clone;
}

export function hoverDescription(element: Element): string {
  // Avoid cloning large subtrees on pointer movement. Only preview direct text.
  const sensitive = element.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])") ||
    sensitiveName.test(`${element.id} ${element.getAttribute("name") || ""}`);
  const text = sensitive ? "" : redactText(Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim()).slice(0, 55);
  const rect = element.getBoundingClientRect();
  const identity = `${element.localName}${element.id ? `#${element.id}` : ""}${Array.from(element.classList).slice(0, 2).map((name) => `.${name}`).join("")}`;
  return `${redactText(identity).slice(0, 100)} · ${Math.round(rect.width)} × ${Math.round(rect.height)}${text ? ` · ${text}` : ""}`;
}

export function redactInspection<T>(value: T, knownSecrets: string[] = []): T {
  // All outgoing strings, including source URLs, declarations and selectors.
  if (typeof value === "string") {
    let text: string = value;
    for (const secret of knownSecrets) text = text.split(secret).join("[redacted]");
    return redactText(text) as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactInspection(item, knownSecrets)) as T;
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, isSensitiveName(key) && typeof item === "string" ? "[redacted]" : redactInspection(item, knownSecrets)]),
  ) as T;
  return value;
}

export function sensitiveValues(element: Element): string[] {
  const values = new Set<string>();
  for (const node of [element, ...element.querySelectorAll("*")]) {
    for (const attr of node.attributes) {
      if (sensitiveName.test(attr.name) || (attr.name === "value" && node.matches("input, option"))) {
        if (attr.value.length >= 4) values.add(attr.value);
      }
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}
