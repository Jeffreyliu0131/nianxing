const MAX_STATE_BYTES = 900_000;
const MAX_REQUEST_BYTES = 16_384;
const AI_RATE_LIMIT = 20;
const VALID_SOURCES = new Set(["seed", "local", "deepseek", "manual"]);

function apiJson(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function safeString(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeIso(value, fallback = "") {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function safeTags(value) {
  return Array.isArray(value)
    ? value.map((tag) => safeString(tag, 24)).filter(Boolean).slice(0, 5)
    : [];
}

function normalizeTask(value) {
  const id = safeString(value?.id, 160);
  const title = safeString(value?.title, 180);
  const scheduledAt = safeIso(value?.scheduledAt);
  const createdAt = safeIso(value?.createdAt);
  const updatedAt = safeIso(value?.updatedAt, createdAt);
  if (!id || !title || !scheduledAt || !createdAt || !updatedAt) return null;
  const duration = Number(value?.durationMinutes);
  return {
    id,
    title,
    scheduledAt,
    ...(Number.isFinite(duration) ? { durationMinutes: Math.min(480, Math.max(5, Math.round(duration))) } : {}),
    status: value?.status === "done" ? "done" : "open",
    ...(safeString(value?.notes, 800) ? { notes: safeString(value.notes, 800) } : {}),
    tags: safeTags(value?.tags),
    source: VALID_SOURCES.has(value?.source) ? value.source : "manual",
    createdAt,
    updatedAt,
  };
}

function normalizeIdea(value) {
  const id = safeString(value?.id, 160);
  const title = safeString(value?.title, 180);
  const createdAt = safeIso(value?.createdAt);
  const updatedAt = safeIso(value?.updatedAt, createdAt);
  if (!id || !title || !createdAt || !updatedAt) return null;
  const status = ["inbox", "exploring", "archived"].includes(value?.status) ? value.status : "inbox";
  return {
    id,
    title,
    kind: value?.kind === "learning" ? "learning" : "idea",
    ...(safeString(value?.notes, 800) ? { notes: safeString(value.notes, 800) } : {}),
    tags: safeTags(value?.tags),
    status,
    source: VALID_SOURCES.has(value?.source) ? value.source : "manual",
    createdAt,
    updatedAt,
  };
}

function normalizeDeleted(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 5_000)
      .map(([id, deletedAt]) => [safeString(id, 160), safeIso(deletedAt)])
      .filter(([id, deletedAt]) => id && deletedAt),
  );
}

function normalizeAppData(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.tasks) || !Array.isArray(value.ideas)) return null;
  if (value.tasks.length > 2_000 || value.ideas.length > 4_000) return null;
  const tasks = value.tasks.map(normalizeTask).filter(Boolean);
  const ideas = value.ideas.map(normalizeIdea).filter(Boolean);
  if (tasks.length !== value.tasks.length || ideas.length !== value.ideas.length) return null;
  return {
    schemaVersion: 2,
    tasks,
    ideas,
    deleted: {
      tasks: normalizeDeleted(value.deleted?.tasks),
      ideas: normalizeDeleted(value.deleted?.ideas),
    },
  };
}

function readUser(request) {
  const id = safeString(request.headers.get("oai-authenticated-user-id"), 512);
  if (!id) return null;
  const email = safeString(request.headers.get("oai-authenticated-user-email"), 320);
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let displayName = "";
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try {
      displayName = safeString(decodeURIComponent(encodedName), 120);
    } catch {
      displayName = "";
    }
  }
  return { id, email, displayName };
}

function publicUser(user) {
  return {
    id: user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(user.displayName ? { displayName: user.displayName } : {}),
  };
}

function aiConfigured(env) {
  return Boolean(safeString(env.DEEPSEEK_API_KEY, 8_192));
}

function statePayload(data, revision, updatedAt, user, env) {
  return {
    data,
    revision,
    updatedAt,
    aiConfigured: aiConfigured(env),
    user: publicUser(user),
  };
}

