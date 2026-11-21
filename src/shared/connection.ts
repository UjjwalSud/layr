import type { ContentCommand, InspectorState } from "./types";

export const command = async (
  tabId: number,
  message: ContentCommand,
): Promise<InspectorState> => {
  const result = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  if (result?.error) throw new Error(result.error);
  return result;
};

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
    return "Chrome blocks inspection on internal pages such as chrome://extensions and chrome://settings. Layr cannot be enabled here. Open a regular website and click the Layr toolbar icon.";
  if (url?.startsWith("file:"))
    return "Allow access to file URLs in Layr’s extension settings, then click its toolbar icon.";
  return "To start on this tab, click Layr’s icon in Chrome’s top toolbar. After that, use the toggle here to turn inspection on or off. Chrome blocks inspection on chrome:// pages, the Web Store, and its PDF viewer; Layr cannot be enabled on those pages.";
}
