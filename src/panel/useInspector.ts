import { useCallback, useEffect, useRef, useState } from "react";
import { command, enableTab, pageError } from "../shared/connection";
import type {
  ContentCommand,
  InspectorState,
  StateEvent,
} from "../shared/types";

const empty: InspectorState = { enabled: false, inspection: null };

export function useInspector() {
  const [state, setState] = useState<InspectorState>(empty);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currentTab = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const windowId = useRef<number | undefined>(undefined);
  const sessions = useRef(new Map<number, chrome.runtime.Port>());

  const watchTab = useCallback((tabId: number) => {
    if (sessions.current.has(tabId)) return;
    const port = chrome.tabs.connect(tabId, {
      name: "LAYR_PANEL_SESSION",
      frameId: 0,
    });
    sessions.current.set(tabId, port);
    port.onDisconnect.addListener(() => {
      // Navigation and closed tabs can disconnect a session with lastError set.
      void chrome.runtime.lastError;
      if (sessions.current.get(tabId) === port) sessions.current.delete(tabId);
    });
  }, []);

  const sync = useCallback(async () => {
    const version = ++generation.current;
    const [active] = await chrome.tabs.query({
      active: true,
      windowId: windowId.current,
    });
    if (version !== generation.current) return;
    currentTab.current = active?.id;
    setTab(active ?? null);
    setState(empty);
    setError("");
    if (active?.id === undefined) return;
    try {
      const next = await command(active.id, { type: "LAYR_GET_STATE" });
      if (version === generation.current) {
        if (next.enabled) watchTab(active.id);
        setState(next);
      }
    } catch {
      if (version === generation.current) setError(pageError(active.url));
    }
  }, [watchTab]);

  useEffect(() => {
    let alive = true;
    void chrome.windows.getCurrent().then((window) => {
      if (!alive) return;
      windowId.current = window.id;
      void sync();
    });
    const receive = (
      message: StateEvent | { type: "LAYR_UNAVAILABLE"; tabId: number },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (
        message.type === "LAYR_STATE" &&
        message.state.enabled &&
        sender.tab?.id !== undefined &&
        sender.tab.windowId === windowId.current &&
        sender.frameId === 0
      )
        watchTab(sender.tab.id);
      if (
        message.type === "LAYR_STATE" &&
        sender.tab?.id === currentTab.current &&
        sender.frameId === 0
      ) {
        setState(message.state);
        setError("");
      } else if (
        message.type === "LAYR_UNAVAILABLE" &&
        message.tabId === currentTab.current
      )
        void sync();
    };
    const activate = (info: chrome.tabs.OnActivatedInfo) => {
      if (info.windowId === windowId.current) void sync();
    };
    const update = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === currentTab.current && (info.status || info.url)) void sync();
    };
    chrome.runtime.onMessage.addListener(receive);
    chrome.tabs.onActivated.addListener(activate);
    chrome.tabs.onUpdated.addListener(update);
    return () => {
      alive = false;
      generation.current++;
      chrome.runtime.onMessage.removeListener(receive);
      chrome.tabs.onActivated.removeListener(activate);
      chrome.tabs.onUpdated.removeListener(update);
      for (const session of sessions.current.values()) session.disconnect();
      sessions.current.clear();
    };
  }, [sync, watchTab]);

  async function run(message: ContentCommand) {
    const id = currentTab.current;
    if (id === undefined || busy) return;
    setBusy(true);
    try {
      const next =
        message.type === "LAYR_ENABLE" && message.enabled
          ? await enableTab(id)
          : await command(id, message);
      if (currentTab.current === id) {
        if (next.enabled) watchTab(id);
        setState(next);
        setError("");
      }
    } catch {
      if (currentTab.current === id) {
        setState(empty);
        setError(pageError(tab?.url));
      }
    } finally {
      setBusy(false);
    }
  }

  return { ...state, tab, error, busy, run };
}
