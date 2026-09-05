import { useEffect, useState } from "react";
import { MobileRuntime } from "./mobile";
import Prototype from "./Prototype";
import { CloudAuthError, CloudUnavailableError, fetchCloudSnapshot } from "./services/cloudSync";

export default function App() {
  const [scope, setScope] = useState<string | null | undefined>(undefined);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const refresh = () => setEpoch(value => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("nianxing-account-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("nianxing-account-changed", refresh);
    };
  }, []);
  useEffect(() => {
    // Offline reload opens the guest space; an authenticated space already
    // mounted remains usable offline until the next identity verification.
    if (!navigator.onLine) { setScope(current => current === undefined ? null : current); setChecking(false); return; }
    const controller = new AbortController();
    setChecking(true);
    setError(false);
    fetchCloudSnapshot(controller.signal).then(snapshot => {
      if (controller.signal.aborted) return;
      if (!snapshot.user.id) throw new Error("Missing account identity");
      setScope(snapshot.user.id);
      setChecking(false);
    }).catch(caught => {
      if (controller.signal.aborted) return;
      if (caught instanceof CloudAuthError || caught instanceof CloudUnavailableError) { setScope(null); setChecking(false); }
      else { setError(true); setChecking(true); }
    });
    return () => controller.abort();
  }, [epoch]);
  if (scope === undefined) return <main role="status" style={{ padding: 32 }}>
    {error ? "暂时无法确认登录状态，账号记录仍安全保存在本机。" : "正在确认记录空间…"}
    {error && <><button onClick={() => setEpoch(value => value + 1)}>重试</button><button onClick={() => setScope(null)}>使用本机访客空间</button></>}
  </main>;
  return <>
    {checking && <main role="status" style={{ padding: 32 }}>{error ? "暂时无法确认账号，请重试。记录未被移动。" : "正在确认记录空间…"}{error && <button onClick={() => setEpoch(value => value + 1)}>重试</button>}</main>}
    <div hidden={checking}><MobileRuntime><Prototype key={scope ?? "guest"} accountId={scope} /></MobileRuntime></div>
  </>;
}
