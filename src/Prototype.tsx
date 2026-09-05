import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  BookOpenText,
  CalendarBlank,
  CalendarDots,
  CaretRight,
  Check,
  CheckCircle,
  Circle,
  ClockCountdown,
  CloudArrowUp,
  CloudCheck,
  DownloadSimple,
  GearSix,
  LightbulbFilament,
  MagicWand,
  Microphone,
  Sparkle,
  SpinnerGap,
  Target,
  Trash,
  WarningCircle,
  Waveform,
  WifiHigh,
  WifiSlash,
  X,
} from "@phosphor-icons/react";
import { BottomSheet, KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard, useKeyboardInsets } from "./mobile";
import {
  addLocalDays,
  atLocalTime,
  formatIdeaDate,
  formatMonthDay,
  formatTime,
  formatWeekday,
  fromDateTimeLocal,
  isSameLocalDay,
  localDateKey,
  sortByScheduledAt,
  startOfLocalDay,
  toDateTimeLocal,
} from "./domain/date";
import { createId, type AppData, type CaptureKind, type DraftCapture, type Idea, type Task } from "./domain/types";
import { exportAppData, loadAppData, saveAppData } from "./data/localStore";
import { organizeCapture } from "./services/organizer";
import { restoreDeletedRecord } from "./domain/recovery";
import { mergeAppData } from "./services/cloudSync";
import { useCloudSync, type CloudSyncStatus } from "./hooks/useCloudSync";
import { usePwa } from "./hooks/usePwa";

type View = "today" | "horizon" | "ideas";
type IdeaFilter = "all" | "idea" | "learning";
type VoiceState = "idle" | "starting" | "listening";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function nextOpenTime(now = new Date()) {
  const hour = Math.min(21, Math.max(8, now.getHours() + 1));
  return atLocalTime(now, hour, 0).toISOString();
}

function kindLabel(kind: CaptureKind) {
  if (kind === "task") return "行动";
  if (kind === "learning") return "学习";
  return "想法";
}

function sourceLabel(source: "local" | "deepseek") {
  return source === "deepseek" ? "DeepSeek 已整理" : "本地已整理";
}

function syncStatusLabel(status: CloudSyncStatus) {
  if (status === "synced") return "已同步到 Sites 云端";
  if (status === "saving") return "正在同步最新修改";
  if (status === "connecting") return "正在连接云端";
  if (status === "offline") return "等待联网后同步";
  if (status === "auth") return "登录后即可同步";
  if (status === "error") return "同步暂时不可用，本地记录安全";
  return "当前仅保存在本机";
}

function shortSyncLabel(status: CloudSyncStatus) {
  if (status === "synced") return "已同步";
  if (status === "saving" || status === "connecting") return "同步中";
  if (status === "offline") return "离线";
  return "本机";
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

const HORIZON_CAPACITY_MINUTES = 360;

function openMinutes(tasks: Task[]) {
  return tasks
    .filter((task) => task.status === "open")
    .reduce((total, task) => total + (task.durationMinutes || 30), 0);
}

function useNativeKeyboardInset() {
  const [state, setState] = useState({ native: false, inset: 0 });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px) and (pointer: coarse)");
    const preview = new URLSearchParams(window.location.search).get("mode") === "standalone";
    const viewport = window.visualViewport;

    const update = () => {
      const native = preview || media.matches;
      if (!native || !viewport) {
        setState({ native, inset: 0 });
        return;
      }
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const obscured = Math.max(0, layoutHeight - viewport.height - viewport.offsetTop);
      setState({ native, inset: obscured > 80 ? Math.round(obscured) : 0 });
    };

    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    media.addEventListener?.("change", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      media.removeEventListener?.("change", update);
    };
  }, []);

  return state;
}

function usePinnedDeviceViewport() {
  useEffect(() => {
    const screen = document.querySelector<HTMLElement>("[data-phone-screen]");
    if (!screen) return;
    const pin = () => {
      if (screen.scrollTop !== 0) screen.scrollTop = 0;
      if (screen.scrollLeft !== 0) screen.scrollLeft = 0;
    };
    pin();
    screen.addEventListener("scroll", pin, { passive: true });
    return () => screen.removeEventListener("scroll", pin);
  }, []);
}

function TimelineRow({ task, current, onToggle, onOpen }: { task: Task; current: boolean; onToggle: () => void; onOpen: () => void }) {
  const done = task.status === "done";
  return (
    <article className={`timeline-row ${current ? "timeline-row--current" : ""} ${done ? "timeline-row--done" : ""}`}>
      <time className="timeline-time" dateTime={task.scheduledAt}>{formatTime(task.scheduledAt)}</time>
      <button className="timeline-marker" type="button" onClick={onToggle} aria-label={done ? `恢复任务：${task.title}` : `完成任务：${task.title}`}>
        {done ? <CheckCircle size={19} weight="fill" /> : current ? <Target size={19} weight="duotone" /> : <Circle size={16} weight="regular" />}
      </button>
      <button className="timeline-copy" type="button" onClick={onOpen}>
        <span className="timeline-title">{task.title}</span>
        <span className="timeline-meta">
          <span>{done ? "已完成" : current ? "此刻优先" : formatMinutes(task.durationMinutes || 30)}</span>
          {task.notes ? <span className="timeline-note">{task.notes}</span> : null}
        </span>
      </button>
    </article>
  );
}

