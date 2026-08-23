const DAY_MS = 86_400_000;

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number) {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isSameLocalDay(left: string | Date, right: string | Date) {
  return localDateKey(left) === localDateKey(right);
}

export function atLocalTime(day: Date, hours: number, minutes = 0) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

export function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatMonthDay(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(value);
}

export function formatWeekday(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(value);
}

export function formatIdeaDate(value: string, now = new Date()) {
  const date = new Date(value);
  const delta = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / DAY_MS);
  if (delta === 0) return "今天";
  if (delta === 1) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

export function sortByScheduledAt<T extends { scheduledAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
}
