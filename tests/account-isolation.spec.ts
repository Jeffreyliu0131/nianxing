import { expect, test } from "@playwright/test";

test("switching accounts keeps local records separate and never uploads A records to B", async ({ page }) => {
  let account = "A";
  const puts: { account: string; titles: string[] }[] = [];
  const now = new Date().toISOString();
  const empty = { schemaVersion: 2, tasks: [], ideas: [], deleted: { tasks: {}, ideas: {} } };
  const a = { ...empty, tasks: [{ id: "A-task", title: "Synthetic A private task", source: "manual", status: "open", tags: [], scheduledAt: now, createdAt: now, updatedAt: now }] };
  await page.route("**/api/state", async route => {
    const expected = route.request().headers()["x-nianxing-account-id"];
    if (expected && expected !== account) {
      await route.fulfill({ status: 412, json: { error: "ACCOUNT_CHANGED" } }); return;
    }
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      puts.push({ account, titles: payload.data.tasks.map((task: { title: string }) => task.title) });
    }
    await route.fulfill({ json: { user: { id: account, email: `${account}@example.test` }, revision: 1, updatedAt: now, aiConfigured: false, data: account === "A" ? a : empty } });
  });
  await page.goto("/");
  await expect(page.getByText("Synthetic A private task", { exact: true })).toBeVisible();
  account = "B";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Synthetic A private task", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nianxing.account.B.v2") || "null")?.tasks?.length)).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nianxing.account.A.v2")!).tasks[0].title)).toBe("Synthetic A private task");
  expect(puts.filter(write => write.account === "B").flatMap(write => write.titles)).not.toContain("Synthetic A private task");
});
