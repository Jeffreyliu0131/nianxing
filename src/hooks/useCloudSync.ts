import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppData } from "../domain/types";
import {
  appDataFingerprint,
  CloudAuthError,
  CloudConflictError,
  CloudUnavailableError,
  fetchCloudSnapshot,
  mergeAppData,
  saveCloudSnapshot,
  type CloudUser,
} from "../services/cloudSync";

export type CloudSyncStatus = "connecting" | "saving" | "synced" | "offline" | "local" | "auth" | "error";

export function useCloudSync(data: AppData, setData: Dispatch<SetStateAction<AppData>>, online: boolean) {
  const [status, setStatus] = useState<CloudSyncStatus>(online ? "connecting" : "offline");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [user, setUser] = useState<CloudUser>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const dataRef = useRef(data);
  const revisionRef = useRef(0);
  const readyRef = useRef(false);
  const lastSyncedFingerprintRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);

  dataRef.current = data;

  useEffect(() => {
    if (!online) {
      setStatus("offline");
      return;
    }

    const controller = new AbortController();
    let active = true;

    const reconcile = async () => {
      readyRef.current = false;
      setStatus("connecting");
      try {
        const cloud = await fetchCloudSnapshot(controller.signal);
        if (!active) return;
        revisionRef.current = cloud.revision;
        setAiConfigured(cloud.aiConfigured);
        setUser(cloud.user);
        setLastSyncedAt(cloud.updatedAt);

        const current = dataRef.current;
        const merged = cloud.data ? mergeAppData(current, cloud.data) : current;
        const currentFingerprint = appDataFingerprint(current);
        const remoteFingerprint = cloud.data ? appDataFingerprint(cloud.data) : "";
        const mergedFingerprint = appDataFingerprint(merged);
        lastSyncedFingerprintRef.current = remoteFingerprint;
        if (mergedFingerprint !== currentFingerprint) {
          dataRef.current = merged;
          setData(merged);
        }

        if (!cloud.data || mergedFingerprint !== remoteFingerprint) {
          setStatus("saving");
          const saved = await saveCloudSnapshot(merged, cloud.revision, controller.signal);
          if (!active) return;
          revisionRef.current = saved.revision;
          lastSyncedFingerprintRef.current = appDataFingerprint(saved.data || merged);
          setAiConfigured(saved.aiConfigured);
          setUser(saved.user);
          setLastSyncedAt(saved.updatedAt);
        }
        if (active) {
          readyRef.current = true;
          setStatus("synced");
          if (appDataFingerprint(dataRef.current) !== lastSyncedFingerprintRef.current) {
            setRetryEpoch((value) => value + 1);
          }
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        readyRef.current = false;
        if (error instanceof CloudUnavailableError) {
          setStatus("local");
        } else if (error instanceof CloudAuthError) {
          setStatus("auth");
        } else {
          setStatus("error");
          window.setTimeout(() => setRetryEpoch((current) => current + 1), 5_000);
        }
      }
    };

    void reconcile();
    return () => {
      active = false;
      controller.abort();
    };
  }, [online, retryEpoch, setData]);

  useEffect(() => {
    if (!online || !readyRef.current) return;
    const fingerprint = appDataFingerprint(data);
    if (fingerprint === lastSyncedFingerprintRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);

    setStatus("saving");
    saveTimerRef.current = window.setTimeout(async () => {
      saveTimerRef.current = null;
      try {
        const saved = await saveCloudSnapshot(data, revisionRef.current);
        revisionRef.current = saved.revision;
        lastSyncedFingerprintRef.current = appDataFingerprint(saved.data || data);
        setAiConfigured(saved.aiConfigured);
        setUser(saved.user);
        setLastSyncedAt(saved.updatedAt);
        setStatus("synced");
      } catch (error) {
        if (error instanceof CloudConflictError && error.snapshot.data) {
          revisionRef.current = error.snapshot.revision;
          setAiConfigured(error.snapshot.aiConfigured);
          setUser(error.snapshot.user);
          setLastSyncedAt(error.snapshot.updatedAt);
          lastSyncedFingerprintRef.current = appDataFingerprint(error.snapshot.data);
          const merged = mergeAppData(dataRef.current, error.snapshot.data);
          if (appDataFingerprint(merged) !== appDataFingerprint(dataRef.current)) setData(merged);
          else setRetryEpoch((current) => current + 1);
        } else if (error instanceof CloudAuthError) {
          readyRef.current = false;
          setStatus("auth");
        } else if (error instanceof CloudUnavailableError) {
          readyRef.current = false;
          setStatus("local");
        } else {
          setStatus(navigator.onLine ? "error" : "offline");
          window.setTimeout(() => setRetryEpoch((current) => current + 1), 5_000);
        }
      }
    }, 700);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [data, online, setData]);

  return { status, aiConfigured, user, lastSyncedAt };
}
