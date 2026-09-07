import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('review saves only visible values and preserves input written during delayed organization', async ({ page }, testInfo) => {
  let data = { schemaVersion: 2, tasks: [] as Record<string, unknown>[], ideas: [], deleted: { tasks: {}, ideas: {} } };
  let revision = 0;
  await page.route('**/api/state', async route => {
    if (route.request().method() === 'PUT') { data = route.request().postDataJSON().data; revision += 1; }
    await route.fulfill({ json: { user: { id: 'capture-test' }, revision, updatedAt: new Date().toISOString(), aiConfigured: true, data } });
  });
  let release: () => void = () => {};
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/api/organize', async route => {
    started = true;
    await delayed;
    await route.fulfill({ json: { source: 'deepseek', items: [{ kind: 'task', title: '联系导师', scheduledAt: null, durationMinutes: null, notes: '先问可用时间', tags: ['学习'] }] } });
  });
  await page.goto('/?mode=standalone');
  const capture = page.getByRole('textbox', { name: '记录任务或灵感' });
  await expect(page.getByRole('heading', { name: '今日轨道' })).toBeVisible();
  await expect(page.getByRole('button', { name: '已同步', exact: true })).toBeVisible();
  await capture.fill('联系导师');
  await page.getByRole('button', { name: '整理并保存' }).click();
  await expect.poll(() => started).toBe(true);
  await capture.fill('新的独立想法');
  release();
  const review = page.getByRole('dialog');
  await expect(review.getByText('原始输入：联系导师')).toBeVisible();
  await expect(review.getByLabel('安排时间（可留空）')).toHaveValue('');
  await expect(review.getByLabel('预计分钟')).toHaveValue('');
  await expect(review.getByLabel('备注')).toHaveValue('先问可用时间');
  await review.screenshot({ path: testInfo.outputPath('review.png') });
  await review.getByLabel('备注').fill('已核对的备注');
  await review.getByLabel('标签（逗号分隔）').fill('学习,导师');
  await review.getByRole('button', { name: '收下这些记录' }).click();
  await expect(capture).toHaveValue('新的独立想法');
  await expect(page.getByRole('region', { name: '待安排任务' })).toBeVisible();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('nianxing.account.capture-test.v2') || '{}').tasks?.[0]);
  await expect.poll(stored).toMatchObject({ title: '联系导师', scheduledAt: null, notes: '已核对的备注', tags: ['学习', '导师'] });
  expect((await stored()).durationMinutes).toBeUndefined();
  await page.getByRole('button', { name: /^联系导师/ }).click();
  await page.getByRole('dialog').getByLabel('安排时间（可留空）').fill('2026-09-08T14:00');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect.poll(async () => (await stored()).scheduledAt).not.toBeNull();
  await page.reload();
  expect((await stored()).notes).toBe('已核对的备注');
});


test('local capture can be cancelled, saved unplanned, reloaded and restored after deletion', async ({ page }, testInfo) => {
  await page.route('**/api/state', route => route.fulfill({ status: 401, json: { error: 'SIGN_IN_REQUIRED' } }));
  await page.goto('/?mode=standalone');
  const capture = page.getByRole('textbox', { name: '记录任务或灵感' });
  await capture.fill('联系导师');
  await page.getByRole('button', { name: '整理并保存' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(capture).toHaveValue('联系导师');
  await page.getByRole('button', { name: '整理并保存' }).click();
  await page.getByRole('button', { name: '收下这些记录' }).click();
  await expect(capture).toHaveValue('');
  await page.reload();
  const pending = page.getByRole('region', { name: '待安排任务' });
  await expect(pending.getByRole('button', { name: /^联系导师/ })).toBeVisible();
  await pending.screenshot({ path: testInfo.outputPath('unplanned.png') });
  await pending.getByRole('button', { name: /^联系导师/ }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(pending.getByRole('button', { name: /^联系导师/ })).toBeVisible();
});
