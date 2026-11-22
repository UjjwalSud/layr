import type { Inspection, InspectorState, SnapshotCommand } from "./types";

export const snapshotKey = (tabId: number) => `layr:inspection:${tabId}`;

export async function storedSnapshot(tabId?: number): Promise<Inspection | null> {
  const request: SnapshotCommand = { type: "LAYR_GET_SNAPSHOT", tabId };
  const result = await chrome.runtime.sendMessage(request);
  if (result?.error) throw new Error(result.error);
  return result?.inspection ?? null;
}

export async function savedState(tabId: number): Promise<InspectorState> {
  const inspection = await storedSnapshot(tabId);
  return { enabled: false, frozen: false, temporaryTargets: [], inspection, selectionStatus: inspection ? "saved" : null };
}

export async function clearStoredSnapshot(tabId: number): Promise<InspectorState> {
  const request: SnapshotCommand = { type: "LAYR_CLEAR_SNAPSHOT", tabId };
  const result = await chrome.runtime.sendMessage(request);
  if (result?.error) throw new Error(result.error);
  return { enabled: false, frozen: false, temporaryTargets: [], inspection: null, selectionStatus: null };
}
