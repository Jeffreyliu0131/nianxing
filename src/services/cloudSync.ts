import { isPristineSeedData, migrateAppData } from "../data/localStore";
import type { AppData, Idea, Task } from "../domain/types";

export type CloudUser = {
  id?: string;
  email?: string;
  displayName?: string;
};

export type CloudSnapshot = {
  data: AppData | null;
  revision: number;
  updatedAt: string | null;
  aiConfigured: boolean;
  user: CloudUser;
};

export class CloudUnavailableError extends Error {}

export class CloudAuthError extends Error {}
export class CloudAccountChangedError extends Error {}

export class CloudConflictError extends Error {
  snapshot: CloudSnapshot;

  constructor(snapshot: CloudSnapshot) {
    super("CLOUD_CONFLICT");
    this.snapshot = snapshot;
  }
}

function newerTimestamp(left?: string, right?: string) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return leftTime >= rightTime ? left : right;
}

function mergeRecords<T extends Task | Idea>(local: T[], remote: T[]) {
  const merged = new Map<string, T>();
  for (const item of remote) merged.set(item.id, item);
  for (const item of local) {
    const existing = merged.get(item.id);
    if (!existing || Date.parse(item.updatedAt) >= Date.parse(existing.updatedAt)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

function mergeTombstones(local: Record<string, string>, remote: Record<string, string>) {
  const merged: Record<string, string> = { ...remote };
  for (const [id, deletedAt] of Object.entries(local)) {
    merged[id] = newerTimestamp(deletedAt, merged[id]) || deletedAt;
  }
  return merged;
}

export function mergeAppData(local: AppData, remote: AppData) {
  if (isPristineSeedData(local)) return remote;
  const deletedTasks = mergeTombstones(local.deleted.tasks, remote.deleted.tasks);
  const deletedIdeas = mergeTombstones(local.deleted.ideas, remote.deleted.ideas);
  const tasks = mergeRecords(local.tasks, remote.tasks).filter((task) => {
    const deletedAt = deletedTasks[task.id];
    return !deletedAt || Date.parse(task.updatedAt) > Date.parse(deletedAt);
  });
  const ideas = mergeRecords(local.ideas, remote.ideas).filter((idea) => {
    const deletedAt = deletedIdeas[idea.id];
    return !deletedAt || Date.parse(idea.updatedAt) > Date.parse(deletedAt);
  });
  return {
    schemaVersion: 2,
    tasks,
    ideas,
    deleted: { tasks: deletedTasks, ideas: deletedIdeas },
  } satisfies AppData;
}

function sortedRecord(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function appDataFingerprint(data: AppData) {
  return JSON.stringify({
    schemaVersion: data.schemaVersion,
    tasks: [...data.tasks].sort((left, right) => left.id.localeCompare(right.id)),
    ideas: [...data.ideas].sort((left, right) => left.id.localeCompare(right.id)),
    deleted: {
      tasks: sortedRecord(data.deleted.tasks),
      ideas: sortedRecord(data.deleted.ideas),
    },
  });
}

async function readSnapshot(response: Response): Promise<CloudSnapshot> {
  if (response.status === 412) throw new CloudAccountChangedError("ACCOUNT_CHANGED");
  if (response.status === 401) throw new CloudAuthError("SIGN_IN_REQUIRED");
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new CloudUnavailableError("CLOUD_API_UNAVAILABLE");
  const payload = await response.json();
  const normalized = payload?.data == null ? null : migrateAppData(payload.data);
  if (payload?.data != null && !normalized) throw new Error("INVALID_CLOUD_DATA");
  return {
    data: normalized,
    revision: Number.isInteger(payload?.revision) && payload.revision >= 0 ? payload.revision : 0,
    updatedAt: typeof payload?.updatedAt === "string" ? payload.updatedAt : null,
    aiConfigured: payload?.aiConfigured === true,
    user: {
      id: typeof payload?.user?.id === "string" ? payload.user.id : undefined,
      email: typeof payload?.user?.email === "string" ? payload.user.email : undefined,
      displayName: typeof payload?.user?.displayName === "string" ? payload.user.displayName : undefined,
    },
  };
}

export async function fetchCloudSnapshot(signal?: AbortSignal, accountId?: string) {
  const response = await fetch("/api/state", {
    method: "GET",
    headers: { accept: "application/json", ...(accountId ? { "x-nianxing-account-id": accountId } : {}) },
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 404) throw new CloudUnavailableError("CLOUD_API_UNAVAILABLE");
  if (response.status === 401) throw new CloudAuthError("SIGN_IN_REQUIRED");
  if (response.status === 412) throw new CloudAccountChangedError("ACCOUNT_CHANGED");
  if (!response.ok) throw new Error(`CLOUD_${response.status}`);
  return readSnapshot(response);
}

export async function saveCloudSnapshot(data: AppData, baseRevision: number, accountId: string, signal?: AbortSignal) {
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json", "x-nianxing-account-id": accountId },
    body: JSON.stringify({ baseRevision, data }),
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 404) throw new CloudUnavailableError("CLOUD_API_UNAVAILABLE");
  const snapshot = await readSnapshot(response);
  if (response.status === 409) throw new CloudConflictError(snapshot);
  if (!response.ok) throw new Error(`CLOUD_${response.status}`);
  return snapshot;
}
