import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const dist = path.resolve("dist");

test("production manifest uses only the three required permissions and local assets", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(dist, "manifest.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.permissions.sort(),
    ["activeTab", "scripting", "sidePanel"].sort(),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  for (const file of [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    "content.js",
    ...Object.values(manifest.icons),
  ]) {
    assert.ok((await readFile(path.join(dist, file))).length > 0, file);
  }
  assert.doesNotMatch(
    await readFile(path.join(dist, "content.js"), "utf8"),
    /^import /m,
  );
});

test(
  "browser: inspection, CSSOM restrictions, privacy, panel, lifecycle, and navigation",
  { timeout: 120000 },
  async (t) => {
    const errors = [];
    const folder = await mkdtemp(path.join(tmpdir(), "layr-test-"));
    const extension = dist;
    const server = createServer((request, response) => {
      if (request.url === "/foreign.css") {
        response.setHeader("Content-Type", "text/css");
        response.end(".target { background-color: rgb(31, 41, 61); }");
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html><head><title>Layr browser fixture</title>
      <link rel="stylesheet" href="http://localhost:${server.address().port}/foreign.css">
      <style>
        :root { --fixture-accent: #80adff; }
        body { margin:0; padding:80px; background:#171b24; color:#dae3f7; font:16px sans-serif; min-height:1800px; }
        .target { width:240px; padding:20px; border:2px solid #80adff; color:rgb(128,173,255); display:flex; gap:12px; }
        @media (min-width: 1px) { .target { border-radius:12px; } }
        @media (min-width: 99999px) { .target { font-size:99px; } }
        @supports (display: grid) { .target { box-sizing:border-box; } }
        @layer fixture { .target { letter-spacing:1px; } }
        @container (min-width: 1px) { .target { opacity:.5; } }
        .target { &:hover { text-decoration: underline; } }
        #password-wrap { margin-top:60px; padding:20px; border:1px solid #555; }
        svg { margin-top:35px; }
      </style></head><body>
      <button id="target" class="target alpha" style="font-weight:600" data-purpose="fixture">Inspect this button</button>
      <div id="password-wrap"><input id="password" type="password" value="attribute-secret"><input id="live-password" type="password"></div>
      <a id="link" href="/navigated">A real link</a>
      <div id="duplicates"><span id="duplicate">First</span><span id="duplicate">Second</span></div>
      <svg id="vector" width="100" height="60"><rect id="shape" width="80" height="50" fill="#80adff" /></svg>
      <div id="shadow-host" style="margin-top:30px"></div>
      <iframe id="frame" srcdoc="<button>Inside frame</button>" title="fixture frame"></iframe>
      <script>
        window.pageClicks=0; window.pagePointerDowns=0;
        document.addEventListener('click', () => window.pageClicks++);
        document.addEventListener('pointerdown', () => window.pagePointerDowns++);
        document.getElementById('live-password').value='runtime-secret';
        const root=document.getElementById('shadow-host').attachShadow({mode:'open'});
        root.innerHTML='<style>button{color:rgb(255, 100, 100)}</style><button id="shadow-button">Shadow button</button>';
      </script></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    let context;
    t.after(async () => {
      await context?.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(folder, { recursive: true, force: true });
    });
    context = await chromium.launchPersistentContext(
      path.join(folder, "profile"),
      {
        channel: "chromium",
        headless: true,
        viewport: { width: 1100, height: 850 },
        args: [
          "--enable-unsafe-extension-debugging",
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).hostname;
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.bringToFront();
    const tabId = await worker.evaluate(
      async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
    );
    // Exercise the real toolbar action and activeTab grant, using the unmodified build.
    const browserCdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send("Target.getTargets", {
      filter: [{ type: "tab" }],
    });
    const targetInfo = targetInfos.find((target) => target.url === page.url());
    await browserCdp.send("Extensions.triggerAction", {
      id,
      targetId: targetInfo.targetId,
    });
    const send = (message) =>
      worker.evaluate(
        ({ tabId, message }) =>
          chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
        { tabId, message },
      );
    const inject = () =>
      worker.evaluate(
        (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          }),
        tabId,
      );
    const get = () => send({ type: "LAYR_GET_STATE" });
    const waitFor = async (predicate) => {
      for (let i = 0; i < 60; i++) {
        const state = await get();
        if (predicate(state)) return state;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const last = await get();
      assert.fail(
        `Timed out waiting for inspector state; last selection: ${last.inspection?.tag}#${last.inspection?.id}`,
      );
    };

    for (
      let i = 0;
      i < 60 && !(await page.locator("[data-layr-overlay]").count());
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      (await get()).enabled,
      true,
      "toolbar action activates the unmodified production extension",
    );
    const { targetInfos: openedTargets } = await browserCdp.send(
      "Target.getTargets",
      { filter: [{ exclude: false }] },
    );
    assert.ok(
      openedTargets.some(
        (target) => target.url === `chrome-extension://${id}/sidepanel.html`,
      ),
      "toolbar action opens the real Chrome side panel",
    );
    await send({ type: "LAYR_ENABLE", enabled: false });
    assert.equal((await get()).enabled, false);
    assert.equal(await page.locator("[data-layr-overlay]").count(), 0);
    await send({ type: "LAYR_ENABLE", enabled: true });
    await inject();
    assert.equal(
      await page.locator("[data-layr-overlay]").count(),
      1,
      "reinjection is idempotent",
    );
    await page.locator("#target").hover({ force: true });
    const icon = page.getByRole("button", {
      name: "Inspect element with Layr",
    });
    await icon.waitFor({ state: "visible" });
    const targetBox = await page.locator("#target").boundingBox();
    const iconBox = await icon.boundingBox();
    assert.match(
      await icon.innerText(),
      /button#target/,
      JSON.stringify({ targetBox, iconBox }),
    );
    await page.mouse.move(iconBox.x + 5, targetBox.y + 2);
    await page.mouse.move(iconBox.x + 5, iconBox.y + iconBox.height / 2, {
      steps: 12,
    });
    assert.match(
      await icon.innerText(),
      /button#target/,
      "icon remains stable when crossing its gap",
    );
    await icon.click();
    let state = await waitFor((state) => state.inspection?.id === "target");
    assert.equal(await page.evaluate(() => window.pageClicks), 0);
    assert.equal(await page.evaluate(() => window.pagePointerDowns), 0);
    assert.equal(state.inspection.computed.color, "rgb(128, 173, 255)");
    assert.equal(state.inspection.computed["--fixture-accent"], "#80adff");
    assert.equal(state.inspection.selector, "#target");
    assert.equal(state.inspection.rect.width, 240);
    assert.ok(
      state.inspection.inline.some(
        (item) => item.property === "font-weight" && item.value === "600",
      ),
    );
    assert.ok(
      state.inspection.rules.some((rule) =>
        rule.context.some((context) => context.startsWith("@media")),
      ),
    );
    assert.ok(
      state.inspection.rules.some((rule) =>
        rule.context.some((context) => context.startsWith("@layer")),
      ),
    );
    assert.ok(
      !state.inspection.rules.some((rule) =>
        rule.declarations.some((item) => item.value === "99px"),
      ),
    );
    assert.ok(
      state.inspection.inaccessible.some((origin) =>
        origin.includes("localhost"),
      ),
    );
    assert.ok(
      state.inspection.notes.some((note) => note.includes("@container")),
    );
    assert.ok(state.inspection.notes.some((note) => note.includes("Nested")));
    await page.locator("#link").click({ force: true });
    await waitFor((state) => state.inspection?.id === "link");
    assert.ok(!page.url().includes("/navigated"));

    await page.locator("#password").click({ force: true });
    state = await waitFor((state) => state.inspection?.id === "password");
    assert.ok(!JSON.stringify(state).includes("attribute-secret"));
    assert.ok(
      state.inspection.attributes.some(
        ([key, value]) => key === "value" && value === "[redacted]",
      ),
    );
    await page
      .locator("#password-wrap")
      .click({ force: true, position: { x: 2, y: 2 } });
    state = await waitFor((state) => state.inspection?.id === "password-wrap");
    assert.doesNotMatch(
      JSON.stringify(state),
      /attribute-secret|runtime-secret/,
    );

    await page.locator("#duplicates span").nth(1).click({ force: true });
    state = await waitFor((state) => state.inspection?.text === "Second");
    assert.equal(await page.locator(state.inspection.selector).count(), 1);
    await page.locator("#shape").click({ force: true });
    assert.equal(
      (await waitFor((state) => state.inspection?.id === "shape")).inspection
        .tag,
      "rect",
    );
    await page
      .locator("#shadow-host")
      .getByRole("button")
      .click({ force: true });
    state = await waitFor((state) => state.inspection?.id === "shadow-button");
    assert.match(state.inspection.scope, /Shadow root/);
    assert.equal(state.inspection.computed.color, "rgb(255, 100, 100)");
    assert.ok(
      state.inspection.rules.some((rule) => rule.selector === "button"),
    );
    await page.locator("#frame").click({ force: true });
    state = await waitFor((state) => state.inspection?.id === "frame");
    assert.ok(
      state.inspection.notes.some((note) => note.includes("Frame contents")),
    );
    await page.keyboard.press("Escape");
    assert.equal((await get()).inspection, null);

    await page.locator("#target").click({ force: true });
    await waitFor((state) => state.inspection?.id === "target");
    const panel = await context.newPage();
    panel.on("pageerror", (error) => errors.push(error.message));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.bringToFront();
    await panel.getByText("SELECTED ELEMENT").waitFor();
    assert.equal(
      await panel
        .getByRole("switch", { name: "Inspection mode" })
        .getAttribute("aria-checked"),
      "true",
    );
    await panel.getByRole("button", { name: "Styles", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "Filter CSS properties" })
      .fill("border-top-left-radius");
    await panel.getByText("border-top-left-radius", { exact: true }).waitFor();
    assert.equal(
      await panel
        .locator(".section")
        .filter({
          has: panel.getByText("Computed properties", { exact: true }),
        })
        .locator(".property")
        .count(),
      1,
    );
    await panel
      .getByRole("navigation", { name: "Inspector sections" })
      .getByRole("button", { name: "Layout", exact: true })
      .click();
    await panel.locator(".box-model").waitFor();
    await panel.getByRole("button", { name: "Source", exact: true }).click();
    await panel.getByText("Unreadable stylesheets", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Overview", exact: true }).click();
    const panelCdp = await context.newCDPSession(panel);
    await panelCdp.send("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel
      .getByRole("button", { name: "Copy CSS selector", exact: true })
      .click();
    assert.equal(
      await panel.evaluate(() => navigator.clipboard.readText()),
      "#target",
    );
    await panel
      .getByRole("button", { name: "Copy inspection", exact: true })
      .click();
    const report = await panel.evaluate(() => navigator.clipboard.readText());
    assert.match(report, /# Layr inspection/);
    assert.match(report, /Computed CSS/);
    assert.match(report, /Unreadable stylesheet/);
    const other = await context.newPage();
    await other.goto(`http://127.0.0.1:${port}/second`);
    await other.bringToFront();
    await panel.locator('[role="switch"][aria-checked="false"]').waitFor();
    assert.equal(
      await panel.getByText("SELECTED ELEMENT").count(),
      0,
      "selection does not leak across tabs",
    );
    assert.equal(
      await other.locator("[data-layr-overlay]").count(),
      0,
      "new tabs are not automatically activated",
    );
    await other.goto("chrome://extensions/");
    const { targetInfos: restrictedTargets } = await browserCdp.send(
      "Target.getTargets",
      { filter: [{ type: "tab" }] },
    );
    await browserCdp.send("Extensions.triggerAction", {
      id,
      targetId: restrictedTargets.find((target) =>
        target.url.startsWith("chrome://extensions"),
      ).targetId,
    });
    await panel.locator(".error").waitFor();
    assert.equal(
      await panel.getByRole("switch").getAttribute("aria-checked"),
      "false",
      "restricted pages remain disabled",
    );
    await other.close();
    await page.bringToFront();
    await panel.getByText("SELECTED ELEMENT").waitFor();
    await panel.setViewportSize({ width: 360, height: 900 });
    await mkdir("test-results", { recursive: true });
    await panel.screenshot({
      path: "test-results/panel-selected.png",
      fullPage: true,
    });
    assert.equal(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "panel fits 360px",
    );
    await panel.setViewportSize({ width: 280, height: 900 });
    assert.equal(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "panel fits 280px",
    );
    await panel.setViewportSize({ width: 360, height: 900 });
    await panel.getByRole("switch", { name: "Inspection mode" }).click();
    assert.equal((await get()).enabled, false);
    assert.equal(await page.locator("[data-layr-overlay]").count(), 0);
    await page.locator("#target").click({ force: true });
    assert.equal(
      await page.evaluate(() => window.pageClicks),
      1,
      "page interactions restored when off",
    );
    await panel.screenshot({
      path: "test-results/panel-idle.png",
      fullPage: true,
    });
    await send({ type: "LAYR_ENABLE", enabled: true });
    await page.locator("#target").click({ force: true });
    await page.locator("#target").evaluate((element) => element.remove());
    await send({ type: "LAYR_REFRESH" });
    assert.equal(
      (await get()).inspection,
      null,
      "removed selection clears safely",
    );
    await page.reload();
    assert.equal(
      await page.locator("[data-layr-overlay]").count(),
      0,
      "navigation starts with no overlays",
    );

    // Closing the real Chrome panel must release the page's inspection surface.
    await panel.close();
    await browserCdp.send("Extensions.triggerAction", {
      id,
      targetId: targetInfo.targetId,
    });
    await page.locator("[data-layr-overlay]").waitFor({ state: "attached" });
    await waitFor((state) => state.enabled);
    await page.locator("#target").click({ force: true });
    await waitFor((state) => state.inspection?.id === "target");
    await worker.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      await chrome.sidePanel.close({ windowId: tab.windowId });
    }, tabId);
    state = await waitFor((state) => !state.enabled);
    assert.equal(state.inspection, null, "closing the panel clears selection");
    assert.equal(await page.locator("[data-layr-overlay]").count(), 0);
    assert.equal(
      await worker.evaluate(
        (tabId) => chrome.action.getBadgeText({ tabId }),
        tabId,
      ),
      "",
      "closing the panel clears the ON badge",
    );
    await page.locator("#target").click();
    assert.equal(
      await page.evaluate(() => window.pageClicks),
      1,
      "page clicks work again after closing the panel",
    );

    // Test panel-context destruction independently of the newer onClosed API.
    const standalone = await context.newPage();
    await standalone.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.bringToFront();
    await standalone.locator('[role="switch"][aria-checked="false"]').waitFor();
    await standalone.getByRole("switch", { name: "Inspection mode" }).click();
    await waitFor((state) => state.enabled);
    await page.locator("#target").click({ force: true });
    await standalone.getByText("SELECTED ELEMENT").waitFor();
    await standalone.close();
    await waitFor((state) => !state.enabled);
    assert.equal(
      await page.locator("[data-layr-overlay]").count(),
      0,
      "destroying the panel context disconnects and stops inspection",
    );
    assert.deepEqual(errors, [], "no page or panel runtime errors");
  },
);
