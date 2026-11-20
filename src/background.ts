import { enableTab } from "./shared/connection";
import type { StateEvent } from "./shared/types";

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

chrome.runtime.onMessage.addListener((message: StateEvent, sender) => {
  if (message.type !== "LAYR_STATE" || sender.tab?.id === undefined) return;
  void chrome.action.setBadgeText({
    tabId: sender.tab.id,
    text: message.state.enabled ? "ON" : "",
  });
  void chrome.action.setBadgeBackgroundColor({
    tabId: sender.tab.id,
    color: "#3978f6",
  });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading")
    void chrome.action.setBadgeText({ tabId, text: "" });
});
