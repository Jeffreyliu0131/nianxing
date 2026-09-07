import { createServer } from "node:http";

const port = Number(process.env.PORT || 8787);
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "");
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const rateWindow = new Map();

function json(response, status, body, origin) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function allowRequest(ip) {
  const now = Date.now();
  const current = rateWindow.get(ip);
  if (!current || now - current.startedAt > 60_000) {
    rateWindow.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}

function safeString(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeItem(item) {
  const kind = ["task", "idea", "learning"].includes(item?.kind) ? item.kind : "idea";
  const title = safeString(item?.title, 180);
  if (!title) return null;
  const parsedDate = typeof item?.scheduledAt === "string" ? Date.parse(item.scheduledAt) : Number.NaN;
  const duration = typeof item?.durationMinutes === "number" ? item?.durationMinutes : Number.NaN;
  return {
    kind,
    title,
    scheduledAt: kind === "task" && Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
    durationMinutes:
      kind === "task" && Number.isFinite(duration) ? Math.min(480, Math.max(5, Math.round(duration))) : null,
    notes: safeString(item?.notes, 800) || null,
    tags: Array.isArray(item?.tags)
      ? item.tags.map((tag) => safeString(tag, 24)).filter(Boolean).slice(0, 5)
      : [],
  };
}

function systemPrompt({ now, timezone, locale }) {
  return `你是个人行动与灵感整理器。把用户的一句话拆成最少、可执行的结构化条目。当前时间：${now}；时区：${timezone}；语言：${locale}。

只输出 JSON，不要 Markdown。JSON 结构必须是：
{"items":[{"kind":"task|idea|learning","title":"简洁标题","scheduledAt":"ISO 8601 或 null","durationMinutes":30,"notes":null,"tags":[]}]}

规则：
1. 有明确行动承诺、日期或提醒的是 task；纯想法是 idea；要了解、研究或保存资料但未承诺时间的是 learning。
2. 一句话同时包含行动和资料保存时可拆成两条，最多 4 条。
3. 相对日期按当前时间和时区解析。未给具体时间的 task 选择合理时间；不要捏造地点或人物。
4. 标题删除“提醒我、我想、帮我”等口语壳，保留用户原意。
5. 用户没有明确时长时 durationMinutes 使用 null；明确时长取 5 到 480；非 task 使用 null。不得把没有日期或时间的任务自动安排到某个时刻。`;
}

async function callDeepSeek(payload) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt(payload) },
      { role: "user", content: `请整理为 json：${payload.text}` },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    temperature: 0.1,
    max_tokens: 1200,
    stream: false,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`DEEPSEEK_${response.status}:${detail}`);
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (content?.trim()) return JSON.parse(content);
  }
  throw new Error("EMPTY_MODEL_RESPONSE");
}

createServer(async (request, response) => {
  const origin = request.headers.origin;
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return json(response, 403, { error: "ORIGIN_NOT_ALLOWED" });
    response.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "Origin",
    });
    return response.end();
  }

  if (url.pathname === "/health" && request.method === "GET") {
    return json(response, 200, { ok: true, configured: Boolean(apiKey), model }, origin);
  }

  if (url.pathname !== "/api/organize" || request.method !== "POST") {
    return json(response, 404, { error: "NOT_FOUND" }, origin);
  }
  if (origin && !allowedOrigins.has(origin)) return json(response, 403, { error: "ORIGIN_NOT_ALLOWED" });
  if (!apiKey) return json(response, 503, { error: "AI_NOT_CONFIGURED" }, origin);
  if (!allowRequest(request.socket.remoteAddress || "unknown")) {
    return json(response, 429, { error: "RATE_LIMITED" }, origin);
  }

  try {
    const payload = await readJson(request);
    const text = safeString(payload?.text, 4_000);
    if (!text) return json(response, 400, { error: "TEXT_REQUIRED" }, origin);
    const context = {
      text,
      now: safeString(payload?.now, 60) || new Date().toISOString(),
      timezone: safeString(payload?.timezone, 80) || "Asia/Singapore",
      locale: safeString(payload?.locale, 20) || "zh-CN",
    };
    const raw = await callDeepSeek(context);
    const items = Array.isArray(raw?.items) ? raw.items.map(normalizeItem).filter(Boolean).slice(0, 4) : [];
    if (!items.length) throw new Error("INVALID_MODEL_OUTPUT");
    return json(response, 200, { source: "deepseek", model, items }, origin);
  } catch (error) {
    const code = error?.message === "PAYLOAD_TOO_LARGE" ? 413 : 502;
    return json(response, code, { error: code === 413 ? "PAYLOAD_TOO_LARGE" : "ORGANIZE_FAILED" }, origin);
  }
}).listen(port, () => {
  console.log(`DeepSeek organizer proxy listening on http://localhost:${port}`);
});
