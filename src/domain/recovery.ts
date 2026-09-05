import type { AppData, Task, Idea } from "./types";

export function restoreDeletedRecord(data: AppData, deleted: { kind: "task"; record: Task } | { kind: "idea"; record: Idea }, now = Date.now()): AppData {
  const category = deleted.kind === "task" ? "tasks" : "ideas";
  const tombstone = data.deleted[category][deleted.record.id];
  const updatedAt = new Date(Math.max(now, (Date.parse(tombstone || "") || 0) + 1)).toISOString();
  if (deleted.kind === "task") {
    if (data.tasks.some(item => item.id === deleted.record.id)) return data;
    return { ...data, tasks: [...data.tasks, { ...deleted.record, updatedAt }] };
  }
  if (data.ideas.some(item => item.id === deleted.record.id)) return data;
  return { ...data, ideas: [...data.ideas, { ...deleted.record, updatedAt }] };
}
