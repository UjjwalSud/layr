import { enableTab } from "./shared/connection";
import { snapshotKey } from "./shared/snapshots";
import type { SnapshotCommand, StateEvent } from "./shared/types";

// Serialize writes, reads, and clears per tab so closing a panel immediately
// after selection cannot restore an older snapshot. Session storage survives
// service-worker suspension without writing inspected data to disk storage.
const pending = new Map<number, Promise<unknown>>();
function forTab<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const next = (pending.get(tabId) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(tabId, next);
  void next.finally(() => {
    if (pending.get(tabId) === next) pending.delete(tabId);
  }).catch(() => {});
  return next;
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Call immediately: open() must retain the toolbar click's user gesture.
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  void enableTab(tab.id).catch(() => {
    // The panel explains restricted pages and missing activeTab grants.
    void chrome.runtime
      .sendMessage({ type: "LAYR_UNAVAILABLE", tabId: tab.id })
      .catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message: StateEvent | SnapshotCommand, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "LAYR_STATE") {
    if (sender.tab?.id === undefined || sender.frameId !== 0) return;
    const tabId = sender.tab.id;
    void chrome.action.setBadgeText({ tabId, text: message.state.enabled ? "ON" : "" }).catch(() => {});
    void chrome.action.setBadgeBackgroundColor({ tabId, color: "#3978f6" }).catch(() => {});
    const saved = message.snapshotChanged ? forTab(tabId, async () => {
      // Do not recreate a snapshot if a late message arrives after tab closure.
      await chrome.tabs.get(tabId);
      if (message.state.inspection)
        await chrome.storage.session.set({ [snapshotKey(tabId)]: message.state.inspection });
      else await chrome.storage.session.remove(snapshotKey(tabId));
    }) : Promise.resolve();
    void saved.then(() => respond({ saved: true }), (error) => respond({ error: String(error) }));
    return true;
  }
  if (message.type !== "LAYR_GET_SNAPSHOT" && message.type !== "LAYR_CLEAR_SNAPSHOT") return;
  // A content script can only restore its own tab. Trusted extension contexts
  // may request another tab's saved data to display the active tab in the panel.
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  const tabId = fromExtensionPage ? message.tabId : sender.tab?.id;
  if (tabId === undefined || !Number.isInteger(tabId)) return;
  void forTab(tabId, async () => {
    const key = snapshotKey(tabId);
    if (message.type === "LAYR_CLEAR_SNAPSHOT") {
      await chrome.storage.session.remove(key);
      void chrome.runtime.sendMessage({ type: "LAYR_SNAPSHOT_CLEARED", tabId }).catch(() => {});
      return { inspection: null };
    }
    return { inspection: (await chrome.storage.session.get(key))[key] ?? null };
  }).then(respond, (error) => respond({ error: String(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void forTab(tabId, () => chrome.storage.session.remove(snapshotKey(tabId))).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading")
    void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
});
