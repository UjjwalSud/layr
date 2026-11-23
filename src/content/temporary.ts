import { capture, parentOf } from "./capture";
import type { Inspection, TemporaryTarget } from "../shared/types";

const semantic = '[role="tooltip"], [role="menu"], [role="listbox"], [role="dialog"], [popover], [data-state="open"]';
const maxTargets = 16;
const retention = 8000;

export function visible(element: Element): boolean {
  if (!element.isConnected || !element.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return false;
  // Visibility is inherited but descendants can explicitly override it.
  const visibility = getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  // Display and opacity on ancestors still hide measurable descendants.
  for (let node: Element | null = element; node; node = parentOf(node)) {
    const style = getComputedStyle(node);
    if (style.display === "none" || Number(style.opacity) === 0) return false;
  }
  return true;
}

/** Bounded, in-memory hover buffer. DOM references are weak; snapshots are inert data. */
export class TemporaryCapture {
  frozen = false;
  private next = 0;
  private ids = new WeakMap<Element, number>();
  private candidates = new Map<number, { ref: WeakRef<Element>; dirty: boolean }>();
  private captures = new Map<number, { ref: WeakRef<Element>; inspection: Inspection; seen: number }>();
  private context: WeakRef<Element> | null = null;
  private timers = new Set<number>();

  constructor(private own: (element: Element) => boolean, private changed: () => void) {}

  private add(element: Element) {
    if (this.own(element) || element.matches("html, body, script, style, link, meta")) return;
    let key = this.ids.get(element);
    if (key === undefined) { key = ++this.next; this.ids.set(element, key); }
    this.candidates.set(key, { ref: new WeakRef(element), dirty: true });
    if (this.candidates.size > 80) this.candidates.delete(this.candidates.keys().next().value!);
  }

  register(root: Document | ShadowRoot) {
    // Once per observed root, never a full-page query on mousemove/mutation.
    let count = 0;
    for (const element of root.querySelectorAll(semantic)) {
      this.add(element);
      if (++count === 80) break;
    }
  }

  private discover(root: Element, dynamic = false) {
    // A TreeWalker bounds work even when React inserts a very large subtree.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let element: Element | null = root;
    for (let count = 0; element && count < 160; count++, element = walker.nextNode() as Element | null) {
      if (this.own(element)) continue;
      if (element.matches(semantic)) this.add(element);
      else if (!element.matches("html, body, script, style, link, meta")) {
        const position = getComputedStyle(element).position;
        if (position === "absolute" || position === "fixed" || (dynamic && element === root)) this.add(element);
      }
    }
  }

  hover(element: Element) {
    if (this.frozen || this.own(element) || this.context?.deref() === element) return;
    this.context = new WeakRef(element);
    let ancestor: Element | null = element;
    for (let depth = 0; ancestor && depth < 4 && !ancestor.matches("html, body"); depth++, ancestor = parentOf(ancestor)) {
      this.discover(ancestor);
      for (const id of (ancestor.getAttribute("aria-describedby") || "").split(/\s+/).slice(0, 10)) {
        const target = id && (ancestor.getRootNode() as Document | ShadowRoot).getElementById(id);
        if (target) this.add(target);
      }
    }
    this.queue();
  }

  mutations(records: MutationRecord[]) {
    if (this.frozen) { this.changed(); return; }
    let budget = 32;
    for (const record of records) {
      if (record.target instanceof Element && this.own(record.target)) continue;
      if (--budget < 0) break;
      if (record.type === "attributes" && record.target instanceof Element) this.discover(record.target, true);
      for (const node of record.addedNodes) {
        if (--budget < 0) break;
        if (node instanceof Element && !this.own(node)) this.discover(node, true);
      }
      // Refresh an existing target when its text or children change.
      for (const candidate of this.candidates.values()) {
        const element = candidate.ref.deref();
        if (element?.contains(record.target)) candidate.dirty = true;
      }
    }
    this.queue();
  }

  private queue(delay = 0) {
    if (this.timers.size || this.frozen) return;
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (this.frozen) return;
      this.collect();
      // CSS delays and transitions produce no DOM mutation. Recheck only the
      // bounded candidate set while the hover context is active; never rescan.
      const context = this.context?.deref();
      if (context?.isConnected && context.matches(":hover")) this.queue(100);
    }, delay);
    this.timers.add(timer);
  }

  collect() {
    const now = performance.now();
    for (const [key, entry] of this.captures) if (now - entry.seen > retention) this.captures.delete(key);
    let budget = 4;
    for (const [key, candidate] of this.candidates) {
      if (performance.now() - now > 32) break;
      const element = candidate.ref.deref();
      if (!element?.isConnected) { this.candidates.delete(key); continue; }
      if (!visible(element)) continue;
      if (element.matches('[role="menu"], [role="listbox"]')) {
        let count = 0;
        for (const child of element.querySelectorAll('[role="menuitem"], [role="option"], a, button, li')) {
          if (!this.ids.has(child)) this.add(child);
          if (++count === 8) break;
        }
      }
      const previous = this.captures.get(key);
      if (previous) previous.seen = now;
      if ((!candidate.dirty && previous) || budget <= 0) continue;
      // Don't clone entire application roots merely because React inserted them.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
      let descendants = 0;
      while (descendants <= 200 && walker.nextNode()) descendants++;
      if (descendants > 200) continue;
      try {
        let capturedKey = 0;
        const inspection = capture(element, (node) => ({ key: --capturedKey,
          label: `${node.localName}${node.id ? `#${node.id}` : ""}${Array.from(node.classList).slice(0, 2).map((name) => `.${name}`).join("")}`.slice(0, 160) }));
        // Keep the captured hierarchy even after portals disappear. These keys
        // describe a snapshot and deliberately cannot navigate the live DOM.
        inspection.navigationAvailable = false;
        this.captures.delete(key);
        this.captures.set(key, { ref: candidate.ref, inspection, seen: now });
        candidate.dirty = false;
        budget--;
        if (this.captures.size > maxTargets) this.captures.delete(this.captures.keys().next().value!);
      } catch { /* A page changing during capture must not interrupt inspection. */ }
    }
  }

  freeze() {
    if (this.frozen) return;
    // Include compact submenu descendants so a vanished menu can be explored.
    for (const candidate of [...this.candidates.values()]) {
      const element = candidate.ref.deref();
      if (!element || !visible(element)) continue;
      let count = 0;
      for (const child of element.querySelectorAll('[role="menuitem"], a, button, li')) {
        this.add(child);
        if (++count === 8) break;
      }
    }
    // Capture the actual hovered target as well, including unmarked floating labels.
    const context = this.context?.deref();
    if (context?.isConnected) this.add(context);
    for (let pass = 0; pass < 4; pass++) this.collect();
    this.frozen = true;
    this.cancelTimers();
    this.context = null;
    this.changed();
  }

  targets(): TemporaryTarget[] {
    if (!this.frozen) return [];
    return [...this.captures].map(([key, entry]) => ({
      key, tag: entry.inspection.tag, text: entry.inspection.text.slice(0, 100),
      classes: entry.inspection.classes.slice(0, 3),
      role: entry.inspection.attributes.find(([name]) => name === "role")?.[1] || "",
      status: this.isLive(key) ? "live" : "captured",
    }));
  }

  isLive(key: number) {
    const element = this.captures.get(key)?.ref.deref();
    return !!element && visible(element);
  }

  target(key: number) { return this.frozen ? this.captures.get(key) : undefined; }

  private cancelTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  unfreeze() {
    this.cancelTimers();
    this.frozen = false;
    this.captures.clear();
    this.context = null;
    for (const candidate of this.candidates.values()) candidate.dirty = true;
  }

  reset() {
    this.cancelTimers();
    this.frozen = false;
    this.candidates.clear();
    this.captures.clear();
    this.context = null;
  }
}
