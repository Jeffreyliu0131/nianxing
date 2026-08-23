import { addLocalDays, atLocalTime } from "../domain/date";
import { createId, type AppData, type Idea, type Task } from "../domain/types";

const STORAGE_KEY = "nianxing.app-data.v1";

function seedData(now = new Date()): AppData {
  const createdAt = now.toISOString();
  return {
    schemaVersion: 2,
    tasks: [
      {
        id: createId("task"),
        title: "晨间回顾与计划",
        scheduledAt: atLocalTime(now, 8, 30).toISOString(),
        durationMinutes: 20,
        status: "done",
        tags: ["例行"],
        source: "seed",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: createId("task"),
        title: "整理 DeepSeek 接入思路",
        scheduledAt: atLocalTime(now, 19, 30).toISOString(),
        durationMinutes: 45,
        status: "open",
        notes: "先列出接口、数据结构与安全边界",
        tags: ["DeepSeek"],
        source: "seed",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: createId("task"),
        title: "学习 PWA 离线缓存",
        scheduledAt: atLocalTime(addLocalDays(now, 1), 10, 0).toISOString(),
        durationMinutes: 60,
        status: "open",
        tags: ["PWA", "学习"],
        source: "seed",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: createId("task"),
        title: "复盘并安排下一步",
        scheduledAt: atLocalTime(addLocalDays(now, 1), 16, 30).toISOString(),
        durationMinutes: 25,
        status: "open",
        tags: ["例行"],
        source: "seed",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    ideas: [
      {
        id: createId("idea"),
        title: "把语音记录自动拆成行动与学习资料",
        kind: "idea",
        notes: "先验证一句话产生多个条目的确认体验。",
        tags: ["产品", "AI"],
        status: "inbox",
        source: "seed",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: createId("idea"),
        title: "了解 iOS PWA 通知的限制",
        kind: "learning",
        tags: ["PWA", "学习"],
        status: "inbox",
        source: "seed",
        createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
        updatedAt: createdAt,
      },
      {
        id: createId("idea"),
        title: "每日结束时自动生成明日焦点",
        kind: "idea",
        tags: ["产品"],
        status: "exploring",
        source: "seed",
        createdAt: new Date(now.getTime() - 86_400_000).toISOString(),
        updatedAt: createdAt,
      },
    ],
    deleted: { tasks: {}, ideas: {} },
  };
}

function validIso(value: unknown, fallback: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function migrateTask(value: unknown): Task | null {
  const task = value as Partial<Task>;
  if (!task || typeof task.id !== "string" || typeof task.title !== "string" || typeof task.scheduledAt !== "string") return null;
  const createdAt = validIso(task.createdAt, new Date().toISOString());
  return {
    ...task,
    id: task.id,
    title: task.title,
    scheduledAt: validIso(task.scheduledAt, createdAt),
    durationMinutes: typeof task.durationMinutes === "number" ? task.durationMinutes : undefined,
    status: task.status === "done" ? "done" : "open",
    notes: typeof task.notes === "string" ? task.notes : undefined,
    tags: Array.isArray(task.tags) ? task.tags.filter((tag): tag is string => typeof tag === "string") : [],
    source: ["seed", "local", "deepseek", "manual"].includes(String(task.source)) ? task.source as Task["source"] : "manual",
    createdAt,
    updatedAt: validIso(task.updatedAt, createdAt),
  };
}

function migrateIdea(value: unknown): Idea | null {
  const idea = value as Partial<Idea>;
  if (!idea || typeof idea.id !== "string" || typeof idea.title !== "string") return null;
  const createdAt = validIso(idea.createdAt, new Date().toISOString());
  return {
    ...idea,
    id: idea.id,
    title: idea.title,
    kind: idea.kind === "learning" ? "learning" : "idea",
    notes: typeof idea.notes === "string" ? idea.notes : undefined,
    tags: Array.isArray(idea.tags) ? idea.tags.filter((tag): tag is string => typeof tag === "string") : [],
    status: ["inbox", "exploring", "archived"].includes(String(idea.status)) ? idea.status as Idea["status"] : "inbox",
    source: ["seed", "local", "deepseek", "manual"].includes(String(idea.source)) ? idea.source as Idea["source"] : "manual",
    createdAt,
    updatedAt: validIso(idea.updatedAt, createdAt),
  };
}

function migrateDeleted(value: unknown) {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([id, deletedAt]) => id.length <= 160 && typeof deletedAt === "string" && Number.isFinite(Date.parse(deletedAt)))
      .map(([id, deletedAt]) => [id, new Date(deletedAt as string).toISOString()]),
  );
}

export function migrateAppData(value: unknown): AppData | null {
  const candidate = value as Partial<AppData> & { schemaVersion?: number };
  if (!candidate || !Array.isArray(candidate.tasks) || !Array.isArray(candidate.ideas)) return null;
  const tasks = candidate.tasks.map(migrateTask).filter((task): task is Task => Boolean(task));
  const ideas = candidate.ideas.map(migrateIdea).filter((idea): idea is Idea => Boolean(idea));
  const deleted = candidate.schemaVersion === 2 && candidate.deleted
    ? {
        tasks: migrateDeleted(candidate.deleted.tasks),
        ideas: migrateDeleted(candidate.deleted.ideas),
      }
    : { tasks: {}, ideas: {} };
  return { schemaVersion: 2, tasks, ideas, deleted };
}

export function isPristineSeedData(data: AppData) {
  return data.tasks.every((task) => task.source === "seed")
    && data.ideas.every((idea) => idea.source === "seed")
    && Object.keys(data.deleted.tasks).length === 0
    && Object.keys(data.deleted.ideas).length === 0;
}

export function loadAppData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData();
    return migrateAppData(JSON.parse(raw)) || seedData();
  } catch {
    return seedData();
  }
}

export function saveAppData(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function exportAppData(data: AppData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `念行备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