async function loadUserState(db, userId) {
  const row = await db.prepare(
    "SELECT payload, revision, updated_at FROM user_states WHERE user_id = ? LIMIT 1",
  ).bind(userId).first();
  if (!row) return { data: null, revision: 0, updatedAt: null };
  const data = normalizeAppData(JSON.parse(row.payload));
  if (!data) throw new Error("INVALID_STORED_STATE");
  return {
    data,
    revision: Number(row.revision) || 0,
    updatedAt: safeIso(row.updated_at) || null,
  };
}

async function readRequestJson(request, maxBytes = MAX_REQUEST_BYTES) {
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(raw);
}

async function getState(request, env, user) {
  if (!env.DB) return apiJson({ error: "STORAGE_NOT_CONFIGURED" }, 503);
  try {
    const current = await loadUserState(env.DB, user.id);
    return apiJson(statePayload(current.data, current.revision, current.updatedAt, user, env));
  } catch {
    return apiJson({ error: "STORAGE_UNAVAILABLE" }, 503);
  }
}

async function putState(request, env, user) {
  if (!env.DB) return apiJson({ error: "STORAGE_NOT_CONFIGURED" }, 503);
  try {
    const payload = await readRequestJson(request, MAX_STATE_BYTES);
    const baseRevision = Number(payload?.baseRevision);
    const data = normalizeAppData(payload?.data);
    if (!Number.isInteger(baseRevision) || baseRevision < 0 || !data) {
      return apiJson({ error: "INVALID_STATE" }, 400);
    }
    const serialized = JSON.stringify(data);
    if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
      return apiJson({ error: "STATE_TOO_LARGE" }, 413);
    }

    const updatedAt = new Date().toISOString();
    let result;
    if (baseRevision === 0) {
      result = await env.DB.prepare(
        `INSERT INTO user_states
          (user_id, user_email, display_name, schema_version, payload, revision, created_at, updated_at)
         VALUES (?, ?, ?, 2, ?, 1, ?, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      ).bind(user.id, user.email || null, user.displayName || null, serialized, updatedAt, updatedAt).run();
    } else {
      result = await env.DB.prepare(
        `UPDATE user_states
         SET user_email = ?, display_name = ?, schema_version = 2, payload = ?, revision = revision + 1, updated_at = ?
         WHERE user_id = ? AND revision = ?`,
      ).bind(user.email || null, user.displayName || null, serialized, updatedAt, user.id, baseRevision).run();
    }

    if (!result?.success || Number(result.meta?.changes || 0) !== 1) {
      const current = await loadUserState(env.DB, user.id);
      return apiJson(statePayload(current.data, current.revision, current.updatedAt, user, env), 409);
    }
    return apiJson(statePayload(data, baseRevision + 1, updatedAt, user, env));
  } catch (error) {
    if (error?.message === "PAYLOAD_TOO_LARGE") return apiJson({ error: "STATE_TOO_LARGE" }, 413);
    return apiJson({ error: "STORAGE_UNAVAILABLE" }, 503);
  }
}

function normalizeOrganizerItem(item) {
  const kind = ["task", "idea", "learning"].includes(item?.kind) ? item.kind : "idea";
  const title = safeString(item?.title, 180);
  if (!title) return null;
  const parsedDate = typeof item?.scheduledAt === "string" ? Date.parse(item.scheduledAt) : Number.NaN;
  const duration = Number(item?.durationMinutes);
  return {
    kind,
    title,
    scheduledAt: kind === "task" && Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
    durationMinutes: kind === "task" && Number.isFinite(duration)
      ? Math.min(480, Math.max(5, Math.round(duration)))
      : null,
    notes: safeString(item?.notes, 800) || null,
    tags: safeTags(item?.tags),
  };
}

function organizerPrompt({ now, timezone, locale }) {
  return `你是个人行动与灵感整理器。把用户的一句话拆成最少、可执行的结构化条目。当前时间：${now}；时区：${timezone}；语言：${locale}。

只输出 JSON，不要 Markdown。JSON 结构必须是：
{"items":[{"kind":"task|idea|learning","title":"简洁标题","scheduledAt":"ISO 8601 或 null","durationMinutes":30,"notes":null,"tags":[]}]}

规则：
1. 有明确行动承诺、日期或提醒的是 task；纯想法是 idea；要了解、研究或保存资料但未承诺时间的是 learning。
2. 一句话同时包含行动和资料保存时可拆成两条，最多 4 条。
3. 相对日期按当前时间和时区解析。未给具体时间的 task 选择合理时间；不要捏造地点或人物。
4. 标题删除“提醒我、我想、帮我”等口语壳，保留用户原意。
5. durationMinutes 取 5 到 480 的合理值；非 task 使用 null。`;
}

async function allowAiRequest(env, userId, ctx) {
  const windowStart = Math.floor(Date.now() / 60_000);
  const row = await env.DB.prepare(
    `INSERT INTO ai_rate_limits (user_id, window_start, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id, window_start)
     DO UPDATE SET request_count = request_count + 1
     RETURNING request_count`,
  ).bind(userId, windowStart).first();
  if (ctx?.waitUntil && Number(row?.request_count) === 1) {
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM ai_rate_limits WHERE window_start < ?").bind(windowStart - 10_080).run().catch(() => undefined),
    );
  }
  return Number(row?.request_count || 0) <= AI_RATE_LIMIT;
}

async function callDeepSeek(env, input) {
  const model = safeString(env.DEEPSEEK_MODEL, 120) || "deepseek-v4-flash";
  const baseUrl = (safeString(env.DEEPSEEK_BASE_URL, 300) || "https://api.deepseek.com").replace(/\/$/, "");
  const body = {
    model,
    messages: [
      { role: "system", content: organizerPrompt(input) },
      { role: "user", content: `请整理为 json：${input.text}` },
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
        authorization: `Bearer ${safeString(env.DEEPSEEK_API_KEY, 8_192)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (response.status >= 500 && attempt === 0) continue;
      throw new Error(`DEEPSEEK_${response.status}`);
    }
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (content?.trim()) return { model, value: JSON.parse(content) };
  }
  throw new Error("EMPTY_MODEL_RESPONSE");
}

async function organize(request, env, user, ctx) {
  if (!aiConfigured(env)) return apiJson({ error: "AI_NOT_CONFIGURED" }, 503);
  if (!env.DB) return apiJson({ error: "STORAGE_NOT_CONFIGURED" }, 503);
  try {
    if (!(await allowAiRequest(env, user.id, ctx))) return apiJson({ error: "RATE_LIMITED" }, 429);
    const payload = await readRequestJson(request);
    const text = safeString(payload?.text, 4_000);
    if (!text) return apiJson({ error: "TEXT_REQUIRED" }, 400);
    const input = {
      text,
      now: safeIso(payload?.now, new Date().toISOString()),
      timezone: safeString(payload?.timezone, 80) || "Asia/Singapore",
      locale: safeString(payload?.locale, 20) || "zh-CN",
    };
    const result = await callDeepSeek(env, input);
    const items = Array.isArray(result.value?.items)
      ? result.value.items.map(normalizeOrganizerItem).filter(Boolean).slice(0, 4)
      : [];
    if (!items.length) throw new Error("INVALID_MODEL_OUTPUT");
    return apiJson({ source: "deepseek", model: result.model, items });
  } catch (error) {
    if (error?.message === "PAYLOAD_TOO_LARGE") return apiJson({ error: "PAYLOAD_TOO_LARGE" }, 413);
    return apiJson({ error: "ORGANIZE_FAILED" }, 502);
  }
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return apiJson({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  const user = readUser(request);
  if (!user) return apiJson({ error: "SIGN_IN_REQUIRED" }, 401);

  if (url.pathname === "/api/state") {
    // This is an expected-account precondition, never an authentication source.
    const expected = request.headers.get("x-nianxing-account-id");
    if ((request.method === "PUT" && !expected) || (expected && expected !== user.id)) {
      return apiJson({ error: "ACCOUNT_CHANGED" }, 412);
    }
    if (request.method === "GET") return getState(request, env, user);
    if (request.method === "PUT") return putState(request, env, user);
    return apiJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (url.pathname === "/api/organize") {
    if (request.method !== "POST") return apiJson({ error: "METHOD_NOT_ALLOWED" }, 405);
    return organize(request, env, user, ctx);
  }
  return apiJson({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
