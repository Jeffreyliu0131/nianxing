import { useEffect, useState } from "react";
import { KeyboardInput, useKeyboard } from "./Keyboard";
import { useMobileDevice } from "./Device";

export function StatusBar() {
  const [now, setNow] = useState(() => new Date());
  const { device } = useMobileDevice();

  useEffect(() => {
    const syncToMinute = window.setTimeout(() => {
      setNow(new Date());
    }, (60 - now.getSeconds()) * 1000 - now.getMilliseconds());
    const interval = window.setInterval(() => setNow(new Date()), 60_000);

    return () => {
      window.clearTimeout(syncToMinute);
      window.clearInterval(interval);
    };
  }, [now]);

  return (
    <div className="status-bar" aria-label="Preview status bar">
      <span className="status-time" data-testid="status-time">
        {formatStatusTime(now)}
      </span>
      <div className="status-indicators" aria-hidden="true">
        <StatusIndicators device={device.id} />
      </div>
    </div>
  );
}

export function HomeIndicator() {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();

  if (keyboard.visible) return null;

  return (
    <div
      className="navigation-rail"
      data-device={device.id}
      data-testid="navigation-rail"
      aria-hidden="true"
    >
      <span />
    </div>
  );
}

export function MobileTextField({
  id,
  label,
  placeholder,
  testId,
}: {
  id: string;
  label: string;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="mobile-field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <KeyboardInput id={id} data-testid={testId} placeholder={placeholder} />
    </label>
  );
}

function formatStatusTime(date: Date) {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours % 12 || 12}:${minutes}`;
}

function StatusIndicators({ device }: { device: "compact" | "tall" }) {
  return (
    <span
      className="generic-status-indicators"
      data-testid="status-indicators"
      data-device={device}
    >
      <span className="status-signal"><i /><i /><i /></span>
      <span className="status-link" />
      <span className="status-battery"><i /></span>
    </span>
  );
}
