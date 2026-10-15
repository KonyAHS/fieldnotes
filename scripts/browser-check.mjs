import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const base = process.env.TEST_URL || "http://localhost:3096";
await mkdir("test-results", { recursive: true });
const original = await fetch(base + "/api/workspace").then((r) => r.json());
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1470, height: 980 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function ready(p) {
  await p.goto(base);
  await expect(
    p.getByRole("heading", { name: "Sample trip: Japan and Korea" }),
  ).toBeVisible();
  await p.evaluate(() =>
    navigator.serviceWorker.ready.then(
      () =>
        new Promise((resolve) => {
          if (navigator.serviceWorker.controller) resolve();
          else
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              resolve,
              { once: true },
            );
        }),
    ),
  );
}
async function add(p, title) {
  await p.getByRole("button", { name: "Add plan", exact: true }).click();
  await p.getByLabel("Title", { exact: true }).fill(title);
  await p.getByRole("button", { name: "Save plan", exact: true }).click();
}
try {
  await ready(page);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  let puts = 0,
    concurrent = 0,
    maxConcurrent = 0;
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "PUT") {
      puts++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 1400));
      await route.fulfill({ response });
      concurrent--;
      return;
    }
    await route.continue();
  });
  const started = Date.now();
  await add(page, "Slow-save museum");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".event-card").filter({ hasText: "Slow-save museum" }),
  ).toBeVisible();
  const visibleMs = Date.now() - started;
  await page
    .getByRole("button", { name: "Scenarios", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "A little room for possibility" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Itinerary", exact: true }).click();
  await expect.poll(() => puts, { timeout: 5000 }).toBe(1);
  await add(page, "Queued next stop");
  await expect(
    page.locator(".event-card").filter({ hasText: "Queued next stop" }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Synced", {
    timeout: 15000,
  });
  const after = await fetch(base + "/api/workspace").then((r) => r.json());
  expect(
    after.data.trips[0].scenarios[0].entries.some(
      (e) => e.title === "Slow-save museum",
    ),
  ).toBe(true);
  expect(
    after.data.trips[0].scenarios[0].entries.some(
      (e) => e.title === "Queued next stop",
    ),
  ).toBe(true);
  expect(puts).toBe(2);
  expect(maxConcurrent).toBe(1);
  console.log(
    "Slow-save navigation and serialized rapid edits pass; visible cycle",
    visibleMs,
    "ms; PUTs",
    puts,
  );
  await page.unroute("**/api/workspace");
  await page.route("**/api/workspace", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Simulated unavailable" } })
      : route.continue(),
  );
  await add(page, "Retry after failure");
  await expect(page.locator(".save-status")).toHaveText("Saved on device", {
    timeout: 15000,
  });
  await page.unroute("**/api/workspace");
  await context.setOffline(true);
  await add(page, "Offline museum");
  await page.waitForTimeout(200);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sample trip: Japan and Korea" }),
  ).toBeVisible();
  await expect(
    page.locator(".event-card").filter({ hasText: "Offline museum" }),
  ).toBeVisible();
  await expect(
    page.locator(".event-card").filter({ hasText: "Retry after failure" }),
  ).toBeVisible();
  console.log("Failed save, durable offline edit and offline reload pass");
  const second = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const p2 = await second.newPage();
  await ready(p2);
  await add(p2, "Second device");
  await expect(p2.locator(".save-status")).toHaveText("Synced", {
    timeout: 15000,
  });
  await context.setOffline(false);
  console.log(
    "Reconnected:",
    await page.evaluate(async () => ({
      online: navigator.onLine,
      api: await fetch("/api/health")
        .then((r) => r.status)
        .catch((e) => e.message),
    })),
  );
  await expect(page.locator(".save-status")).toHaveText("Sync conflict", {
    timeout: 30000,
  });
  await page.locator(".save-status").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Use this device’s copy" }).click();
  const download = await downloadPromise;
  await download.saveAs("test-results/conflict-backup.json");
  await expect(page.locator(".save-status")).toHaveText("Synced", {
    timeout: 15000,
  });
  const synced = await fetch(base + "/api/workspace").then((r) => r.json());
  expect(
    synced.data.trips[0].scenarios[0].entries.some(
      (e) => e.title === "Offline museum",
    ),
  ).toBe(true);
  console.log("Two-device conflict and explicit resolution with backup pass");
  await second.close();
  await page.getByRole("button", { name: "Japan visa", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Schedule of Stay" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: "test-results/japan-schedule.pdf",
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  expect(await page.locator("#visa-document tbody tr").count()).toBe(14);
  console.log("Japan-only visa export and PDF render pass");
  await page
    .getByRole("button", { name: "Places & food", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved places" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filter country" })
    .selectOption("Korea");
  expect(await page.locator(".place-card").count()).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/places.png", fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Clay", exact: false }).click();
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
  ).toBe("clay");
  await page.getByRole("button", { name: "Sage", exact: false }).click();
  await page
    .getByRole("button", { name: "Import reservations", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirmation text" }).click();
  await page
    .getByLabel("Paste the confirmation")
    .fill(
      "Hotel: Browser hotel\nCheck-in: 2026-10-29\nCheck-out: 2026-11-01\nAddress: 1-2 Tokyo\nPhone: +81 123\nConfirmation: ABC123",
    );
  await page.getByRole("button", { name: "Preview details" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Browser hotel",
  );
  await expect(
    page.getByRole("button", { name: "Import 1 reservations" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  console.log("Places filtering, themes and confirmation preview pass");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mobile.newPage();
  await ready(mp);
  expect(await mp.locator(".agenda").count()).toBe(1);
  await mp.screenshot({ path: "test-results/mobile.png", fullPage: false });
  expect(
    await mp.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mp.getByRole("button", { name: "Add plan", exact: true }).click();
  await expect(mp.getByLabel("Title", { exact: true })).toBeVisible();
  expect(
    await mp
      .getByRole("dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await mp.getByRole("button", { name: "Close dialog" }).click();
  await mp.getByRole("button", { name: "Open navigation" }).click();
  await mp.getByRole("button", { name: "Japan visa", exact: true }).click();
  expect(
    await mp.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mobile.close();
  console.log("Phone agenda, modal, navigation and export layout pass");
  expect(errors).toEqual([]);
  console.log("No unhandled browser errors");
} finally {
  await browser.close();
  const current = await fetch(base + "/api/workspace").then((r) => r.json());
  const result = await fetch(base + "/api/workspace", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": String(current.revision),
    },
    body: JSON.stringify({ data: original.data }),
  });
  if (!result.ok)
    throw Error("Could not restore isolated browser-test workspace");
}
