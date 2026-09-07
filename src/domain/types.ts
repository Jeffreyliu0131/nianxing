export type CaptureKind = "task" | "idea" | "learning";
export type RecordSource = "seed" | "local" | "deepseek" | "manual";

export type TaskStatus = "open" | "done";
export type IdeaStatus = "inbox" | "exploring" | "archived";

export type Task = {
  id: string;
  title: string;
  scheduledAt: string | null;
  durationMinutes?: number;
  status: TaskStatus;
  notes?: string;
  tags: string[];
  source: RecordSource;
  createdAt: string;
  updatedAt: string;
};

export type Idea = {
  id: string;
  title: string;
  kind: Exclude<CaptureKind, "task">;
  notes?: string;
  tags: string[];
  status: IdeaStatus;
  source: RecordSource;
  createdAt: string;
  updatedAt: string;
};

export type DraftCapture = {
  clientId: string;
  kind: CaptureKind;
  title: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  notes: string | null;
  tags: string[];
};

export type OrganizerResult = {
  source: "local" | "deepseek";
  model?: string;
  items: DraftCapture[];
  fallbackReason?: string;
};

export type AppData = {
  schemaVersion: 2;
  tasks: Task[];
  ideas: Idea[];
  deleted: {
    tasks: Record<string, string>;
    ideas: Record<string, string>;
  };
};

export function createId(prefix: "task" | "idea" | "draft") {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
