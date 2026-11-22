import { capture } from "./capture";
import { hoverDescription, redactText } from "./privacy";
import { storedSnapshot } from "../shared/snapshots";
import { TemporaryCapture, visible } from "./temporary";
import type { ContentCommand, InspectorState } from "../shared/types";

// Injection is idempotent, including concurrent toolbar / panel activation.
const global = window as typeof window & { __layrInstalled?: boolean };
if (!global.__layrInstalled) {
  global.__layrInstalled = true;
  let enabled = false;
  let selected: WeakRef<Element> | null = null;
  let hovered: Element | null = null;
  let inspection: InspectorState["inspection"] = null;
  let selectionStatus: InspectorState["selectionStatus"] = null;
  const ready = storedSnapshot().then((snapshot) => {
    inspection = snapshot;
    selectionStatus = snapshot ? "saved" : null;
  });
  let host: HTMLDivElement | null = null;
  let hoverBox: HTMLDivElement;
  let selectionBox: HTMLDivElement;
  let button: HTMLButtonElement;
  let label: HTMLSpanElement;
  let shields: HTMLDivElement;
  const navigation = new Map<number, WeakRef<Element>>();
  let nextKey = 0;
  let controller: AbortController | null = null;
  let observer: ResizeObserver | null = null;
  let mutations: MutationObserver | null = null;
  let shadowRoots: WeakRef<ShadowRoot>[] = [];
  let frames: Element[] = [];
  let framesDirty = true;
  let frame = 0;
  let point: { x: number; y: number } | null = null;
  let buttonBounds: { left: number; top: number; width: number } | null = null;
  let temporaryStatuses = "";
  const panelSessions = new Set<chrome.runtime.Port>();

  const temporary = new TemporaryCapture(ownElement, () => { schedule(); });
  const state = (): InspectorState => ({ enabled, frozen: temporary.frozen, temporaryTargets: temporary.targets(), inspection, selectionStatus });
  const publish = (snapshotChanged = false) => {
    void chrome.runtime
      .sendMessage({ type: "LAYR_STATE", state: state(), snapshotChanged })
      .catch(() => {});
  };
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const ownEvent = (event: Event) =>
    host !== null && event.composedPath().includes(host);
  const buttonEvent = (event: Event) => event.composedPath().includes(button);
  function ownElement(element: Element) {
    return element === host || element.getRootNode() === host?.shadowRoot;
  }

  function makeOverlay() {
    host = document.createElement("div");
    host.dataset.layrOverlay = "";
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{color-scheme:dark}*{box-sizing:border-box}
      .frame-shield{position:fixed;pointer-events:auto;cursor:crosshair}
      .box{position:fixed;pointer-events:none;border:1px solid #478bff;background:#478bff0a;display:none;z-index:1}
      .selected{border-color:#80abff;box-shadow:0 0 0 1px #478bff55;background:transparent}
      button{all:initial;box-sizing:border-box;position:fixed;display:none;align-items:center;justify-content:center;width:29px;height:29px;background:#3478f6;color:white;border:1px solid #8eb7ff;border-radius:6px;box-shadow:0 3px 12px #0004;cursor:pointer;pointer-events:auto;z-index:2;font:11px/1.2 ui-monospace,monospace;white-space:nowrap}
      button:focus-visible{outline:2px solid white;outline-offset:2px}svg{flex:none}span{position:fixed;pointer-events:none;overflow:hidden;text-overflow:ellipsis;width:max-content;max-width:min(390px,calc(100vw - 45px));padding:7px 8px;background:#111b2f;color:#dbe8ff;border:1px solid #478bff;border-radius:5px;box-sizing:border-box;height:29px;font:11px/1.2 ui-monospace,monospace}
    </style><div class="shields"></div><div class="box selected"></div><div class="box hover"></div><button type="button" title="Inspect element with Layr" aria-label="Inspect element with Layr"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m11-5v5h-5M9 9l8 3-4 1-1 4z"/></svg><span></span></button>`;
    shields = shadow.querySelector(".shields")!;
    selectionBox = shadow.querySelector(".selected")!;
    hoverBox = shadow.querySelector(".hover")!;
    button = shadow.querySelector("button")!;
    label = shadow.querySelector("span")!;
    document.documentElement.append(host);
  }

  function positionBox(
    box: HTMLElement,
    element: Element | null,
  ): DOMRect | null {
    if (!element?.isConnected) {
      box.style.display = "none";
      return null;
    }
    const rect = element.getBoundingClientRect();
    if ((!rect.width && !rect.height) || getComputedStyle(element).visibility === "hidden") {
      box.style.display = "none";
      return null;
    }
    box.style.cssText = `display:block;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    return rect;
  }

  function atPoint(x: number, y: number): Element | null {
    // Only frame documents need shields; the page itself receives normal hover.
    let element =
      document
        .elementsFromPoint(x, y)
        .find((candidate) => !ownElement(candidate)) ?? null;
    while (element?.shadowRoot) {
      const shadow = element.shadowRoot;
      const current = element;
      const inner = shadow
        .elementsFromPoint(x, y)
        .find(
          (candidate) =>
            !ownElement(candidate) &&
            candidate !== current &&
            (candidate.getRootNode() === shadow || current.contains(candidate)),
        );
      if (!inner) break;
      element = inner;
    }
    return element === host ? null : element;
  }

  function draw() {
    frame = 0;
    if (!enabled) return;
    updateFrameShields();
    const target = selected?.deref();
    if (selected && !target?.isConnected) detachSelection();
    positionBox(selectionBox, target ?? null);
    if (temporary.frozen) {
      if (selected && target && !visible(target)) detachSelection();
      const statuses = temporary.targets().map((target) => `${target.key}:${target.status}`).join();
      if (statuses !== temporaryStatuses) { temporaryStatuses = statuses; publish(); }
      hoverBox.style.display = "none";
      button.style.display = "none";
      buttonBounds = null;
      point = null;
      return;
    }
    if (point) {
      hovered = atPoint(point.x, point.y);
      point = null;
    }
    if (!hovered?.isConnected) hovered = null;
    const rect = positionBox(hoverBox, hovered);
    if (!rect || !hovered) {
      button.style.display = "none";
      buttonBounds = null;
      return;
    }
    label.textContent = hoverDescription(hovered);
    button.style.display = "flex";
    const width = button.getBoundingClientRect().width;
    const left = Math.max(4, Math.min(rect.left, innerWidth - width - 4));
    button.style.left = `${left}px`;
    const desiredTop =
      rect.top >= 35
        ? rect.top - 34
        : Math.min(rect.bottom + 5, innerHeight - 33);
    const top = Math.max(4, desiredTop);
    button.style.top = `${top}px`;
    const labelWidth = label.getBoundingClientRect().width;
    let labelLeft = left + width + 4;
    let labelTop = top;
    if (labelLeft + labelWidth > innerWidth - 4) {
      labelLeft = Math.max(4, left - labelWidth - 4);
      if (labelLeft + labelWidth > left - 4)
        labelTop = top + 62 <= innerHeight ? top + 33 : Math.max(4, top - 33);
    }
    label.style.left = `${labelLeft}px`;
    label.style.top = `${labelTop}px`;
    buttonBounds = { left, top, width };
  }
  function updateFrameShields() {
    // Frame events cannot be intercepted by listeners in the parent document.
    if (framesDirty) {
      framesDirty = false;
      frames = [];
      mutations?.disconnect();
      shadowRoots = [];
      const find = (root: Document | ShadowRoot) => {
        frames.push(...root.querySelectorAll("iframe, frame"));
        observeRoot(root);
        temporary.register(root);
        for (const node of root.querySelectorAll("*")) {
          if (node !== host && node.shadowRoot) find(node.shadowRoot);
        }
      };
      find(document);
    }
    while (shields.children.length < frames.length) {
      const shield = document.createElement("div");
      shield.className = "frame-shield";
      shields.append(shield);
    }
    while (shields.children.length > frames.length) shields.lastElementChild?.remove();
    frames.forEach((element, index) => positionBox(shields.children[index] as HTMLElement, element));
  }
  function observeRoot(root: Document | ShadowRoot) {
    if (root instanceof ShadowRoot) {
      if (shadowRoots.some((ref) => ref.deref() === root)) return;
      shadowRoots.push(new WeakRef(root));
    }
    mutations?.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  function detachSelection() {
    selected = null;
    navigation.clear();
    observer?.disconnect();
    selectionStatus = inspection ? "detached" : null;
    publish();
  }
  function clear() {
    selected = null;
    inspection = null;
    selectionStatus = null;
    navigation.clear();
    observer?.disconnect();
    publish(true);
    if (enabled) schedule();
  }
  function select(element: Element) {
    if (!element.isConnected) return;
    const links = new Map<number, WeakRef<Element>>();
    // Commit only after a complete, redacted capture succeeds. Hover drawing
    // and DOM observers never recapture or mutate this serializable snapshot.
    const snapshot = capture(element, (target) => {
      const key = ++nextKey;
      links.set(key, new WeakRef(target));
      return { key, label: redactText(`${target.localName}${target.id ? `#${target.id}` : ""}${Array.from(target.classList).slice(0, 2).map((name) => `.${name}`).join("")}`).slice(0, 160) };
    });
    selected = new WeakRef(element);
    navigation.clear();
    for (const [key, target] of links) navigation.set(key, target);
    inspection = snapshot;
    selectionStatus = "live";
    observer?.disconnect();
    observer?.observe(element);
    publish(true);
    schedule();
  }

  function freeze(next: boolean) {
    if (!enabled || temporary.frozen === next) return;
    if (next) {
      temporary.freeze();
      hovered = null;
      point = null;
      publish();
    }
    else {
      temporary.unfreeze();
      temporaryStatuses = "";
      hovered = null;
      point = null;
      publish();
      schedule();
    }
  }

  function toggleFreezeShortcut() {
    if (!enabled) return;
    freeze(!temporary.frozen);
  }

  function selectTemporary(key: number) {
    const entry = temporary.target(key);
    if (!enabled || !entry) return;
    // Always use the capture made while visible, even if the live node changed.
    inspection = entry.inspection;
    const element = entry.ref.deref();
    selected = temporary.isLive(key) && element ? new WeakRef(element) : null;
    selectionStatus = selected ? "live" : "captured";
    navigation.clear();
    observer?.disconnect();
    if (selected && element) observer?.observe(element);
    publish(true);
    schedule();
  }

  function setEnabled(next: boolean) {
    if (enabled === next) return;
    enabled = next;
    if (!next) {
      temporary.reset();
      controller?.abort();
      controller = null;
      observer?.disconnect();
      observer = null;
      mutations?.disconnect();
      mutations = null;
      shadowRoots = [];
      frames = [];
      framesDirty = true;
      cancelAnimationFrame(frame);
      frame = 0;
      host?.remove();
      host = null;
      selected = null;
      hovered = null;
      selectionStatus = inspection ? "saved" : null;
      navigation.clear();
      point = null;
      buttonBounds = null;
      publish();
      return;
    }
    makeOverlay();
    controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    observer = new ResizeObserver(schedule);
    mutations = new MutationObserver((records) => {
      if (!records.some((record) => !(record.target instanceof Element) || !ownElement(record.target))) return;
      temporary.mutations(records);
      if (shadowRoots.length && records.some((record) => record.removedNodes.length)) {
        const connected = shadowRoots.map((ref) => ref.deref()).filter((root): root is ShadowRoot => !!root?.host.isConnected);
        if (connected.length !== shadowRoots.length) {
          // MutationObserver has no unobserve(root); rebuild its subscriptions
          // without rescanning the page or retaining removed shadow trees.
          mutations?.disconnect();
          shadowRoots = [];
          observeRoot(document);
          for (const root of connected) observeRoot(root);
        }
      }
      // Track new frame/shadow subtrees incrementally. Ordinary React updates
      // must not cause repeated querySelectorAll('*') scans of the whole page.
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element) || ownElement(node)) continue;
          const visit = (element: Element) => {
            if (element.matches("iframe, frame") && !frames.includes(element)) frames.push(element);
            if (element.shadowRoot) {
              observeRoot(element.shadowRoot);
              temporary.register(element.shadowRoot);
              for (const child of element.shadowRoot.querySelectorAll("*")) visit(child);
            }
          };
          visit(node);
          for (const child of node.querySelectorAll("*")) visit(child);
        }
      }
      frames = frames.filter((element) => element.isConnected);
      schedule();
    });
    updateFrameShields();
    window.addEventListener("pointerover", (event) => {
      if (ownEvent(event) || temporary.frozen) return;
      const element = event.composedPath().find((node): node is Element => node instanceof Element);
      if (element) temporary.hover(element);
    }, { ...options, passive: true });
    window.addEventListener(
      "pointermove",
      (event) => {
        if (temporary.frozen) { schedule(); return; }
        if (buttonEvent(event)) return;
        // Keep the target stable while crossing the small gap to its inspect icon.
        if (
          buttonBounds &&
          event.clientX >= buttonBounds.left - 7 &&
          event.clientX <= buttonBounds.left + buttonBounds.width + 7 &&
          event.clientY >= buttonBounds.top - 7 &&
          event.clientY <= buttonBounds.top + 36
        )
          return;
        point = { x: event.clientX, y: event.clientY };
        schedule();
      },
      { ...options, passive: true },
    );
    // Block page handlers in the capture phase, before React/Angular click handlers.
    for (const type of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "dblclick",
      "auxclick",
      "contextmenu",
      "dragstart",
    ]) {
      window.addEventListener(
        type,
        (event) => {
          if (ownEvent(event) || event.type !== "contextmenu") stop(event);
        },
        options,
      );
    }
    window.addEventListener(
      "click",
      (event) => {
        const own = buttonEvent(event);
        stop(event);
        if (temporary.frozen) return;
        const element = own ? hovered : atPoint(event.clientX, event.clientY);
        if (element) select(element);
      },
      options,
    );
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.altKey && event.shiftKey && event.code === "KeyF") {
          stop(event);
          if (!event.repeat) toggleFreezeShortcut();
        } else if (event.key === "Escape" && temporary.frozen) {
          stop(event);
          freeze(false);
        } else if (temporary.frozen) {
          if (event.key === "Enter" || event.key === " ") stop(event);
        } else if (
          ownEvent(event) &&
          (event.key === "Enter" || event.key === " ")
        ) {
          stop(event);
          if (hovered) select(hovered);
        } else if (event.key === "Enter" || event.key === " ") {
          // A previously focused link/button must not activate during selection.
          stop(event);
          if (event.target instanceof Element && !ownElement(event.target)) select(event.target);
        }
      },
      options,
    );
    window.addEventListener("keyup", (event) => {
      if (event.key === "Enter" || event.key === " ") stop(event);
    }, options);
    window.addEventListener(
      "scroll",
      () => {
        hovered = null;
        point = null;
        updateFrameShields();
        schedule();
      },
      { ...options, passive: true },
    );
    window.addEventListener("resize", schedule, { ...options, passive: true });
    document.addEventListener(
      "mouseleave",
      () => {
        hovered = null;
        point = null;
        schedule();
      },
      { signal: controller.signal },
    );
    // Tear down even on BFCache navigation; restored pages start disabled.
    window.addEventListener("pagehide", () => setEnabled(false), {
      signal: controller.signal,
    });
    publish();
  }

  // These ports connect directly to the panel, so service-worker suspension
  // cannot leave inspection running after the last panel is closed.
  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== "LAYR_PANEL_SESSION" ||
      port.sender?.url !== chrome.runtime.getURL("sidepanel.html")
    )
      return;
    panelSessions.add(port);
    port.onDisconnect.addListener(() => {
      panelSessions.delete(port);
      if (!panelSessions.size) setEnabled(false);
    });
  });

  chrome.runtime.onMessage.addListener(
    (message: ContentCommand, _sender, respond) => {
      if (!["LAYR_GET_STATE", "LAYR_ENABLE", "LAYR_CLEAR", "LAYR_REFRESH", "LAYR_NAVIGATE", "LAYR_FREEZE", "LAYR_TOGGLE_FREEZE", "LAYR_SELECT_TEMPORARY"].includes(message.type)) return;
      void ready.then(() => {
        switch (message.type) {
          case "LAYR_GET_STATE":
            respond(state());
            break;
          case "LAYR_ENABLE":
            setEnabled(message.enabled);
            respond(state());
            break;
          case "LAYR_CLEAR":
            clear();
            respond(state());
            break;
          case "LAYR_FREEZE":
            freeze(message.frozen);
            respond(state());
            break;
          case "LAYR_TOGGLE_FREEZE":
            toggleFreezeShortcut();
            respond(state());
            break;
          case "LAYR_SELECT_TEMPORARY":
            selectTemporary(message.key);
            respond(state());
            break;
          case "LAYR_REFRESH":
            if (enabled && selected) {
              const target = selected.deref();
              if (target?.isConnected) select(target);
              else detachSelection();
            }
            respond(state());
            break;
          case "LAYR_NAVIGATE": {
            const target = navigation.get(message.key)?.deref();
            if (enabled && target?.isConnected) {
              target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
              select(target);
            }
            respond(state());
            break;
          }
        }
      }).catch((error) => respond({ error: String(error) }));
      return true;
    },
  );
}
