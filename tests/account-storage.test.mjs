import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } }, appType: 'custom' });
const local = await server.ssrLoadModule('/src/data/localStore.ts');
const cloud = await server.ssrLoadModule('/src/services/cloudSync.ts');
const recovery = await server.ssrLoadModule('/src/domain/recovery.ts');
await server.close();

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function data(title) {
  return { schemaVersion: 2, tasks: [{ id: 'task', title, scheduledAt: '2026-09-06T00:00:00Z', source: 'manual', status: 'open', tags: [], createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' }], ideas: [], deleted: { tasks: {}, ideas: {} } };
}

test('accounts and guest have distinct local spaces; legacy content is guest-only', () => {
  globalThis.localStorage = storage();
  localStorage.setItem('nianxing.app-data.v1', JSON.stringify(data('legacy guest')));
  assert.equal(local.loadAppData(null).tasks[0].title, 'legacy guest');
  assert.deepEqual(local.loadAppData('B').tasks, []);
  local.saveAppData(data('A private'), 'A');
  local.saveAppData(data('B private'), 'B');
  assert.equal(local.loadAppData('A').tasks[0].title, 'A private');
  assert.equal(local.loadAppData('B').tasks[0].title, 'B private');
  assert.equal(local.loadAppData(null).tasks[0].title, 'legacy guest');
});

test('a write pins its expected account and rejects auth-switch responses', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers['x-nianxing-account-id'], 'A');
      return Response.json({ error: 'ACCOUNT_CHANGED' }, { status: 412 });
    };
    await assert.rejects(cloud.saveCloudSnapshot(data('A private'), 0, 'A'), cloud.CloudAccountChangedError);
  } finally { globalThis.fetch = original; }
});

test('an unauthenticated bootstrap is classified as auth rather than a generic retry', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401 });
    await assert.rejects(cloud.fetchCloudSnapshot(), cloud.CloudAuthError);
  } finally { globalThis.fetch = original; }
});

test('undo survives re-merging the deletion tombstone without removing other records', () => {
  const before = data('restore me');
  const removed = { ...before, tasks: [], deleted: { tasks: { task: '2026-09-05T01:00:00Z' }, ideas: {} } };
  const restored = recovery.restoreDeletedRecord(removed, { kind: 'task', record: before.tasks[0] }, Date.parse('2026-09-05T00:00:00Z'));
  assert.equal(cloud.mergeAppData(restored, removed).tasks[0].title, 'restore me');
  assert.equal(recovery.restoreDeletedRecord(restored, { kind: 'task', record: before.tasks[0] }).tasks.length, 1);
});
