import { addLocalDays, atLocalTime } from "./date";
import { createId, type CaptureKind, type DraftCapture, type OrganizerResult } from "./types";

const ACTION_WORDS = /提醒|记得|完成|做完|去做|安排|提交|联系|打电话|购买|买|整理|撰写|写|跑步|运动|开会|处理|预约|复盘/;
const IDEA_WORDS = /灵感|想法|点子|idea|突然想到|脑洞|也许可以|产品方向/i;
const LEARNING_WORDS = /学习|了解|研究|教程|资料|怎么|为什么|问一下|阅读|读完|弄懂|探索/;
const NUMBER_TOKEN_SOURCE = "(?:\\d{1,4}|[零〇一二两三四五六七八九十百]{1,6})";
const DAY_WORDS = /今天|今晚|明天|明早|大后天|后天|下周[一二三四五六日天]?|本周[一二三四五六日天]|周[一二三四五六日天]/;
const EXPLICIT_DATE_PATTERN = new RegExp(`(?:(\\d{4})\\s*年\\s*)?(${NUMBER_TOKEN_SOURCE})\\s*(?:月|[\\/-])\\s*(${NUMBER_TOKEN_SOURCE})\\s*(?:日|号)?`);
const TIME_PATTERN = new RegExp(`(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚)?\\s*(${NUMBER_TOKEN_SOURCE})(?:[:：点时])(?:\\s*(半|${NUMBER_TOKEN_SOURCE})\\s*分?)?`);
const DURATION_MINUTES_PATTERN = new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s*分钟`);
const DURATION_HOURS_PATTERN = new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s*(?:个)?\\s*(半)?\\s*小时(?:半)?`);

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseNumberToken(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const hundredIndex = value.indexOf("百");
  if (hundredIndex >= 0) {
    const hundreds = hundredIndex === 0 ? 1 : CHINESE_DIGITS[value[hundredIndex - 1]] || 0;
    const rest = value.slice(hundredIndex + 1);
    return hundreds * 100 + (rest ? parseNumberToken(rest) : 0);
  }
  const tenIndex = value.indexOf("十");
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : CHINESE_DIGITS[value[tenIndex - 1]] || 0;
    const rest = value.slice(tenIndex + 1);
    return tens * 10 + (rest ? parseNumberToken(rest) : 0);
  }
  return [...value].reduce((total, character) => total * 10 + (CHINESE_DIGITS[character] ?? 0), 0);
}

function hasExplicitDay(text: string) {
  return DAY_WORDS.test(text) || EXPLICIT_DATE_PATTERN.test(text);
}

function findDay(text: string, now: Date) {
  const explicit = text.match(EXPLICIT_DATE_PATTERN);
  if (explicit) {
    const explicitYear = explicit[1] ? Number(explicit[1]) : null;
    const month = parseNumberToken(explicit[2]);
    const day = parseNumberToken(explicit[3]);
    const candidate = new Date(explicitYear || now.getFullYear(), month - 1, day);
    const valid = candidate.getMonth() === month - 1 && candidate.getDate() === day;
    if (valid) {
      if (!explicitYear && candidate < addLocalDays(now, 0)) candidate.setFullYear(candidate.getFullYear() + 1);
      return candidate;
    }
  }

  if (/大后天/.test(text)) return addLocalDays(now, 3);
  if (/后天/.test(text)) return addLocalDays(now, 2);
  if (/明天|明早/.test(text)) return addLocalDays(now, 1);

  const nextWeekday = text.match(/下周([一二三四五六日天])/);
  if (nextWeekday) {
    const index = "一二三四五六日".indexOf(nextWeekday[1]);
    const mondayOffset = -((now.getDay() + 6) % 7);
    return addLocalDays(now, mondayOffset + 7 + index);
  }
  if (/下周/.test(text)) return addLocalDays(now, 7);

  const thisWeekday = text.match(/本周([一二三四五六日天])/);
  if (thisWeekday) {
    const index = "一二三四五六日".indexOf(thisWeekday[1]);
    const mondayOffset = -((now.getDay() + 6) % 7);
    const candidate = addLocalDays(now, mondayOffset + index);
    return candidate < addLocalDays(now, 0) ? addLocalDays(candidate, 7) : candidate;
  }

  const weekday = text.match(/周([一二三四五六日天])/);
  if (weekday) {
    const index = "一二三四五六日".indexOf(weekday[1]) + 1;
    const target = index === 7 ? 0 : index;
    const current = now.getDay();
    const delta = (target - current + 7) % 7 || 7;
    return addLocalDays(now, delta);
  }
  return addLocalDays(now, 0);
}

