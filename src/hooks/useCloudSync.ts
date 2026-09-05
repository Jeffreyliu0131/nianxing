import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppData } from "../domain/types";
import { appDataFingerprint, CloudAuthError, CloudAccountChangedError, CloudConflictError, CloudUnavailableError,
  fetchCloudSnapshot, mergeAppData, saveCloudSnapshot, type CloudUser } from "../services/cloudSync";

export type CloudSyncStatus = "connecting" | "saving" | "synced" | "offline" | "local" | "auth" | "error";

// One cancellable reconciliation per edit. Every write carries the verified
// expected account, so an auth-cookie switch cannot redirect an old request.
export function useCloudSync(data: AppData, setData: Dispatch<SetStateAction<AppData>>, online: boolean, accountId: string | null) {
  const [status, setStatus] = useState<CloudSyncStatus>("connecting");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [user, setUser] = useState<CloudUser>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    if (!accountId) { setStatus(online ? "local" : "offline"); return; }
    if (!online) { setStatus("offline"); return; }
    const controller = new AbortController();
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      setStatus("connecting");
      try {
        const cloud = await fetchCloudSnapshot(controller.signal, accountId);
        if (!active) return;
        if (cloud.user.id !== accountId) throw new CloudAccountChangedError();
        const merged = cloud.data ? mergeAppData(latest.current, cloud.data) : latest.current;
        const different = !cloud.data || appDataFingerprint(merged) !== appDataFingerprint(cloud.data);
        if (different) setStatus("saving");
        const saved = different ? await saveCloudSnapshot(merged, cloud.revision, accountId, controller.signal) : cloud;
        if (!active) return;
        if (saved.user.id !== accountId) throw new CloudAccountChangedError();
        setAiConfigured(saved.aiConfigured);
        setUser(saved.user);
        setLastSyncedAt(saved.updatedAt);
        setData(current => {
          const next = mergeAppData(current, saved.data || merged);
          return appDataFingerprint(current) === appDataFingerprint(next) ? current : next;
        });
        setStatus("synced");
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        if (error instanceof CloudAuthError || error instanceof CloudAccountChangedError) {
          setStatus("auth");
          window.dispatchEvent(new Event("nianxing-account-changed"));
        } else if (error instanceof CloudUnavailableError) {
          setStatus("local");
        } else {
          setStatus(error instanceof CloudConflictError ? "saving" : "error");
          retry = setTimeout(() => setRetryEpoch(value => value + 1), error instanceof CloudConflictError ? 300 : 5000);
        }
      }
    }, 700);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearTimeout(retry); };
  }, [data, online, accountId, retryEpoch, setData]);
  return { status, aiConfigured, user, lastSyncedAt };
}
