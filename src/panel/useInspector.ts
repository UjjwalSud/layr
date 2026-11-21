import { useCallback, useEffect, useRef, useState } from "react";
import { command, enableTab, pageError } from "../shared/connection";
import { clearStoredSnapshot, savedState } from "../shared/snapshots";
import type {
  ContentCommand,
  InspectorState,
  StateEvent,
} from "../shared/types";

const empty: InspectorState = { enabled: false, inspection: null, selectionStatus: null };

export function useInspector() {
  const [state, setState] = useState<InspectorState>(empty);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currentTab = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const updates = useRef(0);
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
    const updateVersion = updates.current;
    try {
      const next = await command(active.id, { type: "LAYR_GET_STATE" });
      if (version === generation.current && updateVersion === updates.current) {
        if (next.enabled) watchTab(active.id);
        setState(next);
      }
    } catch {
      try {
        const saved = await savedState(active.id);
        if (version === generation.current && updateVersion === updates.current) setState(saved);
      } catch {
        // The access hint below also covers an unavailable session snapshot.
      } finally {
        if (version === generation.current) setError(pageError(active.url));
      }
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
      message: StateEvent | { type: "LAYR_UNAVAILABLE" | "LAYR_SNAPSHOT_CLEARED"; tabId: number },
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
        updates.current++;
        setState(message.state);
        setError("");
      } else if (
        message.type === "LAYR_UNAVAILABLE" &&
        message.tabId === currentTab.current
      )
        void sync();
      else if (message.type === "LAYR_SNAPSHOT_CLEARED" && message.tabId === currentTab.current) {
        updates.current++;
        setState((previous) => ({ ...previous, inspection: null, selectionStatus: null }));
      }
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
        if (message.type === "LAYR_CLEAR") {
          try {
            const cleared = await clearStoredSnapshot(id);
            if (currentTab.current === id) setState(cleared);
          } catch {
            // Keep the available in-memory snapshot if session storage fails.
          }
        } else {
          try {
            const saved = await savedState(id);
            if (currentTab.current === id) setState((previous) => ({
              ...saved,
              inspection: saved.inspection ?? previous.inspection,
              selectionStatus: saved.inspection || previous.inspection ? "saved" : null,
            }));
          } catch {
            if (currentTab.current === id) setState((previous) => ({
              ...previous, enabled: false, selectionStatus: previous.inspection ? "saved" : null,
            }));
          }
        }
        if (currentTab.current === id) setError(pageError(tab?.url));
      }
    } finally {
      setBusy(false);
    }
  }

  return { ...state, tab, error, busy, run };
}