function findTime(text: string, hasExplicitDay: boolean) {
  const match = text.match(TIME_PATTERN);
  if (match) {
    const period = match[1] || "";
    let hour = Math.min(23, parseNumberToken(match[2]));
    const minute = Math.min(59, match[3] === "半" ? 30 : parseNumberToken(match[3] || "零"));
    if (/下午|傍晚|晚上|今晚/.test(period) && hour < 12) hour += 12;
    if (/中午/.test(period) && hour < 11) hour += 12;
    if (/凌晨/.test(period) && hour === 12) hour = 0;
    return { hour, minute };
  }
  if (/明早|早上|上午/.test(text)) return { hour: 9, minute: 0 };
  if (/中午/.test(text)) return { hour: 12, minute: 0 };
  if (/下午/.test(text)) return { hour: 14, minute: 0 };
  if (/傍晚/.test(text)) return { hour: 18, minute: 0 };
  if (/今晚|晚上/.test(text)) return { hour: 20, minute: 0 };
  return hasExplicitDay ? { hour: 9, minute: 0 } : null;
}

function findDuration(text: string) {
  const minutes = text.match(DURATION_MINUTES_PATTERN);
  if (minutes) return Math.min(480, Math.max(5, parseNumberToken(minutes[1])));
  const decimalHours = text.match(/(\d(?:\.\d)?)\s*(?:个)?小时/);
  if (decimalHours) return Math.min(480, Math.max(5, Math.round(Number(decimalHours[1]) * 60)));
  const hours = text.match(DURATION_HOURS_PATTERN);
  if (hours) {
    const extraHalf = Boolean(hours[2]) || /小时半/.test(hours[0]);
    return Math.min(480, Math.max(5, parseNumberToken(hours[1]) * 60 + (extraHalf ? 30 : 0)));
  }
  if (/半(?:个)?小时/.test(text)) return 30;
  return 30;
}

function cleanTitle(text: string) {
  const title = text
    .replace(/^(?:帮我|请|麻烦)?\s*(?:记录一下|记一下|记住|提醒我|我想|想要|我要)\s*/i, "")
    .replace(DAY_WORDS, "")
    .replace(EXPLICIT_DATE_PATTERN, "")
    .replace(TIME_PATTERN, "")
    .replace(DURATION_MINUTES_PATTERN, "")
    .replace(DURATION_HOURS_PATTERN, "")
    .replace(/半(?:个)?小时/, "")
    .replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (title || text.trim()).slice(0, 180);
}

function inferKind(text: string): CaptureKind {
  const hasDate = hasExplicitDay(text) || TIME_PATTERN.test(text);
  if (hasDate || ACTION_WORDS.test(text)) return "task";
  if (LEARNING_WORDS.test(text)) return "learning";
  if (IDEA_WORDS.test(text)) return "idea";
  return "idea";
}

function inferTags(text: string) {
  const candidates = ["DeepSeek", "PWA", "AI", "产品", "学习", "工作", "健康"];
  return candidates.filter((tag) => text.toLowerCase().includes(tag.toLowerCase())).slice(0, 4);
}

function makeDraft(text: string, now: Date, forcedKind?: CaptureKind): DraftCapture {
  const kind = forcedKind || inferKind(text);
  const explicitDay = hasExplicitDay(text);
  const time = kind === "task" ? findTime(text, explicitDay) : null;
  const scheduled = time ? atLocalTime(findDay(text, now), time.hour, time.minute).toISOString() : null;
  return {
    clientId: createId("draft"),
    kind,
    title: cleanTitle(text),
    scheduledAt: scheduled,
    durationMinutes: kind === "task" ? findDuration(text) : null,
    notes: null,
    tags: inferTags(text),
  };
}

export function organizeLocally(text: string, now = new Date()): OrganizerResult {
  const segments = text.split(/顺便|同时|另外|并且/).map((part) => part.trim()).filter(Boolean);
  const canSplit = segments.length > 1 && segments.length <= 3;
  const items = canSplit
    ? segments.map((segment, index) => {
        const shouldInheritDay = index > 0 && !DAY_WORDS.test(segment) && DAY_WORDS.test(text) && !IDEA_WORDS.test(segment);
        const contextual = shouldInheritDay ? `${text.match(DAY_WORDS)?.[0] || ""}${segment}` : segment;
        return makeDraft(contextual, now);
      })
    : [makeDraft(text, now)];
  return { source: "local", items };
}
