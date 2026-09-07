import { organizeLocally } from "../domain/localParser";
import { createId, type CaptureKind, type DraftCapture, type OrganizerResult } from "../domain/types";

const endpoint = String(import.meta.env.VITE_AI_ENDPOINT || "/api/organize").trim();

function safeDraft(value: unknown): DraftCapture | null {
  const item = value as Record<string, unknown>;
  const kind = item?.kind as CaptureKind;
  const title = typeof item?.title === "string" ? item.title.trim().slice(0, 180) : "";
  if (!title || !["task", "idea", "learning"].includes(kind)) return null;
  const parsedTime = typeof item.scheduledAt === "string" ? Date.parse(item.scheduledAt) : Number.NaN;
  const duration = typeof item.durationMinutes === "number" ? item.durationMinutes : Number.NaN;
  return {
    clientId: createId("draft"),
    kind,
    title,
    scheduledAt: kind === "task" && Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : null,
    durationMinutes:
      kind === "task" && Number.isFinite(duration) ? Math.min(480, Math.max(5, Math.round(duration))) : null,
    notes: typeof item.notes === "string" ? item.notes.trim().slice(0, 800) || null : null,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 5)
      : [],
  };
}

export async function organizeCapture(text: string, now = new Date(), remoteEnabled = true): Promise<OrganizerResult> {
  if (!endpoint || !navigator.onLine || !remoteEnabled) {
    return {
      ...organizeLocally(text, now),
      fallbackReason: !navigator.onLine ? "offline" : "not-configured",
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        now: now.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore",
        locale: navigator.language || "zh-CN",
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items.map(safeDraft).filter(Boolean).slice(0, 4) : [];
    if (!items.length) throw new Error("EMPTY_ITEMS");
    return {
      source: "deepseek",
      model: typeof payload.model === "string" ? payload.model : undefined,
      items: items as DraftCapture[],
    };
  } catch (error) {
    return {
      ...organizeLocally(text, now),
      fallbackReason: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "request-failed",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
