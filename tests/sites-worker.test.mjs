import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.startsWith("SELECT payload, revision, updated_at FROM user_states")) {
      return this.database.states.get(this.values[0]) || null;
    }
    if (this.sql.startsWith("INSERT INTO ai_rate_limits")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      const requestCount = (this.database.rates.get(key) || 0) + 1;
      this.database.rates.set(key, requestCount);
      return { request_count: requestCount };
    }
    throw new Error(`Unhandled first(): ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO user_states")) {
      const [userId, userEmail, displayName, payload, createdAt, updatedAt] = this.values;
      if (this.database.states.has(userId)) return { success: true, meta: { changes: 0 } };
      this.database.states.set(userId, {
        payload,
        revision: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        user_email: userEmail,
        display_name: displayName,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE user_states")) {
      const [userEmail, displayName, payload, updatedAt, userId, baseRevision] = this.values;
      const current = this.database.states.get(userId);
      if (!current || current.revision !== baseRevision) return { success: true, meta: { changes: 0 } };
      this.database.states.set(userId, {
        ...current,
        payload,
        revision: current.revision + 1,
        updated_at: updatedAt,
        user_email: userEmail,
        display_name: displayName,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM ai_rate_limits")) return { success: true, meta: { changes: 0 } };
    throw new Error(`Unhandled run(): ${this.sql}`);
  }
}

class FakeD1 {
  constructor() {
    this.states = new Map();
    this.rates = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function assets() {
  return {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      return new Response(pathname === "/index.html" ? "app" : "missing", {
        status: pathname === "/index.html" ? 200 : 404,
      });
    },
  };
}

function authHeaders(userId, email = `${userId}@example.test`) {
  return {
    "oai-authenticated-user-id": userId,
    "oai-authenticated-user-email": email,
  };
}

function sampleData(title = "测试云同步") {
  const now = "2026-08-15T01:00:00.000Z";
  return {
    schemaVersion: 2,
    tasks: [{
      id: "task_test",
      title,
      scheduledAt: "2026-08-16T01:00:00.000Z",
      durationMinutes: 30,
      status: "open",
      tags: ["测试"],
      source: "manual",
      createdAt: now,
      updatedAt: now,
    }],
    ideas: [],
    deleted: { tasks: {}, ideas: {} },
  };
}

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  const api = await worker.fetch(
    new Request("https://example.test/api/missing", { headers: authHeaders("user-a") }),
    { ASSETS: assets(), DB: new FakeD1() },
  );
  assert.equal(api.status, 404);

  let calls = 0;
  const write = await worker.fetch(new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => { calls += 1; return new Response("missing", { status: 404 }); } },
  });
  assert.equal(write.status, 404);
  assert.equal(calls, 1);
});

test("requires a signed-in Sites identity for every API route", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/state"), { ASSETS: assets(), DB: new FakeD1() });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "SIGN_IN_REQUIRED");
});

test("stores state by user and rejects stale revisions", async () => {
  const database = new FakeD1();
  const env = { ASSETS: assets(), DB: database };
  const initial = sampleData();
  const created = await worker.fetch(new Request("https://example.test/api/state", {
    method: "PUT",
    headers: { ...authHeaders("user-a"), "x-nianxing-account-id": "user-a", "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: 0, data: initial }),
  }), env);
  assert.equal(created.status, 200);
  assert.equal((await created.json()).revision, 1);

  const ownState = await worker.fetch(new Request("https://example.test/api/state", { headers: authHeaders("user-a") }), env);
  const ownPayload = await ownState.json();
  assert.equal(ownPayload.data.tasks[0].title, "测试云同步");
  assert.equal(ownPayload.revision, 1);

  const otherState = await worker.fetch(new Request("https://example.test/api/state", { headers: authHeaders("user-b") }), env);
  assert.equal((await otherState.json()).data, null);

  const stale = await worker.fetch(new Request("https://example.test/api/state", {
    method: "PUT",
    headers: { ...authHeaders("user-a"), "x-nianxing-account-id": "user-a", "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: 0, data: sampleData("不应覆盖") }),
  }), env);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).data.tasks[0].title, "测试云同步");

  const updated = await worker.fetch(new Request("https://example.test/api/state", {
    method: "PUT",
    headers: { ...authHeaders("user-a"), "x-nianxing-account-id": "user-a", "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: 1, data: sampleData("已安全更新") }),
  }), env);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).revision, 2);
});

test("keeps DeepSeek disabled until a server secret exists", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/organize", {
    method: "POST",
    headers: { ...authHeaders("user-a"), "x-nianxing-account-id": "user-a", "content-type": "application/json" },
    body: JSON.stringify({ text: "明天学习 PWA" }),
  }), { ASSETS: assets(), DB: new FakeD1() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "AI_NOT_CONFIGURED");
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0000_rich_frank_castle.sql", import.meta.url));
});

test("rejects stale-account writes before touching a different user's state", async () => {
  const env = { ASSETS: assets(), DB: new FakeD1() };
  for (const expected of [undefined, "user-a"]) {
    const response = await worker.fetch(new Request("https://example.test/api/state", {
      method: "PUT", headers: { ...authHeaders("user-b"), ...(expected ? { "x-nianxing-account-id": expected } : {}), "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: 0, data: sampleData("A private data") }),
    }), env);
    assert.equal(response.status, 412);
    assert.equal((await response.json()).error, "ACCOUNT_CHANGED");
  }
  const state = await worker.fetch(new Request("https://example.test/api/state", { headers: authHeaders("user-b") }), env);
  const payload = await state.json();
  assert.equal(payload.user.id, "user-b");
  assert.equal(payload.data, null);
});


test("unscheduled task and missing duration survive the authenticated state round trip", async () => {
  const db = new FakeD1();
  const data = sampleData('先联系导师');
  data.tasks[0].scheduledAt = null;
  delete data.tasks[0].durationMinutes;
  const env = { DB: db, ASSETS: assets() };
  const response = await worker.fetch(new Request('https://example.test/api/state', {
    method: 'PUT', headers: { ...authHeaders('roundtrip'), 'content-type': 'application/json', 'x-nianxing-account-id': 'roundtrip' },
    body: JSON.stringify({ baseRevision: 0, data }),
  }), env);
  assert.equal(response.status, 200);
  const read = await worker.fetch(new Request('https://example.test/api/state', { headers: authHeaders('roundtrip') }), env);
  const state = await read.json();
  assert.equal(state.data.tasks[0].scheduledAt, null);
  assert.equal(state.data.tasks[0].durationMinutes, undefined);
});