function TimelineSection({ title, date, tasks, currentTaskId, onToggle, onOpen, onEmpty }: { title: string; date: Date; tasks: Task[]; currentTaskId?: string; onToggle: (task: Task) => void; onOpen: (task: Task) => void; onEmpty: () => void }) {
  const done = tasks.filter((task) => task.status === "done").length;
  return (
    <section className="day-section" aria-label={`${title}的计划`}>
      <div className="day-heading">
        <div>
          <span className="section-kicker">{title}</span>
          <h2>{formatMonthDay(date)} · {formatWeekday(date)}</h2>
        </div>
        {tasks.length ? <span className="day-progress"><CheckCircle size={16} weight="regular" /> {done}/{tasks.length}</span> : <span className="day-progress day-progress--empty">空白</span>}
      </div>
      <div className="timeline-list">
        {tasks.length ? tasks.map((task) => (
          <TimelineRow key={task.id} task={task} current={task.id === currentTaskId} onToggle={() => onToggle(task)} onOpen={() => onOpen(task)} />
        )) : (
          <button className="empty-row" type="button" onClick={onEmpty}>
            <span className="empty-row-icon"><Circle size={15} /></span>
            <span><b>给这天留一点方向</b><small>写下时间和想做的事，念行会帮你安排</small></span>
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </section>
  );
}

function ViewSwitch({ value, onChange }: { value: View; onChange: (view: View) => void }) {
  const items: Array<{ id: View; label: string; icon: typeof ClockCountdown }> = [
    { id: "today", label: "今天", icon: ClockCountdown },
    { id: "horizon", label: "全景", icon: CalendarDots },
    { id: "ideas", label: "灵感", icon: LightbulbFilament },
  ];
  return (
    <nav className="view-switch" aria-label="切换念行空间">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className={value === id ? "is-selected" : ""} onClick={() => onChange(id)} aria-current={value === id ? "page" : undefined}>
          <Icon size={16} weight={value === id ? "fill" : "regular"} /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function AppChrome({ view, syncStatus, onViewChange, onSettings }: { view: View; syncStatus: CloudSyncStatus; onViewChange: (view: View) => void; onSettings: () => void }) {
  const SyncIcon = syncStatus === "synced" ? CloudCheck : syncStatus === "saving" || syncStatus === "connecting" ? CloudArrowUp : syncStatus === "offline" ? WifiSlash : WifiHigh;
  return (
    <>
      <header className="app-chrome">
        <button className="wordmark" type="button" onClick={() => onViewChange("today")} aria-label="返回念行今天"><span>念行</span><i /></button>
        <div className="chrome-actions">
          <span className={`sync-chip sync-chip--${syncStatus}`} title={syncStatusLabel(syncStatus)}><SyncIcon size={14} />{shortSyncLabel(syncStatus)}</span>
          <button className="icon-button" type="button" onClick={onSettings} aria-label="打开设置"><GearSix size={19} /></button>
        </div>
      </header>
      <ViewSwitch value={view} onChange={onViewChange} />
    </>
  );
}

function OverduePanel({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  if (!tasks.length) return null;
  return (
    <section className="overdue-panel" aria-label="待重新安排的任务">
      <div className="overdue-copy">
        <span><WarningCircle size={17} weight="fill" />轨道外 · {tasks.length}</span>
        <p>这些事已经过了原定时间，值得重新安排。</p>
      </div>
      <div className="overdue-list">
        {tasks.slice(0, 3).map((task) => (
          <button key={task.id} type="button" onClick={() => onOpen(task)}><span>{task.title}</span><small>{formatMonthDay(new Date(task.scheduledAt))}</small><CaretRight size={15} /></button>
        ))}
      </div>
    </section>
  );
}

function FuturePreview({ tasks, onSelect, onOpen }: { tasks: Task[]; onSelect: (date: Date) => void; onOpen: () => void }) {
  const openTasks = sortByScheduledAt(tasks.filter((task) => task.status === "open"));
  const plannedDays = new Set(openTasks.map((task) => localDateKey(task.scheduledAt))).size;
  return (
    <section className="future-preview" aria-label="未来七天具体计划">
      <div className="future-preview-heading">
        <div><span className="section-kicker">向前看</span><h2>接下来要做什么</h2></div>
        <button type="button" onClick={onOpen}>看未来 28 天 <CaretRight size={15} /></button>
      </div>
      <div className="future-preview-list">
        {openTasks.length ? openTasks.slice(0, 3).map((task) => {
          const date = new Date(task.scheduledAt);
          return (
            <button key={task.id} type="button" onClick={() => onSelect(date)} aria-label={`在全景中查看 ${formatMonthDay(date)} 的任务：${task.title}`}>
              <span className="future-preview-date"><b>{formatMonthDay(date)}</b><small>{formatWeekday(date)} · {formatTime(task.scheduledAt)}</small></span>
              <span className="future-preview-task"><strong>{task.title}</strong><small>{formatMinutes(task.durationMinutes || 30)}</small></span>
              <CaretRight size={16} />
            </button>
          );
        }) : (
          <button className="future-preview-empty" type="button" onClick={onOpen}>
            <span><b>未来 7 天暂时留白</b><small>打开全景，挑一天放下第一件事</small></span><CaretRight size={16} />
          </button>
        )}
      </div>
      {openTasks.length ? <p>{plannedDays} 天已有安排 · 点事项会带着你落到对应日期</p> : null}
    </section>
  );
}

function HorizonMap({ days, tasksByDay, selectedKey, now, onSelect }: { days: Date[]; tasksByDay: Map<string, Task[]>; selectedKey: string; now: Date; onSelect: (date: Date) => void }) {
  const weeks = Array.from({ length: 4 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const openTasks = days.flatMap((date) => tasksByDay.get(localDateKey(date)) || []).filter((task) => task.status === "open");
  const plannedDays = new Set(openTasks.map((task) => localDateKey(task.scheduledAt))).size;
  return (
    <section className="horizon-map" aria-label="未来二十八天日期导航">
      <div className="horizon-map-heading">
        <div><span>28 天计划地图</span><strong>{plannedDays} 天有安排 · {openTasks.length} 件待做</strong></div>
        <small>点日期，上方直接看事项</small>
      </div>
      <div className="horizon-weeks">
        {weeks.map((week, weekIndex) => {
          const weekTasks = sortByScheduledAt(week.flatMap((date) => tasksByDay.get(localDateKey(date)) || []).filter((task) => task.status === "open"));
          const weekLabel = weekIndex === 0 ? "本周" : weekIndex === 1 ? "下周" : `${formatMonthDay(week[0])} – ${formatMonthDay(week[6])}`;
          const summary = weekTasks.length ? weekTasks.slice(0, 2).map((task) => task.title).join(" · ") : "暂无安排";
          return (
          <article className="horizon-week" key={localDateKey(week[0])} aria-label={`${weekLabel}，${formatMonthDay(week[0])}到${formatMonthDay(week[6])}`}>
            <header className="horizon-week-header">
              <div><span>{weekLabel}</span><small>{formatMonthDay(week[0])} – {formatMonthDay(week[6])}</small></div>
              <p title={summary}>{summary}</p>
              <strong>{weekTasks.length ? `${weekTasks.length} 项` : "留白"}</strong>
            </header>
            <div className="horizon-week-days">
              {week.map((date) => {
                const key = localDateKey(date);
                const tasks = tasksByDay.get(key) || [];
                const open = tasks.filter((task) => task.status === "open").length;
                const done = tasks.filter((task) => task.status === "done").length;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`horizon-date ${open ? "has-plan" : ""} ${tasks.length && !open ? "is-complete" : ""} ${selectedKey === key ? "is-selected" : ""} ${isSameLocalDay(date, now) ? "is-today" : ""}`}
                    onClick={() => onSelect(date)}
                    aria-label={`${formatMonthDay(date)} ${formatWeekday(date)}，${open} 件待做，${done} 件完成`}
                    aria-pressed={selectedKey === key}
                  >
                    <span>{formatWeekday(date).replace("周", "")}</span>
                    <b>{date.getDate()}</b>
                    <small>{open ? `${open} 项` : tasks.length ? "完成" : "空"}</small>
                    {open ? <SpinnerGap size={12} weight="bold" /> : tasks.length ? <CheckCircle size={12} weight="fill" /> : <Circle size={11} />}
                  </button>
                );
              })}
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

function HorizonDayDetail({ date, tasks, onToggle, onOpen, onAdd }: { date: Date; tasks: Task[]; onToggle: (task: Task) => void; onOpen: (task: Task) => void; onAdd: () => void }) {
  const sortedTasks = sortByScheduledAt(tasks).sort((left, right) => Number(left.status === "done") - Number(right.status === "done"));
  const openTasks = sortedTasks.filter((task) => task.status === "open");
  const minutes = openMinutes(openTasks);
  const load = Math.min(100, Math.round((minutes / HORIZON_CAPACITY_MINUTES) * 100));
  return (
    <section className="horizon-detail" aria-live="polite" aria-label={`${formatMonthDay(date)}的计划详情`}>
      <div className="horizon-detail-heading">
        <div><CalendarBlank size={18} weight="duotone" /><span>{formatMonthDay(date)} · {formatWeekday(date)}</span><small>当前查看</small></div>
        <p>{openTasks.length ? `${openTasks.length} 件待做` : sortedTasks.length ? "今日已完成" : "暂未安排"}<span>{openTasks.length ? `${formatMinutes(minutes)} · 负载 ${load}%` : "仍可自由安排"}</span></p>
      </div>
      {sortedTasks.length ? (
        <div className="horizon-detail-list">
          {sortedTasks.map((task) => (
            <article className={`horizon-detail-task ${task.status === "done" ? "is-done" : ""}`} key={task.id}>
              <button className="horizon-detail-toggle" type="button" onClick={() => onToggle(task)} aria-label={task.status === "done" ? `恢复任务：${task.title}` : `完成任务：${task.title}`}>
                {task.status === "done" ? <CheckCircle size={20} weight="fill" /> : <Circle size={19} />}
              </button>
              <button className="horizon-detail-copy" type="button" onClick={() => onOpen(task)}>
                <time dateTime={task.scheduledAt}>{formatTime(task.scheduledAt)}<small>{formatMinutes(task.durationMinutes || 30)}</small></time>
                <span><b>{task.title}</b>{task.notes ? <small>{task.notes}</small> : null}</span>
                <CaretRight size={16} />
              </button>
            </article>
          ))}
          <button className="horizon-detail-add" type="button" onClick={onAdd}><span>在这一天再加一件事</span><ArrowUp size={15} /></button>
        </div>
      ) : (
        <button className="horizon-detail-empty" type="button" onClick={onAdd}>
          <span><b>这一天还没有安排</b><small>直接写下一件事，念行会落到这一天</small></span><ArrowUp size={16} />
        </button>
      )}
    </section>
  );
}

function IdeaRow({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  const Icon = idea.kind === "learning" ? BookOpenText : LightbulbFilament;
  return (
    <button className="idea-row" type="button" onClick={onOpen}>
      <span className={`idea-icon idea-icon--${idea.kind}`}><Icon size={20} weight="regular" /></span>
      <span className="idea-copy"><span className="idea-title">{idea.title}</span><span className="idea-meta">{kindLabel(idea.kind)} · {formatIdeaDate(idea.createdAt)}{idea.tags.length ? ` · ${idea.tags.join(" / ")}` : ""}</span></span>
      <span className={`idea-state idea-state--${idea.status}`}>{idea.status === "exploring" ? "探索中" : "收好"}</span>
    </button>
  );
}

function KindSelector({ value, onChange }: { value: CaptureKind; onChange: (kind: CaptureKind) => void }) {
  return (
    <div className="kind-selector" role="group" aria-label="记录类型">
      {(["task", "idea", "learning"] as CaptureKind[]).map((kind) => (
        <button key={kind} type="button" className={value === kind ? "is-selected" : ""} onClick={() => onChange(kind)}>
          {kind === "task" ? <CalendarBlank size={15} /> : kind === "learning" ? <BookOpenText size={15} /> : <LightbulbFilament size={15} />}{kindLabel(kind)}
        </button>
      ))}
    </div>
  );
}

export default function Prototype({ accountId = null }: { accountId?: string | null }) {
  usePinnedDeviceViewport();
  const [data, setData] = useState<AppData>(() => loadAppData(accountId));
  const [view, setView] = useState<View>("today");
  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>("all");
  const [captureText, setCaptureText] = useState("");
  const [drafts, setDrafts] = useState<DraftCapture[]>([]);
  const [captureSource, setCaptureSource] = useState<"local" | "deepseek">("local");
  const [fallbackReason, setFallbackReason] = useState<string | undefined>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [taskForm, setTaskForm] = useState<Task | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [ideaForm, setIdeaForm] = useState<Idea | null>(null);
  const [ideaSheetOpen, setIdeaSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [undo, setUndo] = useState<{ kind: "task"; record: Task } | { kind: "idea"; record: Idea } | null>(null);
  const [toast, setToast] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [online, setOnline] = useState(() => navigator.onLine);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceStartTimerRef = useRef<number | null>(null);
  const voiceEndTimerRef = useRef<number | null>(null);
  const voicePrefixRef = useRef("");
  const voiceHadResultRef = useRef(false);
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const keyboard = useKeyboard();
  const { bottomInset, isKeyboardVisible } = useKeyboardInsets();
  const nativeKeyboard = useNativeKeyboardInset();
  const pwa = usePwa();
  const cloud = useCloudSync(data, setData, online, accountId);
  const localAiConfigured = import.meta.env.DEV && import.meta.env.VITE_AI_LOCAL_ENABLED === "true";
  const aiConfigured = cloud.aiConfigured || localAiConfigured;

  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => startOfLocalDay(now), [now]);
  const tomorrow = useMemo(() => addLocalDays(now, 1), [now]);
  const horizonDays = useMemo(() => Array.from({ length: 28 }, (_, index) => addLocalDays(now, index)), [now]);
  const nextSevenDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addLocalDays(now, index + 1)), [now]);
  const horizonEnd = useMemo(() => addLocalDays(now, 28), [now]);
  const [selectedHorizonKey, setSelectedHorizonKey] = useState(() => localDateKey(now));
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    sortByScheduledAt(data.tasks).forEach((task) => {
      const key = localDateKey(task.scheduledAt);
      map.set(key, [...(map.get(key) || []), task]);
    });
    return map;
  }, [data.tasks]);
  const selectedHorizonDate = useMemo(() => horizonDays.find((date) => localDateKey(date) === selectedHorizonKey) || now, [horizonDays, now, selectedHorizonKey]);
  const selectedHorizonTasks = tasksByDay.get(selectedHorizonKey) || [];
  const todayTasks = tasksByDay.get(localDateKey(now)) || [];
  const tomorrowTasks = tasksByDay.get(localDateKey(tomorrow)) || [];
  const nearFutureTasks = useMemo(() => {
    const keys = new Set(nextSevenDays.map((date) => localDateKey(date)));
    return sortByScheduledAt(data.tasks.filter((task) => task.status === "open" && keys.has(localDateKey(task.scheduledAt))));
  }, [data.tasks, nextSevenDays]);
  const overdueTasks = useMemo(() => sortByScheduledAt(data.tasks.filter((task) => task.status === "open" && new Date(task.scheduledAt) < todayStart)), [data.tasks, todayStart]);
  const farFutureTasks = useMemo(() => sortByScheduledAt(data.tasks.filter((task) => new Date(task.scheduledAt) >= horizonEnd)), [data.tasks, horizonEnd]);
  const currentTask = todayTasks.find((task) => task.status === "open");
  const todayDone = todayTasks.filter((task) => task.status === "done").length;
  const todayMinutes = todayTasks.filter((task) => task.status === "open").reduce((total, task) => total + (task.durationMinutes || 30), 0);
  const visibleIdeas = useMemo(() => [...data.ideas].filter((idea) => idea.status !== "archived" && (ideaFilter === "all" || idea.kind === ideaFilter)).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [data.ideas, ideaFilter]);

  const clearVoiceTimers = () => {
    if (voiceStartTimerRef.current !== null) window.clearTimeout(voiceStartTimerRef.current);
    if (voiceEndTimerRef.current !== null) window.clearTimeout(voiceEndTimerRef.current);
    voiceStartTimerRef.current = null;
    voiceEndTimerRef.current = null;
  };

  const focusCapture = (message?: string) => {
    if (message) setToast(message);
    window.setTimeout(() => captureInputRef.current?.focus(), 40);
  };

  const stopVoice = (silent = false) => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    clearVoiceTimers();
    setVoiceState("idle");
    try { recognition?.stop(); } catch { /* Some mobile engines throw before start completes. */ }
    if (!silent && voiceHadResultRef.current) setToast("语音已经记下，可以继续补充");
  };

  useEffect(() => { if (!saveAppData(data, accountId)) setToast("这次修改暂时无法保存，请导出备份"); }, [data, accountId]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    if (voiceStartTimerRef.current !== null) window.clearTimeout(voiceStartTimerRef.current);
    if (voiceEndTimerRef.current !== null) window.clearTimeout(voiceEndTimerRef.current);
    try { recognitionRef.current?.stop(); } catch { /* Recognition may already have ended. */ }
  }, []);

  const toggleTask = (task: Task) => {
    const updatedAt = new Date().toISOString();
    setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status: item.status === "done" ? "open" : "done", updatedAt } : item) }));
    setToast(task.status === "done" ? "已恢复到时间线" : "完成了，轨道又向前一格");
  };

  const openTask = (task: Task) => { stopVoice(true); setTaskForm({ ...task, tags: [...task.tags] }); setTaskSheetOpen(true); };
  const saveTask = () => {
    if (!taskForm?.title.trim()) return setToast("任务需要一个标题");
    const updatedAt = new Date().toISOString();
    setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskForm.id ? { ...taskForm, title: taskForm.title.trim(), updatedAt } : task) }));
    setTaskSheetOpen(false); setToast("计划已更新");
  };
  const deleteTask = () => {
    if (!taskForm) return;
    setUndo({ kind: "task", record: taskForm });
    const deletedAt = new Date().toISOString();
    setData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskForm.id), deleted: { ...current.deleted, tasks: { ...current.deleted.tasks, [taskForm.id]: deletedAt } } }));
    setTaskSheetOpen(false); setToast("已从时间线移除");
  };
  const openIdea = (idea: Idea) => { stopVoice(true); setIdeaForm({ ...idea, tags: [...idea.tags] }); setIdeaSheetOpen(true); };
  const saveIdea = () => {
    if (!ideaForm?.title.trim()) return setToast("这条灵感还没有内容");
    const updatedAt = new Date().toISOString();
    setData((current) => ({ ...current, ideas: current.ideas.map((idea) => idea.id === ideaForm.id ? { ...ideaForm, title: ideaForm.title.trim(), updatedAt } : idea) }));
    setIdeaSheetOpen(false); setToast("灵感已保存");
  };
  const deleteIdea = () => {
    if (!ideaForm) return;
    setUndo({ kind: "idea", record: ideaForm });
    const deletedAt = new Date().toISOString();
    setData((current) => ({ ...current, ideas: current.ideas.filter((idea) => idea.id !== ideaForm.id), deleted: { ...current.deleted, ideas: { ...current.deleted.ideas, [ideaForm.id]: deletedAt } } }));
    setIdeaSheetOpen(false); setToast("已从灵感库移除");
  };

  const submitCapture = async () => {
    const text = captureText.trim();
    if (!text || organizing) return;
    stopVoice(true); keyboard.hide(); setOrganizing(true);
    const result = await organizeCapture(text, new Date(), aiConfigured);
    setDrafts(result.items); setCaptureSource(result.source); setFallbackReason(result.fallbackReason); setOrganizing(false);
    window.setTimeout(() => setReviewOpen(true), 40);
  };

  const updateDraft = (clientId: string, patch: Partial<DraftCapture>) => setDrafts((current) => current.map((draft) => draft.clientId === clientId ? { ...draft, ...patch } : draft));
  const saveDrafts = () => {
    const valid = drafts.filter((draft) => draft.title.trim());
    if (!valid.length) return setToast("至少保留一条记录");
    const createdAt = new Date().toISOString();
    const source = captureSource;
    const newTasks: Task[] = valid.filter((draft) => draft.kind === "task").map((draft) => ({ id: createId("task"), title: draft.title.trim(), scheduledAt: draft.scheduledAt || nextOpenTime(), durationMinutes: draft.durationMinutes || 30, status: "open", notes: draft.notes || undefined, tags: draft.tags, source, createdAt, updatedAt: createdAt }));
    const newIdeas: Idea[] = valid.filter((draft) => draft.kind !== "task").map((draft) => ({ id: createId("idea"), title: draft.title.trim(), kind: draft.kind as Idea["kind"], notes: draft.notes || undefined, tags: draft.tags, status: "inbox", source, createdAt, updatedAt: createdAt }));
    setData((current) => ({ ...current, tasks: [...current.tasks, ...newTasks], ideas: [...newIdeas, ...current.ideas] }));
    setCaptureText(""); setReviewOpen(false); setView(newTasks.length ? "today" : "ideas"); setToast(`已收好 ${valid.length} 条记录`);
  };

  const startVoice = () => {
    if (voiceState !== "idle") { stopVoice(); return; }
    const scope = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
    if (!Recognition) { focusCapture("当前环境不支持网页语音，已打开系统键盘听写"); return; }

    keyboard.hide(); clearVoiceTimers(); voicePrefixRef.current = captureText.trim(); voiceHadResultRef.current = false;
    try {
      const recognition = new Recognition();
      recognition.lang = "zh-CN"; recognition.continuous = false; recognition.interimResults = true;
      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        if (voiceStartTimerRef.current !== null) window.clearTimeout(voiceStartTimerRef.current);
        voiceStartTimerRef.current = null; setVoiceState("listening");
        voiceEndTimerRef.current = window.setTimeout(() => {
          if (recognitionRef.current !== recognition) return;
          stopVoice();
          if (!voiceHadResultRef.current) focusCapture("没有识别到内容，可以使用键盘上的听写");
        }, 25_000);
      };
      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) return;
        const transcript = Array.from(event.results).map((result) => result[0]?.transcript || "").join("").trim();
        if (!transcript) return;
        voiceHadResultRef.current = true;
        const prefix = voicePrefixRef.current;
        setCaptureText(prefix ? `${prefix} ${transcript}` : transcript);
      };
      recognition.onerror = (event) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null; clearVoiceTimers(); setVoiceState("idle");
        const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
        focusCapture(denied ? "麦克风权限未开启，已切换到系统键盘听写" : "语音暂时不可用，已切换到文字输入");
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null; clearVoiceTimers(); setVoiceState("idle");
        if (!voiceHadResultRef.current) focusCapture("没有听到内容，可以点键盘麦克风继续");
      };
      recognitionRef.current = recognition; setVoiceState("starting"); recognition.start();
      voiceStartTimerRef.current = window.setTimeout(() => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        try { recognition.stop(); } catch { /* Start can hang in some installed mobile web apps. */ }
        clearVoiceTimers(); setVoiceState("idle"); focusCapture("语音启动超时，已切换到系统键盘听写");
      }, 6_000);
    } catch {
      recognitionRef.current = null; clearVoiceTimers(); setVoiceState("idle"); focusCapture("麦克风暂时不可用，已切换到文字输入");
    }
  };

  const changeView = (nextView: View) => { stopVoice(true); keyboard.hide(); setView(nextView); };
  const openHorizonFor = (date: Date) => { setSelectedHorizonKey(localDateKey(date)); changeView("horizon"); };
  const openHorizon = () => {
    setSelectedHorizonKey(localDateKey(nearFutureTasks[0]?.scheduledAt || now));
    changeView("horizon");
  };
  const openSettings = () => { stopVoice(true); keyboard.hide(); setSettingsOpen(true); };
  const dockStyle = nativeKeyboard.native ? ({ "--native-keyboard-inset": `${nativeKeyboard.inset}px` } as CSSProperties) : ({ bottom: bottomInset } as CSSProperties);
  const voiceActive = voiceState !== "idle";

  return (
    <>
      <MobileScroll className="app-screen">
        <main className={`screen-content screen-content--${view}`} data-testid="nianxing-screen">
          <AppChrome view={view} syncStatus={cloud.status} onViewChange={changeView} onSettings={openSettings} />

          {view === "today" ? (
            <>
              <section className="page-intro page-intro--today">
                <span className="page-kicker">{formatMonthDay(now)} · {formatWeekday(now)}</span>
                <h1>今日轨道</h1>
                <p>{currentTask ? `把注意力留给「${currentTask.title}」` : todayTasks.length ? "今天的轨道已经铺好，按自己的节奏向前。" : "今天还留着一大片空白，先放下一件最值得做的事。"}</p>
                <div className="today-metrics" aria-label="今日概览">
                  <span><b>{todayDone}/{todayTasks.length || 0}</b><small>今日完成</small></span>
                  <span><b>{formatMinutes(todayMinutes)}</b><small>待投入</small></span>
                  <span><b>{overdueTasks.length}</b><small>待重排</small></span>
                </div>
              </section>
              <TimelineSection title="今天" date={now} tasks={todayTasks} currentTaskId={currentTask?.id} onToggle={toggleTask} onOpen={openTask} onEmpty={() => focusCapture("试试输入：今天晚上 8 点读书 30 分钟")} />
              <OverduePanel tasks={overdueTasks} onOpen={openTask} />
              <FuturePreview tasks={nearFutureTasks} onSelect={openHorizonFor} onOpen={openHorizon} />
              <TimelineSection title="明天" date={tomorrow} tasks={tomorrowTasks} onToggle={toggleTask} onOpen={openTask} onEmpty={() => focusCapture("试试输入：明天下午整理项目计划")} />
            </>
          ) : null}

          {view === "horizon" ? (
            <>
              <section className="page-intro page-intro--horizon">
                <span className="page-kicker">明亮时间仪器</span>
                <div className="horizon-title-row"><h1>时间全景 <em>· 28 天</em></h1><button type="button" onClick={() => changeView("today")}><ClockCountdown size={14} />回到今天</button></div>
                <p>{formatMonthDay(now)} – {formatMonthDay(addLocalDays(now, 27))} · 先读计划，再选日期。</p>
              </section>
              <HorizonDayDetail date={selectedHorizonDate} tasks={selectedHorizonTasks} onToggle={toggleTask} onOpen={openTask} onAdd={() => focusCapture(`可以输入：${formatMonthDay(selectedHorizonDate)}安排一件事`)} />
              <HorizonMap days={horizonDays} tasksByDay={tasksByDay} selectedKey={selectedHorizonKey} now={now} onSelect={(date) => setSelectedHorizonKey(localDateKey(date))} />
              {farFutureTasks.length ? (
                <section className="far-future" aria-label="二十八天以后的计划">
                  <div className="far-future-icon"><Target size={18} weight="duotone" /></div>
                  <button type="button" onClick={() => openTask(farFutureTasks[0])}>
                    <small>未来里程碑</small>
                    <strong>{farFutureTasks[0].title}</strong>
                    <span>{formatMonthDay(new Date(farFutureTasks[0].scheduledAt))}{farFutureTasks.length > 1 ? ` · 另有 ${farFutureTasks.length - 1} 件` : ""}</span>
                  </button>
                  <CaretRight size={17} />
                </section>
              ) : null}
            </>
          ) : null}

          {view === "ideas" ? (
            <>
              <section className="page-intro page-intro--ideas"><span className="page-kicker">未排期，也值得被看见</span><h1>灵感库</h1><p>把尚未决定时间的想法和学习主题留在第二空间。</p></section>
              <div className="idea-filter" role="group" aria-label="筛选灵感">
                {(["all", "idea", "learning"] as IdeaFilter[]).map((filter) => <button key={filter} type="button" className={ideaFilter === filter ? "is-selected" : ""} onClick={() => setIdeaFilter(filter)}>{filter === "all" ? `全部 ${data.ideas.filter((idea) => idea.status !== "archived").length}` : filter === "idea" ? "想法" : "学习"}</button>)}
              </div>
              <section className="idea-list" aria-label="已保存的灵感">
                {visibleIdeas.length ? visibleIdeas.map((idea) => <IdeaRow key={idea.id} idea={idea} onOpen={() => openIdea(idea)} />) : <div className="idea-empty"><LightbulbFilament size={30} /><h2>这里还很安静</h2><p>先记下一个不想忘记、但还不必安排时间的念头。</p><button type="button" onClick={() => focusCapture()}>记下第一个念头</button></div>}
              </section>
            </>
          ) : null}
        </main>
      </MobileScroll>

      <div className={`capture-dock ${isKeyboardVisible ? "capture-dock--keyboard" : ""} ${voiceActive ? "capture-dock--voice" : ""}`} style={dockStyle} data-testid="capture-dock">
        <div className="capture-shell">
          <div className={`capture-main ${voiceState === "listening" ? "is-listening" : ""}`}>
            <button className="voice-button" type="button" onClick={startVoice} aria-label={voiceActive ? "停止语音记录" : "开始语音记录"} aria-pressed={voiceActive}>
              {voiceState === "starting" ? <SpinnerGap className="is-spinning" size={21} /> : voiceState === "listening" ? <Waveform className="voice-wave" size={22} weight="fill" /> : <Microphone size={22} weight="regular" />}
            </button>
            <KeyboardInput ref={captureInputRef} className="capture-input" value={captureText} onChange={(event) => setCaptureText(event.target.value)} onFocus={() => { if (voiceActive) stopVoice(true); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitCapture(); } }} onBlur={() => keyboard.hide()} placeholder={voiceState === "starting" ? "正在连接麦克风…" : voiceState === "listening" ? "正在听你说…" : "记下此刻的念头…"} aria-label="记录任务或灵感" />
            <button className="send-button" type="button" onClick={() => void submitCapture()} disabled={!captureText.trim() || organizing} aria-label="整理并保存">{organizing ? <MagicWand className="is-spinning" size={19} /> : <ArrowUp size={20} weight="bold" />}</button>
          </div>
          <div className="capture-status">
            {voiceState === "listening" ? <><Waveform size={14} weight="fill" /><span>正在聆听 · 再点一次结束</span></> : voiceState === "starting" ? <><SpinnerGap className="is-spinning" size={13} /><span>正在启动语音</span></> : <><Sparkle size={13} weight="fill" /><span>AI 先整理成草稿，由你确认</span></>}
            <button type="button" onClick={openSettings}>{shortSyncLabel(cloud.status)}</button>
          </div>
        </div>
      </div>

      <BottomSheet open={reviewOpen} onOpenChange={setReviewOpen} title="整理好了" description={`${sourceLabel(captureSource)}，确认后才会写入你的记录`} snap={0.84}>
        <div className="review-source"><Sparkle size={16} weight="fill" /><span>{sourceLabel(captureSource)}</span>{fallbackReason ? <small>AI 不可用，已自动切换</small> : null}</div>
        <div className="draft-list">
          {drafts.map((draft, index) => (
            <section className="draft-item" key={draft.clientId}>
              <div className="draft-number">{index + 1}</div><button className="draft-remove" type="button" onClick={() => setDrafts((current) => current.filter((item) => item.clientId !== draft.clientId))} aria-label="移除这条草稿"><X size={15} /></button>
              <KindSelector value={draft.kind} onChange={(kind) => updateDraft(draft.clientId, { kind, scheduledAt: kind === "task" ? draft.scheduledAt || nextOpenTime() : null, durationMinutes: kind === "task" ? draft.durationMinutes || 30 : null })} />
              <label className="sheet-field"><span>内容</span><KeyboardInput value={draft.title} onChange={(event) => updateDraft(draft.clientId, { title: event.target.value })} onBlur={() => keyboard.hide()} /></label>
              {draft.kind === "task" ? <div className="field-pair"><label className="sheet-field"><span>安排时间</span><KeyboardInput type="datetime-local" value={toDateTimeLocal(draft.scheduledAt)} onChange={(event) => updateDraft(draft.clientId, { scheduledAt: fromDateTimeLocal(event.target.value) })} onBlur={() => keyboard.hide()} /></label><label className="sheet-field sheet-field--short"><span>分钟</span><KeyboardInput type="number" min="5" max="480" value={draft.durationMinutes || 30} onChange={(event) => updateDraft(draft.clientId, { durationMinutes: Number(event.target.value) || 30 })} onBlur={() => keyboard.hide()} /></label></div> : null}
            </section>
          ))}
        </div>
        <button className="primary-sheet-action" type="button" onClick={saveDrafts}><Check size={18} weight="bold" />收下这些记录</button>
      </BottomSheet>

      <BottomSheet open={taskSheetOpen} onOpenChange={setTaskSheetOpen} title="调整计划" description={cloud.status === "synced" || cloud.status === "saving" ? "修改后会自动同步到云端" : "修改会先保存在当前设备"} snap={0.72}>
        {taskForm ? <div className="edit-form"><button className="status-toggle" type="button" onClick={() => setTaskForm({ ...taskForm, status: taskForm.status === "done" ? "open" : "done" })}>{taskForm.status === "done" ? <CheckCircle size={18} weight="fill" /> : <Circle size={18} />}{taskForm.status === "done" ? "已完成" : "待完成"}</button><label className="sheet-field"><span>任务</span><KeyboardInput value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} onBlur={() => keyboard.hide()} /></label><div className="field-pair"><label className="sheet-field"><span>安排时间</span><KeyboardInput type="datetime-local" value={toDateTimeLocal(taskForm.scheduledAt)} onChange={(event) => setTaskForm({ ...taskForm, scheduledAt: fromDateTimeLocal(event.target.value) || taskForm.scheduledAt })} onBlur={() => keyboard.hide()} /></label><label className="sheet-field sheet-field--short"><span>分钟</span><KeyboardInput type="number" min="5" max="480" value={taskForm.durationMinutes || 30} onChange={(event) => setTaskForm({ ...taskForm, durationMinutes: Number(event.target.value) || 30 })} onBlur={() => keyboard.hide()} /></label></div><label className="sheet-field"><span>备注</span><KeyboardTextarea rows={3} value={taskForm.notes || ""} onChange={(event) => setTaskForm({ ...taskForm, notes: event.target.value })} onBlur={() => keyboard.hide()} placeholder="下一步、资料或上下文" /></label><div className="sheet-actions"><button className="danger-action" type="button" onClick={deleteTask}><Trash size={17} />删除</button><button className="primary-sheet-action" type="button" onClick={saveTask}><Check size={18} />保存修改</button></div></div> : null}
      </BottomSheet>

      <BottomSheet open={ideaSheetOpen} onOpenChange={setIdeaSheetOpen} title="整理灵感" description="保留原意，补上之后需要的上下文" snap={0.68}>
        {ideaForm ? <div className="edit-form"><KindSelector value={ideaForm.kind} onChange={(kind) => kind !== "task" && setIdeaForm({ ...ideaForm, kind })} /><label className="sheet-field"><span>内容</span><KeyboardTextarea rows={4} value={ideaForm.title} onChange={(event) => setIdeaForm({ ...ideaForm, title: event.target.value })} onBlur={() => keyboard.hide()} /></label><label className="sheet-field"><span>补充</span><KeyboardTextarea rows={3} value={ideaForm.notes || ""} onChange={(event) => setIdeaForm({ ...ideaForm, notes: event.target.value })} onBlur={() => keyboard.hide()} placeholder="为什么值得保留？下一步想了解什么？" /></label><div className="sheet-actions"><button className="danger-action" type="button" onClick={deleteIdea}><Trash size={17} />删除</button><button className="primary-sheet-action" type="button" onClick={saveIdea}><Check size={18} />保存灵感</button></div></div> : null}
      </BottomSheet>

      <BottomSheet open={settingsOpen} onOpenChange={setSettingsOpen} title="设置" description="模型可选，记录始终属于你" snap={0.6}>
        <div className="settings-list">
          {undo && <button className="setting-row setting-row--button" type="button" onClick={() => {
            setData(current => restoreDeletedRecord(current, undo)); setUndo(null); setToast("已恢复上次删除的记录");
          }}>撤销上次删除</button>}
          {accountId && <button className="setting-row setting-row--button" type="button" onClick={() => {
            const guest = loadAppData(null);
            const transferable = { ...guest, tasks: guest.tasks.filter(item => item.source !== "seed"), ideas: guest.ideas.filter(item => item.source !== "seed") };
            if (window.confirm(`将本机访客空间的 ${transferable.tasks.length} 个计划和 ${transferable.ideas.length} 条灵感复制到当前账号？原记录仍保留。`)) {
              setData(current => mergeAppData(current, transferable));
              setToast("访客记录已合并到当前空间，将按当前账号同步");
            }
          }}>将本机访客记录复制到当前账号</button>}
          <div className="setting-row"><span className="setting-icon"><CloudCheck size={19} /></span><span><b>云端同步</b><small>{syncStatusLabel(cloud.status)}{cloud.user.email ? ` · ${cloud.user.email}` : ""}</small></span><span className={`status-dot ${cloud.status === "synced" ? "is-active" : ""}`} /></div>
          <div className="setting-row"><span className="setting-icon"><MagicWand size={19} /></span><span><b>智能整理</b><small>{aiConfigured ? localAiConfigured && !cloud.aiConfigured ? "DeepSeek 本地代理已配置" : "DeepSeek 服务端密钥已配置" : "等待配置 DeepSeek API Key"}</small></span><span className={`status-dot ${aiConfigured ? "is-active" : ""}`} /></div>
          <button className="setting-row setting-row--button" type="button" onClick={async () => { if (pwa.installed) return setToast("念行已经安装在桌面"); const result = await pwa.install(); if (result === "unavailable") setToast("iPhone：点分享，再选“添加到主屏幕”"); }}><span className="setting-icon"><DownloadSimple size={19} /></span><span><b>{pwa.installed ? "已安装到桌面" : "安装到桌面"}</b><small>{pwa.canInstall ? "点击完成安装" : "支持 iPhone 与 Android PWA"}</small></span><CaretRight size={17} /></button>
          <button className="setting-row setting-row--button" type="button" onClick={() => { exportAppData(data); setToast("备份已导出"); }}><span className="setting-icon"><DownloadSimple size={19} /></span><span><b>导出本地备份</b><small>{data.tasks.length} 个计划 · {data.ideas.length} 条灵感</small></span><CaretRight size={17} /></button>
          <div className="privacy-note"><WifiSlash size={17} /><span>断网时先保存在本机，联网后自动同步。AI 只接收你本次主动提交的文字，不读取历史库。</span></div>
        </div>
      </BottomSheet>

      {toast ? <div className="toast" role="status" aria-live="polite" style={{ bottom: (nativeKeyboard.native ? nativeKeyboard.inset : bottomInset) + 118 }}>{toast}{undo && <button type="button" onClick={() => { setData(current => restoreDeletedRecord(current, undo)); setUndo(null); setToast("已恢复删除的记录"); }}>撤销删除</button>}</div> : null}
    </>
  );
}
