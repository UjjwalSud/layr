import type { ContentCommand, InspectorState } from "./types";

export const command = (
  tabId: number,
  message: ContentCommand,
): Promise<InspectorState> =>
  chrome.tabs.sendMessage(tabId, message, { frameId: 0 });

export async function enableTab(tabId: number): Promise<InspectorState> {
  try {
    await command(tabId, { type: "LAYR_GET_STATE" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
  return command(tabId, { type: "LAYR_ENABLE", enabled: true });
}

export function pageError(url?: string): string {
  if (url && !/^(https?:|file:)/.test(url))
    return "Chrome protects this page. Open a regular website and click the Layr toolbar icon.";
  if (url?.startsWith("file:"))
    return "Allow access to file URLs in Layr’s extension settings, then click its toolbar icon.";
  return "Click the Layr toolbar icon to grant access to this tab. Chrome’s internal pages, the Web Store, and PDF viewer cannot be inspected.";
}
