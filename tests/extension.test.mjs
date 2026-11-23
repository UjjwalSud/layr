import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const dist = path.resolve("dist");

test("browser: Freeze Hover captures CSS tooltips, React portals, menus and cleans up on OFF", { timeout: 120000 }, async (t) => {
  const fixtureEntry = path.resolve("tests/hover-fixture.js");
  const reactFixture = await build({
    configFile: false, logLevel: "silent", define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [{ name: "hover-fixture", resolveId: (id) => id === fixtureEntry ? id : undefined,
      load: (id) => id === fixtureEntry ? `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {createPortal} from 'react-dom';
        function Fixture() {
          const [open, setOpen] = React.useState(false);
          return React.createElement(React.Fragment, null,
            React.createElement('button', {id:'react-trigger', onPointerEnter:()=>setOpen(true), onPointerLeave:()=>setOpen(false)}, 'React trigger'),
            open && createPortal(React.createElement('div', {id:'react-tip', role:'tooltip', 'data-state':'open', 'data-token':'portal-secret', style:{position:'fixed',left:400,top:150,padding:12,background:'pink'}}, 'React portal tooltip'), document.body));
        }
        createRoot(document.getElementById('react-root')).render(React.createElement(Fixture));
      ` : undefined }],
    build: { write: false, lib: { entry: fixtureEntry, formats: ["iife"], name: "HoverFixture" } },
  });
  const script = (Array.isArray(reactFixture) ? reactFixture[0] : reactFixture).output.find((entry) => entry.type === "chunk").code;
  const folder = await mkdtemp(path.join(tmpdir(), "layr-hover-test-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/react.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/react.js" ? script : `<!doctype html><style>
      body{padding:80px;font:16px sans-serif} button{padding:12px} #css-trigger{position:relative;width:170px;padding:15px;background:#ddd}
      #css-tip{position:absolute;top:65px;left:0;visibility:hidden;opacity:0;background:rgb(10,20,30);color:white;padding:10px;width:140px;--hover-color:blue}
      #css-trigger:hover #css-tip{visibility:visible;opacity:1} #menu{position:relative;margin-top:100px;padding:15px;width:200px;background:#ddd}
      #submenu{display:none;position:absolute;top:60px;background:#eee;padding:10px} #menu:hover #submenu{display:block}
      #react-root{margin-top:100px}
      #delayed-trigger{position:fixed;left:700px;top:80px;padding:15px;background:#ddd}
      #delayed-tip{position:absolute;top:65px;left:0;opacity:0;transition:opacity 0s;background:#ffc;padding:10px;width:140px}
      #delayed-trigger:hover #delayed-tip{opacity:1;transition-delay:.7s}
      #visibility-trigger{position:fixed;left:700px;top:350px;padding:15px;background:#ddd}
      .visibility-parent{position:absolute;top:65px;display:none;visibility:hidden}
      #visibility-trigger:hover .visibility-parent{display:block}
      #visibility-tip{visibility:visible;background:#cff;padding:10px;width:140px}
    </style><div id="css-trigger" aria-describedby="css-tip">Home<div id="css-tip" class="floating-label" role="tooltip" data-token="tooltip-secret">Home tooltip</div></div>
    <div id="menu">Menu<div id="submenu" role="menu"><button role="menuitem" id="menu-child">Nested action</button></div></div>
    <div id="delayed-trigger">Delayed hover<div id="delayed-tip" role="tooltip">Delayed tooltip</div></div>
    <div id="visibility-trigger">Visibility override<div class="visibility-parent"><div id="visibility-tip" role="tooltip">Visible child tooltip</div></div></div>
    <div id="react-root"></div><button id="ordinary" style="margin-top:100px">Ordinary selection</button><div id="large"></div>
    <script>window.leaveCount=0;document.getElementById('css-trigger').addEventListener('pointerleave',()=>window.leaveCount++);
    window.addEventListener('keydown',event=>{if(window.blockFreezeKey && event.altKey && event.shiftKey && event.code==='KeyF'){event.preventDefault();event.stopImmediatePropagation();}},true);
    document.getElementById('large').innerHTML='<span>large page</span>'.repeat(6000);</script><script src="/react.js"></script>`);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  let context;
  t.after(async () => { await context?.close(); await new Promise((resolve) => server.close(resolve)); await rm(folder, { recursive: true, force: true }); });
  context = await chromium.launchPersistentContext(path.join(folder, "profile"), {
    channel: "chromium", headless: true, viewport: { width: 1100, height: 850 },
    args: ["--enable-unsafe-extension-debugging", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const errors = [];
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.bringToFront();
  await worker.evaluate(async () => { while (!chrome.action.onClicked.hasListeners()) await new Promise((resolve) => setTimeout(resolve, 20)); });
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: targetInfos.find((target) => target.url === page.url()).targetId });
  await page.locator("[data-layr-overlay]").waitFor({ state: "attached" });
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const send = (message) => worker.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message), { tabId, message });
  const get = () => send({ type: "LAYR_GET_STATE" });
  const frozenTarget = async (text) => {
    const state = await get(); const target = state.temporaryTargets.find((entry) => entry.text === text);
    assert.ok(target, `Missing ${text}: ${JSON.stringify(state.temporaryTargets)}`); return target;
  };
  const panel = await context.newPage(); panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`); await page.bringToFront();
  await panel.getByRole("button", { name: "Freeze hover", exact: true }).waitFor();
  const shortcuts = await worker.evaluate(() => chrome.commands.getAll());
  assert.ok(shortcuts.some((entry) => entry.name === "toggle-freeze-hover" && entry.shortcut === "Alt+Shift+F"), "Chrome registers the Freeze shortcut");

  await page.locator("#css-trigger").hover();
  await page.keyboard.press("Alt+Shift+f");
  assert.equal((await get()).frozen, true);
  await panel.getByText("Hover frozen", { exact: true }).waitFor();
  await page.mouse.move(900, 700);
  assert.equal(await page.locator("#css-tip").isVisible(), false);
  assert.ok(await page.evaluate(() => window.leaveCount) > 0, "website pointerleave runs normally");
  const cssTarget = await frozenTarget("Home tooltip"); assert.equal(cssTarget.status, "captured");
  await panel.getByRole("region", { name: "Temporary inspection targets" }).getByRole("button").filter({ hasText: "[tooltip]" }).click();
  const css = (await get()).inspection;
  assert.equal(css.id, "css-tip"); assert.equal(css.computed.visibility, "visible");
  assert.equal(css.computed["background-color"], "rgb(10, 20, 30)");
  assert.ok(css.rules.some((rule) => rule.selector === "#css-trigger:hover #css-tip"));
  assert.ok(!JSON.stringify(css).includes("tooltip-secret"));
  await panel.getByText("Captured temporary element — read-only inspection preview", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Unfreeze hover", exact: true }).click();
  assert.deepEqual((await get()).inspection, css, "unfreeze retains captured HTML/CSS");
  await page.locator("#ordinary").hover({ force: true }); assert.deepEqual((await get()).inspection, css);

  // An unmarked CSS tooltip is captured before moving into the side panel.
  await page.locator("#css-tip").evaluate((node) => node.removeAttribute("role"));
  await page.locator("#css-trigger").evaluate((node) => node.removeAttribute("aria-describedby"));
  await page.locator("#css-trigger").hover({ force: true });
  await page.waitForTimeout(350);
  await page.mouse.move(900, 700);
  await panel.getByRole("button", { name: "Freeze hover", exact: true }).click();
  const recentCss = await frozenTarget("Home tooltip");
  assert.equal(recentCss.status, "captured", "panel Freeze can select a tooltip captured before the mouse left");
  await send({ type: "LAYR_SELECT_TEMPORARY", key: recentCss.key });
  assert.equal((await get()).inspection.computed.visibility, "visible");
  await send({ type: "LAYR_FREEZE", frozen: false });

  await page.locator("#delayed-trigger").hover({ force: true });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('delayed-tip')).opacity === '1');
  await page.waitForTimeout(150);
  await page.mouse.move(900, 700);
  await panel.getByRole("button", { name: "Freeze hover", exact: true }).click();
  const delayed = await frozenTarget("Delayed tooltip");
  await send({ type: "LAYR_SELECT_TEMPORARY", key: delayed.key });
  assert.equal((await get()).inspection.computed.opacity, "1", "delayed CSS tooltips are captured while visible before entering the panel");
  await send({ type: "LAYR_FREEZE", frozen: false });

  await page.locator("#visibility-trigger").hover({ force: true });
  await page.waitForTimeout(150);
  await page.keyboard.press("Alt+Shift+f");
  await page.mouse.move(900, 700);
  const visibleChild = await frozenTarget("Visible child tooltip");
  await send({ type: "LAYR_SELECT_TEMPORARY", key: visibleChild.key });
  assert.equal((await get()).inspection.id, "visibility-tip", "visible descendants override ancestor visibility:hidden");
  await send({ type: "LAYR_FREEZE", frozen: false });

  await page.evaluate(() => { window.blockFreezeKey = true; });
  await page.locator("#css-trigger").hover({ force: true });
  await page.keyboard.press("Alt+Shift+f");
  // CDP synthetic keys don't run Chrome's native command dispatcher. Exercise
  // its content-message entry point separately from the page's blocked keys.
  assert.equal((await get()).frozen, false, "fixture consumes the page-level shortcut");
  await send({ type: "LAYR_TOGGLE_FREEZE" });
  assert.equal((await get()).frozen, true, "browser-command message bypasses page key handlers");
  await send({ type: "LAYR_FREEZE", frozen: false });
  await page.evaluate(() => { window.blockFreezeKey = false; });

  await page.locator("#react-trigger").hover({ force: true });
  await page.locator("#react-tip").waitFor();
  await page.keyboard.press("Alt+Shift+f");
  await page.mouse.move(900, 700); await page.locator("#react-tip").waitFor({ state: "detached" });
  const reactTarget = await frozenTarget("React portal tooltip"); assert.equal(reactTarget.status, "captured");
  await send({ type: "LAYR_SELECT_TEMPORARY", key: reactTarget.key });
  const react = (await get()).inspection;
  assert.equal(react.id, "react-tip"); assert.equal(react.hoverState.state, "open");
  assert.ok(react.breadcrumb.some((node) => node.label.includes("react-tip")), "removed portals retain a readable ancestor path");
  assert.match(react.tree.label, /react-tip/, "temporary snapshots retain their focused hierarchy");
  assert.equal(react.navigationAvailable, false, "captured hierarchy does not claim to navigate unavailable nodes");
  assert.equal(react.computed.position, "fixed"); assert.ok(!JSON.stringify(react).includes("portal-secret"));
  await page.keyboard.press("Escape");
  assert.equal((await get()).frozen, false); assert.deepEqual((await get()).inspection, react);
  await page.keyboard.press("Escape"); assert.deepEqual((await get()).inspection, react);

  await page.locator("#menu").hover({ force: true }); await page.keyboard.press("Alt+Shift+f");
  await page.mouse.move(900, 700);
  const child = await frozenTarget("Nested action");
  // Prefer the individual menu item, rather than its menu container with the same text.
  const menuChild = (await get()).temporaryTargets.find((target) => target.role === "menuitem");
  assert.ok(menuChild); await send({ type: "LAYR_SELECT_TEMPORARY", key: menuChild.key });
  const menu = (await get()).inspection; assert.equal(menu.id, "menu-child"); assert.ok(child);
  await send({ type: "LAYR_ENABLE", enabled: false });
  assert.deepEqual((await get()).inspection, menu); assert.equal((await get()).frozen, false);
  assert.deepEqual((await get()).temporaryTargets, []); assert.equal(await page.locator("[data-layr-overlay]").count(), 0);
  await worker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const Native = MutationObserver; window.__activeObservers = 0; window.__mutationCallbacks = 0;
    window.MutationObserver = class extends Native {
      active = false;
      constructor(callback) { super((...args) => { window.__mutationCallbacks++; callback(...args); }); }
      observe(...args) { super.observe(...args); if (!this.active) { this.active = true; window.__activeObservers++; } }
      disconnect() { super.disconnect(); if (this.active) { this.active = false; window.__activeObservers--; } }
    };
  } }), tabId);
  await send({ type: "LAYR_ENABLE", enabled: true });

  // Audit whole-document scans in the extension world while a large app updates.
  await worker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    window.__wholeScans = 0; const query = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function(selector) { if (selector === "*") window.__wholeScans++; return query.call(this, selector); };
  } }), tabId);
  await page.evaluate(async () => {
    for (let batch = 0; batch < 12; batch++) {
      const node = document.createElement('div'); node.textContent = 'dynamic update'; document.getElementById('large').append(node);
      await new Promise((resolve) => requestAnimationFrame(resolve)); node.remove();
    }
  });
  const [audit] = await worker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => window.__wholeScans }), tabId);
  assert.equal(audit.result, 0, "DOM updates never rescan the entire document");
  await page.locator("#ordinary").click({ force: true }); assert.equal((await get()).inspection.id, "ordinary");
  await send({ type: "LAYR_FREEZE", frozen: true });
  await send({ type: "LAYR_CLEAR" }); assert.equal((await get()).inspection, null);
  await send({ type: "LAYR_ENABLE", enabled: false });
  const observerAudit = () => worker.evaluate(async (tabId) => (await chrome.scripting.executeScript({ target: { tabId },
    func: () => ({ active: window.__activeObservers, callbacks: window.__mutationCallbacks }) }))[0].result, tabId);
  const stopped = await observerAudit(); assert.equal(stopped.active, 0, "OFF disconnects every inspection MutationObserver");
  await page.evaluate(async () => {
    document.getElementById('large').append(document.createElement('div'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.deepEqual(await observerAudit(), stopped, "page mutations cannot restart capture after OFF");
  await send({ type: "LAYR_FREEZE", frozen: true }); assert.equal((await get()).frozen, false, "OFF cannot restart hover capture");
  assert.deepEqual(errors, []);
});

test("browser: unified inspector captures states, conditional CSS, hierarchy, images and icons", { timeout: 120000 }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "layr-redesign-"));
  const requests = [];
  const errors = [];
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XsAAAAASUVORK5CYII=", "base64");
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/pixel.png")) {
      response.setHeader("Content-Type", "image/png"); response.setHeader("Access-Control-Allow-Origin", "*"); response.end(pixel); return;
    }
    if (request.url === "/broken.png") { response.writeHead(404); response.end(); return; }
    if (request.url === "/styles.css") {
      response.setHeader("Content-Type", "text/css"); response.end(`
        body { margin: 30px; font-family: sans-serif; --accent: blue; }
        .button { font-size: 12px; color: red; padding: 8px 12px; }
        .button { font-size: 16px; color: blue !important; }
        .button:hover { background-color: rgb(1, 2, 3); }
        .button:focus { outline: 2px solid green; }
        .button:focus-visible { outline-offset: 3px; }
        .button:active { opacity: .9; }
        .button:disabled { cursor: not-allowed; }
        #check:checked { accent-color: green; }
        #pseudo::before { content: "→"; color: rgb(50, 100, 150); }
        #content-image::before { content: url('/pixel.png'); }
        @media (min-width: 99999px) { .button { font-size: 99px; } .button:hover { color: orange; } }
        @supports (display: definitely-invalid) { .button { color: purple; } }
        @media (min-width: 1px) { .button { border-radius: 6px; } }
        #background { width: 40px; height: 40px; background-image: url('/pixel.png'); }
      `); return;
    }
    response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><link rel="stylesheet" href="/styles.css"><title>Redesign fixture</title>
      <style id="disabled-sheet">.button { font-size: 77px; }</style><button id="button" class="button primary" style="font-weight:600">Save Changes</button>
      <section id="tree" style="padding:10px"><div id="branch"><span id="leaf">Nested label</span></div><p>Sibling</p></section>
      <picture id="picture"><source srcset="/pixel.png 1x" type="image/png"><img id="image" src="/pixel.png" srcset="/pixel.png 1x" alt="A single pixel" width="32" height="32"></picture>
      <div id="background"></div><img id="broken" src="/broken.png" width="30" height="30">
      <svg id="icon" class="sample-icon" width="32" height="32" viewBox="0 0 32 32" onload="window.iconExecuted=true"><path d="M4 4h24v24H4z" fill="blue" /></svg>
      <svg id="ref-icon" width="32" height="32"><use href="#local-symbol" /></svg><svg width="0" height="0"><defs><symbol id="local-symbol" viewBox="0 0 10 10"><rect width="10" height="10" /></symbol></defs></svg>
      <svg id="empty-reference" width="32" height="32"><use href="#" /></svg>
      <input type="checkbox" id="check" checked><span id="pseudo">Icon</span><span id="content-image">Image icon</span><span id="font-icon" style="font-family: sans-serif">&#xE001;</span>
      <img id="private-image" src="/pixel.png?token=image-secret" width="30" height="30">
      <div id="large" style="padding:10px"></div><script>document.getElementById('disabled-sheet').sheet.disabled=true;for(let i=0;i<2300;i++){const n=document.createElement('i'); n.textContent='item'; document.getElementById('large').append(n)}</script>`);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const context = await chromium.launchPersistentContext(path.join(folder, "profile"), { channel: "chromium", headless: true, viewport: { width: 1100, height: 850 },
    args: ["--enable-unsafe-extension-debugging", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  t.after(async () => { await context.close(); await new Promise((resolve) => server.close(resolve)); await rm(folder, { recursive: true, force: true }); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.bringToFront();
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: targetInfos.find((target) => target.url === page.url()).targetId });
  // Native side-panel activation can change the worker's notion of "active".
  // Keep this fixture attached to its granted tab and await idempotent injection.
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id, page.url());
  await worker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }), tabId);
  const send = (message) => worker.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }), { tabId, message });
  const get = () => send({ type: "LAYR_GET_STATE" });
  const panel = await context.newPage(); panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`); await page.bringToFront();
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.getByRole("switch", { name: "Inspection mode" }).waitFor();
  await send({ type: "LAYR_ENABLE", enabled: true });
  await page.locator("[data-layr-overlay]").waitFor({ state: "attached" });
  const select = async (selector, expected) => {
    await page.locator(selector).click({ force: true, position: { x: 2, y: 2 } });
    await panel.locator(".selected-name").filter({ hasText: expected }).waitFor();
    return (await get()).inspection;
  };
  let snapshot = await select("#button", "button#button");
  assert.ok(snapshot.rules.some((rule) => rule.context.includes("@media (min-width: 1px)")));
  assert.ok(snapshot.rules.flatMap((rule) => rule.declarations).some((item) => item.property === "font-size" && item.value === "12px" && item.status === "overridden"));
  assert.ok(snapshot.inactiveRules.some((rule) => rule.context.some((context) => context.includes("99999px"))));
  assert.ok(snapshot.inactiveRules.some((rule) => rule.context.some((context) => context.includes("definitely-invalid"))));
  assert.ok(snapshot.inactiveRules.some((rule) => rule.context.includes("Stylesheet disabled")), "disabled stylesheets are shown as inactive");
  assert.ok(!snapshot.rules.some((rule) => rule.declarations.some((item) => item.value === "99px")), "inactive rules never enter the applied cascade");
  for (const state of [":hover", ":focus", ":focus-visible", ":active", ":disabled"]) assert.ok(snapshot.stateRules.some((rule) => rule.states.includes(state)), `${state} definitions captured`);
  assert.ok(snapshot.stateRules.some((rule) => rule.selector === ".button:hover" && rule.active));
  assert.ok(snapshot.stateRules.some((rule) => rule.selector === ".button:disabled" && !rule.active));
  assert.ok(snapshot.stateRules.some((rule) => rule.context.some((context) => context.includes("99999px")) && !rule.active));
  assert.equal(await panel.locator(".tabs").count(), 0);
  assert.equal(await panel.getByText("Images", { exact: true }).count(), 0, "plain buttons have no empty media sections");
  assert.equal(await panel.getByText("Icons", { exact: true }).count(), 0);
  await mkdir("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/panel-unified.png" });
  const cssURL = `http://127.0.0.1:${server.address().port}/styles.css`;
  assert.ok(await panel.locator(`.origin a[href="${cssURL}"]`).count() > 0, "source filenames link to the captured stylesheet URL");
  await panel.getByText("Inactive conditional rules", { exact: true }).click();
  assert.match(await panel.locator(".inactive-rule").first().innerText(), /inactive/);
  const panelCdp = await context.newCDPSession(panel); await panelCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByRole("button", { name: "Copy declaration color", exact: true }).first().click();
  assert.match(await panel.evaluate(() => navigator.clipboard.readText()), /^color: .*;/);
  await panel.getByRole("button", { name: "Copy all available CSS", exact: true }).click();
  const css = await panel.evaluate(() => navigator.clipboard.readText());
  for (const pattern of [/\.button:hover/, /:disabled/, /99999px/, /!important/, /Computed CSS/, /Inherited candidates/, /styles\.css/]) assert.match(css, pattern);
  await panel.getByRole("textbox", { name: "Filter CSS properties" }).fill("font-size");
  await panel.getByRole("button", { name: "Copy CSS rule", exact: true }).first().click();
  const originalRule = await panel.evaluate(() => navigator.clipboard.readText());
  assert.match(originalRule, /font-size: 12px/); assert.match(originalRule, /color: red/); assert.match(originalRule, /padding/);
  await panel.getByRole("textbox", { name: "Filter CSS properties" }).fill("");
  await panel.getByText("CSS styles", { exact: true }).click();
  await panel.getByText("CSS styles", { exact: true }).click();
  await panel.getByRole("textbox", { name: "Filter CSS properties" }).waitFor();

  await panel.getByText("HTML / Element details", { exact: true }).click();
  snapshot = await select("#tree", "section#tree");
  assert.equal(snapshot.tree.children[0].children[0].text, "Nested label");
  const tree = panel.getByLabel("Captured element hierarchy");
  await tree.getByRole("button", { name: "Expand div#branch", exact: true }).click();
  await tree.getByRole("button", { name: "span#leaf", exact: true }).click();
  await panel.locator(".selected-name").filter({ hasText: "span#leaf" }).waitFor();
  snapshot = await select("#tree", "section#tree");
  await page.locator("#tree").evaluate((node) => node.remove());
  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  await tree.getByRole("button", { name: "Expand div#branch", exact: true }).click();
  await tree.getByText("Nested label", { exact: true }).waitFor();
  assert.deepEqual((await get()).inspection, snapshot, "expanding captured children and OFF do not mutate or discard the snapshot");
  await panel.getByRole("switch", { name: "Inspection mode" }).click();

  snapshot = await select("#image", "img#image");
  assert.equal(snapshot.images[0].naturalWidth, 1); assert.equal(snapshot.images[0].naturalHeight, 1);
  assert.equal(snapshot.images[0].currentSrc, `http://127.0.0.1:${server.address().port}/pixel.png`);
  assert.ok(snapshot.images[0].srcset); assert.ok(snapshot.images[0].sources.length);
  await panel.locator(".media-preview img").waitFor();
  await panel.waitForFunction(() => document.querySelector(".media-preview img")?.naturalWidth > 0);
  await panel.getByRole("button", { name: "Copy image URL", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), snapshot.images[0].url);
  const [download] = await Promise.all([panel.waitForEvent("download"), panel.getByRole("button", { name: "Download Image", exact: true }).click()]);
  assert.deepEqual(await readFile(await download.path()), pixel, "image download preserves original bytes");
  snapshot = await select("#background", "div#background"); assert.equal(snapshot.images[0].kind, "background");
  snapshot = await select("#broken", "img#broken");
  await panel.getByText("Preview unavailable", { exact: true }).waitFor();
  assert.equal(await panel.locator(".media-preview img").count(), 0, "failed previews never leave a broken image icon");
  snapshot = await select("#icon", "svg#icon");
  assert.equal(snapshot.icons[0].kind, "Inline SVG"); assert.ok(snapshot.icons[0].svg.includes("<path"));
  assert.ok(!snapshot.icons[0].html.includes("window.iconExecuted"), "icon markup is redacted before leaving the page");
  await panel.getByRole("button", { name: "Copy SVG", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), snapshot.icons[0].svg);
  const [svgDownload] = await Promise.all([panel.waitForEvent("download"), panel.getByRole("button", { name: "Download SVG", exact: true }).click()]);
  assert.equal(await readFile(await svgDownload.path(), "utf8"), snapshot.icons[0].svg);
  await panel.getByText("SVG markup", { exact: true }).click(); await panel.locator(".syntax-tag").first().waitFor();
  snapshot = await select("#ref-icon", "use"); assert.equal(snapshot.icons[0].kind, "SVG reference"); assert.equal(snapshot.icons[0].url, undefined, "local SVG symbols do not invent a URL");
  assert.ok(snapshot.icons[0].svg.includes("<symbol"), "accessible local SVG symbols are embedded in the SVG export");
  snapshot = await select("#empty-reference", "svg#empty-reference"); assert.equal(snapshot.icons[0].kind, "SVG reference"); assert.equal(snapshot.icons[0].url, undefined);
  snapshot = await select("#pseudo", "span#pseudo"); assert.ok(snapshot.pseudos.some((pseudo) => pseudo.selector === "::before")); assert.equal(snapshot.icons[0].kind, "Pseudo-element");
  assert.equal(snapshot.icons[0].width, undefined, "auto pseudo dimensions are left unknown rather than reported as zero");
  snapshot = await select("#content-image", "span#content-image"); assert.ok(snapshot.icons[0].url.endsWith("/pixel.png"), "pseudo-element content image URLs are captured");
  snapshot = await select("#font-icon", "span#font-icon"); assert.equal(snapshot.icons[0].kind, "Icon font");
  snapshot = await select("#check", "input#check"); assert.equal(snapshot.states[":checked"], true); assert.ok(snapshot.stateRules.some((rule) => rule.selector === "#check:checked" && rule.active));
  assert.equal(await page.locator("#check").isChecked(), true, "inspection preserves checkbox state after canceled activation");
  const beforePrivate = requests.filter((url) => url.includes("token=")).length;
  snapshot = await select("#private-image", "img#private-image");
  assert.ok(!JSON.stringify(snapshot).includes("image-secret"));
  assert.equal(await panel.getByRole("link", { name: "Open Image", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Download Image", exact: true }).count(), 0);
  assert.equal(requests.filter((url) => url.includes("token=")).length, beforePrivate, "redacted resource URLs are never requested by the panel");
  snapshot = await select("#large", "div#large"); assert.equal(snapshot.htmlTruncated, true); assert.ok(snapshot.tree.children.length <= 120);
  assert.ok(snapshot.notes.some((note) => note.includes("2,000 nodes")), "large subtrees are bounded before cloning");
  await panel.setViewportSize({ width: 280, height: 900 });
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".inspector-content").scrollWidth <= document.querySelector(".inspector-content").clientWidth), true, "inspector fits 280px without a horizontal page scrollbar");
  await mkdir("test-results", { recursive: true }); await panel.screenshot({ path: "test-results/panel-unified-narrow.png" });
  assert.deepEqual(errors, []);
});

test("browser: CSS variables show computed values, accessible sources, fallbacks and persistent snapshots", { timeout: 120000 }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "layr-variables-"));
  const errors = [];
  const server = createServer((request, response) => {
    if (request.url === "/globals.css") {
      response.setHeader("Content-Type", "text/css"); response.end(`
        :root { --color-primary: #2563eb; --space: 12px !important; --base: 4px; --nested: calc(var(--base) * 2);
          --family: "Courier New", monospace; --layout: grid; --cycle-a: var(--cycle-b); --cycle-b: var(--cycle-a);
          --empty: ; --literal: "var(--quoted-text)"; --access-token: opaque-private-css; --alias-private: var(--access-token); --Uñicode: 13px; --escaped\\2d name: 17px; --percent\\%: 19px; }
        :root[data-theme="dark"] { --color-primary: #be123c; }
        body { margin: 30px; }
        #parent { padding: 20px; --space: 20px; --parent-only: 11px; }
        .target { --overridden: 8px !important; --local: var(--parent-only); --base: 30px; box-sizing: content-box;
          display: var(--layout); background-color: var(--color-primary); padding: var(--space);
          width: var(--missing, calc(var(--nested) * 3)); min-height: var(--nested); font-family: var(--family);
          margin-top: var(--cycle-a, 9px); letter-spacing: var(--absent); row-gap: var(--overridden);
          outline-color: var(--unknown-color, rgb(1, 2, 3)); border-top-style: solid;
          border-top-width: var(--outer, var(--middle, var(--absent-size, 5px)));
          column-gap: var(--escaped\\2d name); border-bottom: var(--percent\\%) solid red;
          padding-bottom: var(--empty, 9px); content: "var(--quoted-text)"; }
        #target { --overridden: 22px; }
      `); return;
    }
    if (request.url === "/hidden.css") { response.setHeader("Content-Type", "text/css"); response.end("#target { --foreign: 45px; border-right: var(--foreign) solid red; }"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><html><head><link rel="stylesheet" href="/globals.css"><title>Variables fixture</title></head><body><section id="parent"><button id="target" class="target" style="--overridden:25px">Variables</button></section></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const context = await chromium.launchPersistentContext(path.join(folder, "profile"), { channel: "chromium", headless: true, viewport: { width: 1100, height: 850 },
    args: ["--enable-unsafe-extension-debugging", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  t.after(async () => { await context.close(); await new Promise((resolve) => server.close(resolve)); await rm(folder, { recursive: true, force: true }); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${port}/`); await page.bringToFront();
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  await cdp.send("Extensions.triggerAction", { id, targetId: targetInfos.find((target) => target.url === page.url()).targetId });
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id, page.url());
  await worker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }), tabId);
  const send = (message) => worker.evaluate(({ tabId, message }) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }), { tabId, message });
  const get = () => send({ type: "LAYR_GET_STATE" });
  const panel = await context.newPage(); panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`); await page.bringToFront();
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.getByRole("switch", { name: "Inspection mode" }).waitFor();
  await send({ type: "LAYR_ENABLE", enabled: true });
  await page.locator("[data-layr-overlay]").waitFor({ state: "attached" }); await page.locator("#target").click({ force: true });
  await panel.locator(".selected-name").filter({ hasText: "button#target" }).waitFor();
  let snapshot = (await get()).inspection;
  const variable = (name) => snapshot.variables.find((item) => item.name === name);
  const declaration = (property) => snapshot.rules.flatMap((rule) => rule.declarations).find((item) => item.property === property && item.variableReferences?.length);
  assert.equal(variable("--color-primary").computedValue, "#2563eb");
  assert.equal(variable("--color-primary").definitions.find((item) => item.status === "nearest").selector, ":root");
  assert.equal(variable("--color-primary").definitions[0].origin, `http://127.0.0.1:${port}/globals.css`);
  assert.equal(variable("--space").computedValue, "20px");
  assert.equal(variable("--space").definitions.find((item) => item.status === "nearest").element, "#parent", "a parent's normal declaration wins over an inherited important value");
  assert.equal(variable("--space").definitions.find((item) => item.selector === ":root").status, "overridden");
  assert.equal(variable("--overridden").computedValue, "8px");
  assert.equal(variable("--overridden").definitions.find((item) => item.status === "nearest").selector, ".target", "important author variable beats normal inline and ID declarations");
  assert.ok(variable("--overridden").definitions.filter((item) => item.status === "overridden").length >= 2);
  assert.equal(variable("--base").computedValue, "30px");
  assert.equal(variable("--nested").definitions[0].references[0].computedValue, "4px", "inherited nested variables resolve dependencies on their defining element");
  assert.equal(declaration("width").computedValue, "24px");
  assert.equal(declaration("min-height").computedValue, "8px");
  assert.equal(declaration("margin-top").computedValue, "9px", "circular variables allow the browser's declared fallback");
  assert.equal(declaration("padding-bottom").computedValue, "0px", "a valid empty variable does not use its fallback");
  assert.equal(declaration("outline-color").computedValue, "rgb(1, 2, 3)");
  assert.equal(declaration("border-top-width").computedValue, "5px");
  assert.deepEqual(declaration("border-top-width").variableReferences.map((reference) => reference.name), ["--outer", "--middle", "--absent-size"]);
  assert.equal(declaration("font-family").computedValue, '"Courier New", monospace');
  assert.equal(declaration("display").computedValue, "grid");
  assert.equal(variable("--missing").computedValue, null); assert.deepEqual(variable("--missing").definitions, []);
  assert.equal(variable("--cycle-a").computedValue, null); assert.equal(variable("--cycle-b").computedValue, null);
  assert.ok(!variable("--quoted-text"), "quoted var() text is not treated as a reference");
  assert.equal(variable("--Uñicode").computedValue, "13px", "non-ASCII custom property names retain their computed values");
  assert.equal(variable("--escaped-name").computedValue, "17px"); assert.equal(declaration("column-gap").variableReferences[0].name, "--escaped-name");
  assert.equal(variable("--percent%").computedValue, "19px"); assert.equal(declaration("border-bottom").computedValue, "19px solid rgb(255, 0, 0)");
  assert.ok(!JSON.stringify(snapshot).includes("opaque-private-css"), "sensitive custom property values cannot leak through aliases");
  const actual = await page.locator("#target").evaluate((element) => Object.fromEntries(["background-color", "width", "min-height", "font-family", "margin-top", "letter-spacing", "outline-color", "border-top-width", "padding-bottom"].map((name) => [name, getComputedStyle(element).getPropertyValue(name).trim()])));
  for (const [name, value] of Object.entries(actual)) assert.equal(declaration(name).computedValue, value, `${name} uses the actual selected-element computed value`);

  const usage = panel.locator('.variable-usage[data-property="background-color"]').first();
  await usage.getByText("rgb(37, 99, 235)", { exact: true }).waitFor();
  assert.equal(await usage.getByRole("img", { name: "Color rgb(37, 99, 235)", exact: true }).count(), 1);
  await usage.locator("summary").click();
  await usage.getByText("Defined on:", { exact: false }).waitFor();
  assert.equal(await usage.getByRole("link", { name: "globals.css", exact: true }).getAttribute("href"), `http://127.0.0.1:${port}/globals.css`);
  await usage.getByText("Source line unavailable", { exact: true }).waitFor();
  const panelCdp = await context.newCDPSession(panel); await panelCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await usage.getByRole("button", { name: "Copy original value for background-color", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), "var(--color-primary)");
  await usage.getByRole("button", { name: "Copy resolved background-color", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), "rgb(37, 99, 235)");
  await usage.getByRole("button", { name: "Copy variable declaration --color-primary", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), "--color-primary: #2563eb;");
  await panel.getByText("CSS variables", { exact: true }).click();
  const variablesSection = panel.locator(".section").filter({ has: panel.locator(":scope > summary").getByText("CSS variables", { exact: true }) });
  const missing = variablesSection.locator('.css-variable[data-variable="--missing"]');
  await missing.locator("summary").click(); await missing.getByText("Declaration unavailable in accessible styles. Source unavailable.", { exact: true }).waitFor();
  const fontVariable = variablesSection.locator('.css-variable[data-variable="--family"]');
  assert.equal(await fontVariable.locator(".swatch").count(), 0, "non-colors do not get color swatches");
  await variablesSection.locator('.css-variable[data-variable="--cycle-a"] > summary').click();
  await panel.setViewportSize({ width: 280, height: 900 });
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".inspector-content").scrollWidth <= document.querySelector(".inspector-content").clientWidth), true);
  await panel.setViewportSize({ width: 360, height: 900 });
  await mkdir("test-results", { recursive: true }); await usage.scrollIntoViewIfNeeded(); await panel.screenshot({ path: "test-results/panel-css-variables.png" });

  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  assert.deepEqual((await get()).inspection, snapshot, "theme changes do not silently rewrite a captured snapshot");
  snapshot = (await send({ type: "LAYR_REFRESH" })).inspection;
  assert.equal(variable("--color-primary").computedValue, "#be123c");
  assert.equal(variable("--color-primary").definitions.find((item) => item.status === "nearest").selector, ':root[data-theme="dark"]');
  assert.equal(declaration("background-color").computedValue, "rgb(190, 18, 60)");
  await page.evaluate(async (url) => { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = url; document.head.append(link); await new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; }); }, `http://localhost:${port}/hidden.css`);
  snapshot = (await send({ type: "LAYR_REFRESH" })).inspection;
  assert.equal(variable("--foreign").computedValue, "45px"); assert.deepEqual(variable("--foreign").definitions, []);
  assert.ok(snapshot.inaccessible.some((origin) => origin.includes("hidden.css")));
  assert.ok(variable("--color-primary").definitions.every((definition) => definition.status === "candidate"), "inaccessible CSS does not produce guessed winning sources");
  await page.locator("#target").evaluate((element) => element.remove());
  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  await panel.getByText("Saved inspection", { exact: true }).waitFor();
  assert.deepEqual((await get()).inspection, snapshot, "variable details persist after DOM removal and OFF");
  await usage.getByRole("button", { name: "Copy resolved background-color", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), "rgb(190, 18, 60)");
  await panel.reload(); await page.bringToFront(); await panel.getByText("Saved inspection", { exact: true }).waitFor();
  await panel.locator('.variable-usage[data-property="background-color"]').first().getByText("rgb(190, 18, 60)", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
});

test("production manifest uses only the required permissions and local assets", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(dist, "manifest.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.permissions.sort(),
    ["activeTab", "scripting", "sidePanel", "storage"].sort(),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  for (const file of [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    "content.js",
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    "icons/layr.svg",
    "icons/icon-256.png",
    "icons/icon-512.png",
  ]) {
    assert.ok((await readFile(path.join(dist, file))).length > 0, file);
  }
  for (const size of [16, 32, 48, 128, 256, 512]) {
    const png = await readFile(path.join(dist, `icons/icon-${size}.png`));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
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
    const imageRequests = [];
    const folder = await mkdtemp(path.join(tmpdir(), "layr-test-"));
    const extension = dist;
    const server = createServer((request, response) => {
      if (request.url.startsWith("/pixel.png")) {
        imageRequests.push(request.url);
        response.setHeader("Content-Type", "image/png");
        response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XsAAAAASUVORK5CYII=", "base64"));
        return;
      }
      if (request.url === "/foreign.css") {
        response.setHeader("Content-Type", "text/css");
        response.end(".target { background-color: rgb(31, 41, 61); }");
        return;
      }
      if (request.url === "/cascade") {
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><style>
          body { padding:80px; color:rgb(11, 22, 33); --inherited:18px; }
          .cascade { font-size:12px; margin:12px; padding:20px; color:red; letter-spacing:1px !important; }
          .cascade { font-size:20px; margin-left:24px; color:blue; }
          #cascade { color:green; letter-spacing:2px; }
          .cascade:hover { background-color:rgb(1, 2, 3); }
        </style><section id="parent"><button class="cascade" id="cascade" style="color:purple; font-weight:600; letter-spacing:3px">Cascade child</button></section>
        <script>window.pageClicks=0; document.addEventListener('click', () => window.pageClicks++);</script>`);
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
        .target:hover { outline:3px solid rgb(255, 200, 10); }
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
      <div id="private-info" data-token="fixture-private-token" style="padding:12px; --access-token: css-secret">
        <input id="email" value="private@example.com"><input type="hidden" value="hidden-secret">
        <textarea>textarea-secret</textarea><div contenteditable="true"><span>editable-secret</span></div>
        <a href="https://alice:credentials@example.test/path?auth=link-secret#state=fragment-secret" onclick="console.log('event-secret')">private@example.com fixture-private-token</a>
        <script type="application/json">{"credential":"script-secret"}</script>
        <img src="/pixel.png?token=image-secret" alt="fixture image" width="16" height="16">
      </div>
      <script>
        window.pageClicks=0; window.pagePointerDowns=0; window.pageHovers=0;
        document.addEventListener('click', () => window.pageClicks++);
        document.addEventListener('pointerdown', () => window.pagePointerDowns++);
        document.getElementById('target').addEventListener('pointerover', () => window.pageHovers++);
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
        `Timed out waiting for inspector state; last selection: ${last.inspection?.tag}#${last.inspection?.id}; errors: ${errors.join("; ")}`,
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
    assert.ok(await page.evaluate(() => window.pageHovers > 0), "page pointer hover listeners still run");
    assert.equal(await page.locator("#target").evaluate((element) => getComputedStyle(element).outlineStyle), "solid", "native CSS :hover still works");
    const targetBox = await page.locator("#target").boundingBox();
    const iconBox = await icon.boundingBox();
    assert.match(
      await icon.innerText(),
      /button#target/,
      JSON.stringify({ targetBox, iconBox }),
    );
    assert.match(await icon.innerText(), /\.target\.alpha/);
    assert.match(await icon.innerText(), /240 × \d+/);
    assert.match(await icon.innerText(), /Inspect this button/);
    assert.equal(await icon.locator("span").evaluate((element) => getComputedStyle(element).pointerEvents), "none", "hover label does not intercept page events");
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
    assert.equal(state.inspection.breadcrumb.at(-1).label, "button#target.target.alpha");
    assert.ok(state.inspection.inherited.some((entry) => entry.rules.some((rule) => rule.declarations.some((item) => item.property === "--fixture-accent"))));
    assert.ok(state.inspection.rules.every((rule) => rule.declarations.every((item) => item.status === "unknown")), "incomplete CSSOM is never presented as a resolved cascade");
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
    await page.locator("#private-info").scrollIntoViewIfNeeded();
    await page.locator("#private-info").click({ force: true, position: { x: 2, y: 2 } });
    state = await waitFor((state) => state.inspection?.id === "private-info");
    assert.doesNotMatch(JSON.stringify(state), /private@example\.com|fixture-private-token|hidden-secret|textarea-secret|editable-secret|link-secret|fragment-secret|script-secret|event-secret|credentials|css-secret/);
    assert.ok(!JSON.stringify(state).includes("image-secret"));
    assert.equal(imageRequests.length, 1, "sanitizing HTML never loads cloned or redacted image URLs");
    const removedKey = state.inspection.children[0].key;
    await page.locator("#email").evaluate((element) => element.remove());
    state = await send({ type: "LAYR_NAVIGATE", key: removedKey });
    assert.equal(state.inspection.id, "private-info", "detached navigation targets preserve the snapshot");

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
    state = await send({ type: "LAYR_NAVIGATE", key: state.inspection.breadcrumb.at(-2).key });
    assert.equal(state.inspection.id, "shadow-host", "parent navigation crosses an open shadow root");
    assert.ok(state.inspection.children.some((child) => child.label === "button#shadow-button"));
    await page.locator("#frame").click({ force: true });
    state = await waitFor((state) => state.inspection?.id === "frame");
    assert.ok(
      state.inspection.notes.some((note) => note.includes("Frame contents")),
    );
    await page.keyboard.press("Escape");
    assert.equal((await get()).inspection.id, "frame", "Escape preserves selection; only Clear deletes it");
    await send({ type: "LAYR_CLEAR" });
    assert.equal((await get()).inspection, null);

    await page.locator("#target").click({ force: true });
    await waitFor((state) => state.inspection?.id === "target");
    const panel = await context.newPage();
    panel.on("pageerror", (error) => errors.push(error.message));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.bringToFront();
    await panel.getByText("SELECTED ELEMENT", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Switch to light mode", exact: true }).click();
    assert.equal(await panel.locator("html").getAttribute("data-theme"), "light");
    assert.equal(
      await panel
        .getByRole("switch", { name: "Inspection mode" })
        .getAttribute("aria-checked"),
      "true",
    );
    assert.equal(await panel.getByRole("navigation", { name: "Inspector sections" }).count(), 0, "inspection uses one scrollable screen without tabs");
    await panel.getByText("Computed properties", { exact: true }).click();
    await panel
      .getByRole("textbox", { name: "Filter CSS properties" })
      .fill("border-top-left-radius");
    await panel.locator(".property-name").getByText("border-top-left-radius", { exact: true }).waitFor();
    assert.equal(
      await panel
        .locator("details.section")
        .filter({
          has: panel.locator(":scope > summary").getByText("Computed properties", { exact: true }),
        })
        .locator(".property")
        .count(),
      1,
    );
    await panel.getByRole("textbox", { name: "Filter CSS properties" }).fill("");
    await panel.locator(".box-model").waitFor();
    assert.match(await panel.locator(".box-content").innerText(), /196/, "border-box dimensions are converted to content-box dimensions");
    await panel.getByText("Unreadable stylesheets", { exact: true }).waitFor();
    await panel.getByText("HTML / Element details", { exact: true }).click();
    await panel.getByRole("button", { name: "Select parent", exact: true }).click();
    await waitFor((state) => state.inspection?.tag === "body");
    await panel.locator(".children-navigation summary").click();
    await panel.locator(".child-list").getByRole("button", { name: "button#target.target.alpha", exact: true }).click();
    await waitFor((state) => state.inspection?.id === "target");
    await panel.locator(".selected-name").filter({ hasText: "button#target" }).waitFor();
    await panel.getByRole("navigation", { name: "DOM breadcrumb path" }).getByRole("button", { name: "body", exact: true }).click();
    await waitFor((state) => state.inspection?.tag === "body");
    await page.locator("#target").click({ force: true });
    await panel.locator(".selected-name").filter({ hasText: "button#target" }).waitFor();
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
      .getByRole("button", { name: "Copy All Details", exact: true })
      .click();
    const report = await panel.evaluate(() => navigator.clipboard.readText());
    assert.match(report, /# Layr inspection/);
    assert.match(report, /Computed CSS/);
    assert.match(report, /Unreadable stylesheet/);
    await panel.getByRole("button", { name: "Copy All Details", exact: true }).click();
    const aiReport = await panel.evaluate(() => navigator.clipboard.readText());
    for (const expected of [/Tag: button/, /Classes: target alpha/, /Inspect this button/, /## HTML/, /## Layout/, /## Computed CSS/, /## Matching source CSS/, /## Inherited source candidates/, /## DOM path/]) assert.match(aiReport, expected);
    assert.equal(await panel.locator(".brand img").getAttribute("src"), "/icons/layr.svg");
    await page.locator("#private-info").click({ force: true, position: { x: 2, y: 2 } });
    await panel.locator(".selected-name").filter({ hasText: "div#private-info" }).waitFor();
    await panel.getByRole("button", { name: "Copy All Details", exact: true }).click();
    assert.doesNotMatch(await panel.evaluate(() => navigator.clipboard.readText()), /private@example\.com|fixture-private-token|hidden-secret|textarea-secret|editable-secret|link-secret|fragment-secret|script-secret|event-secret|credentials|css-secret/);
    await page.locator("#target").click({ force: true });
    await waitFor((state) => state.inspection?.id === "target");
    const other = await context.newPage();
    await other.goto(`http://127.0.0.1:${port}/second`);
    await other.bringToFront();
    await panel.locator('[role="switch"][aria-checked="false"]').waitFor();
    assert.equal(
      await panel.getByText("SELECTED ELEMENT", { exact: true }).count(),
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
    await panel.getByText("SELECTED ELEMENT", { exact: true }).waitFor();
    await panel.setViewportSize({ width: 360, height: 900 });
    await mkdir("test-results", { recursive: true });
    await panel.screenshot({
      path: "test-results/panel-selected-light.png",
      fullPage: true,
    });
    await panel.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
    await panel.screenshot({ path: "test-results/panel-selected.png", fullPage: true });
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
    const removedSnapshot = (await get()).inspection;
    await page.locator("#target").evaluate((element) => element.remove());
    await send({ type: "LAYR_REFRESH" });
    assert.deepEqual(
      (await get()).inspection,
      removedSnapshot,
      "removed selection keeps its captured details",
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
    assert.equal(state.inspection.id, "target", "closing the panel preserves the snapshot");
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
    await standalone.getByText("SELECTED ELEMENT", { exact: true }).waitFor();
    await standalone.close();
    await waitFor((state) => !state.enabled);
    assert.equal(
      await page.locator("[data-layr-overlay]").count(),
      0,
      "destroying the panel context disconnects and stops inspection",
    );

    // A fully readable sheet exercises conservative, real cascade resolution.
    await page.goto(`http://127.0.0.1:${port}/cascade`);
    await page.bringToFront();
    await browserCdp.send("Extensions.triggerAction", { id, targetId: targetInfo.targetId });
    await page.locator("[data-layr-overlay]").waitFor({ state: "attached" });
    await page.locator("#cascade").click({ force: true });
    state = await waitFor((state) => state.inspection?.id === "cascade");
    const declarations = state.inspection.rules.flatMap((rule) => rule.declarations);
    const status = (property, value) => declarations.find((item) => item.property === property && item.value === value)?.status;
    assert.equal(status("font-size", "12px"), "overridden");
    assert.equal(status("font-size", "20px"), "active");
    assert.equal(status("color", "green"), "overridden", "inline styles beat id specificity");
    assert.equal(state.inspection.inline.find((item) => item.property === "color").status, "active");
    assert.equal(status("letter-spacing", "1px"), "active", "important stylesheet declaration beats normal inline declaration");
    assert.equal(state.inspection.inline.find((item) => item.property === "letter-spacing").status, "overridden");
    assert.equal(status("margin-top", "12px"), "active", "CSSOM expands shorthand into its longhand declarations");
    assert.equal(status("margin-left", "12px"), "overridden", "only the overridden side of the shorthand is marked");
    assert.equal(status("margin-left", "24px"), "active");
    assert.equal(state.inspection.computed.color, "rgb(128, 0, 128)");
    assert.equal(state.inspection.computed["--inherited"], "18px");
    await page.locator("#cascade").evaluate((element) => { element.style.marginInlineStart = "10px"; });
    state = await send({ type: "LAYR_REFRESH" });
    assert.ok(state.inspection.inline.every((item) => item.status === "unknown"), "logical/physical property conflicts remain unclassified");
    await page.locator("#cascade").evaluate((element) => { element.style.marginInlineStart = ""; element.style.transitionDuration = "2s"; });
    state = await send({ type: "LAYR_REFRESH" });
    assert.ok(state.inspection.inline.every((item) => item.status === "unknown"), "transitions remain unclassified");
    await page.locator("#cascade").focus();
    const before = await page.evaluate(() => window.location.href);
    await page.keyboard.press("Enter");
    assert.equal(page.url(), before, "keyboard selection never activates focused controls");
    await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => window.pageClicks), 0, "keyboard selection blocks both Enter and Space activation");
    assert.deepEqual(errors, [], "no page or panel runtime errors");
  },
);

test("browser: panel themes persist locally, sync, and tolerate unavailable storage", { timeout: 60000 }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "layr-theme-test-"));
  const context = await chromium.launchPersistentContext(path.join(folder, "profile"), {
    channel: "chromium",
    headless: true,
    colorScheme: "light",
    viewport: { width: 360, height: 900 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  t.after(async () => {
    await context.close();
    await rm(folder, { recursive: true, force: true });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const url = `chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`;
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(url);
  const lightButton = () => panel.getByRole("button", { name: "Switch to light mode", exact: true });
  const darkButton = () => panel.getByRole("button", { name: "Switch to dark mode", exact: true });
  await lightButton().waitFor();
  assert.equal(await panel.locator("html").getAttribute("data-theme"), "dark", "dark remains the default even on a light system");
  await lightButton().click();
  await darkButton().waitFor();
  assert.equal(await panel.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light");
  assert.equal(await panel.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), "rgb(247, 249, 252)");
  await panel.reload();
  await darkButton().waitFor();
  assert.equal(await panel.locator("html").getAttribute("data-theme"), "light", "theme survives reopening the panel");
  await panel.setViewportSize({ width: 280, height: 900 });
  const themeBounds = await darkButton().boundingBox();
  assert.ok(themeBounds.x >= 0 && themeBounds.x + themeBounds.width <= 280, "theme control fits a narrow panel");
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/panel-idle-light.png", fullPage: true });

  const second = await context.newPage();
  await second.goto(url);
  await second.getByRole("button", { name: "Switch to dark mode", exact: true }).waitFor();
  await darkButton().click();
  await second.getByRole("button", { name: "Switch to light mode", exact: true }).waitFor();
  assert.equal(await second.locator("html").getAttribute("data-theme"), "dark", "open panels synchronize their preference");
  await second.close();
  await panel.reload();
  await lightButton().waitFor();
  assert.equal(await panel.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");

  await panel.evaluate(() => localStorage.setItem("layr-theme", "invalid-theme"));
  await panel.reload();
  await lightButton().waitFor();
  assert.equal(await panel.locator("html").getAttribute("data-theme"), "dark", "invalid saved themes fall back safely");
  await panel.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage unavailable"); };
    Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); };
  });
  await panel.reload();
  await lightButton().click();
  await darkButton().waitFor();
  assert.equal(await panel.locator("html").getAttribute("data-theme"), "light", "themes still switch when preference storage is unavailable");
  assert.deepEqual(errors, [], "theme changes cause no runtime errors");
});

test("browser: frozen snapshots survive OFF, dropdown dismissal, DOM removal, remounts, and tab changes", { timeout: 120000 }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "layr-snapshot-test-"));
  const errors = [];
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><style>
      body { margin:0; padding:80px; min-height:1300px; font:16px sans-serif; }
      #menu { position:relative; width:240px; padding:15px; background:#ddd; }
      #dropdown { display:none; position:absolute; top:100%; left:0; padding:10px; background:#eee; }
      #menu:hover #dropdown { display:block; }
      #dropdown-item { width:210px; height:40px; color:white; background:rgb(30, 40, 50); }
      #dropdown-item:hover { background:rgb(37, 99, 235); --hover-accent:blue; }
      #first, #second { display:block; margin-top:100px; width:220px; height:40px; }
    </style><div id="menu">Hover menu<div id="dropdown"><button id="dropdown-item" data-token="snapshot-secret">Ephemeral dropdown item</button></div></div>
    <button id="first">First permanent button</button><button id="second">Second permanent button</button>
    <script>window.pageHovers=0; window.pageClicks=0;
      document.addEventListener('pointerover', () => window.pageHovers++);
      document.addEventListener('click', () => window.pageClicks++);
    </script>`);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  let context;
  t.after(async () => {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  context = await chromium.launchPersistentContext(path.join(folder, "profile"), {
    channel: "chromium", headless: true, viewport: { width: 1100, height: 850 },
    args: ["--enable-unsafe-extension-debugging", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const browserCdp = await context.browser().newBrowserCDPSession();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const pageCdp = await context.newCDPSession(page);
  const isolatedContexts = [];
  pageCdp.on("Runtime.executionContextCreated", ({ context }) => {
    if (context.auxData?.isDefault === false) isolatedContexts.push(context.id);
  });
  await pageCdp.send("Runtime.enable");
  let listenerContext;
  const listeners = async (expression) => {
    const { result } = await pageCdp.send("Runtime.evaluate", { expression, contextId: listenerContext });
    const { listeners } = await pageCdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
    return listeners.map((item) => `${item.type}:${item.useCapture}`).sort();
  };
  const activate = async (targetPage) => {
    await targetPage.bringToFront();
    // The worker target can exist before its module imports register the action.
    await worker.evaluate(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (chrome.action.onClicked.hasListeners()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Extension action listener did not initialize");
    });
    const { targetInfos } = await browserCdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
    await browserCdp.send("Extensions.triggerAction", {
      id: extensionId, targetId: targetInfos.find((target) => target.url === targetPage.url()).targetId,
    });
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    try {
      await targetPage.locator("[data-layr-overlay]").waitFor({ state: "attached", timeout: 10000 });
    } catch (error) {
      const state = await worker.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: "LAYR_GET_STATE" }).catch(String), tabId);
      assert.fail(`Activation failed: ${JSON.stringify({ tabId, state, errors })}; ${error}`);
    }
    return tabId;
  };
  const tabA = await activate(page);
  for (const contextId of isolatedContexts) {
    const { result } = await pageCdp.send("Runtime.evaluate", { contextId, expression: "globalThis.chrome?.runtime?.id" });
    if (result.value === extensionId) listenerContext = contextId;
  }
  assert.ok(listenerContext, "listener audit uses the extension's isolated execution world");
  const send = (tabId, message) => worker.evaluate(({ tabId, message }) =>
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }), { tabId, message });
  const get = () => send(tabA, { type: "LAYR_GET_STATE" });
  const saved = (tabId, expected) => worker.evaluate(async ({ tabId, expected }) => {
    const key = `layr:inspection:${tabId}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      const inspection = (await chrome.storage.session.get(key))[key] ?? null;
      if (expected === null ? inspection === null :
        inspection?.capturedAt === expected.capturedAt && inspection?.id === expected.id) return { inspection };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Session snapshot did not match for tab ${tabId}`);
  }, { tabId, expected });
  assert.ok((await listeners("window")).length > 0, "listener audit sees active inspection listeners");

  await page.locator("#menu").hover({ force: true });
  await page.locator("#dropdown-item").click({ force: true });
  const captured = (await get()).inspection;
  assert.equal(captured.id, "dropdown-item");
  assert.equal(captured.computed["background-color"], "rgb(37, 99, 235)", "capture includes the current hover CSS");
  assert.equal(captured.computed["--hover-accent"], "blue");
  assert.ok(captured.rules.some((rule) => rule.selector === "#dropdown-item:hover"));
  assert.ok(!JSON.stringify(captured).includes("snapshot-secret"));
  assert.deepEqual((await saved(tabA, captured)).inspection, captured, "only the redacted serializable snapshot is saved");
  await page.mouse.move(700, 600);
  await page.locator("#dropdown").waitFor({ state: "hidden" });
  assert.deepEqual((await get()).inspection, captured, "closing a hover dropdown preserves its exact captured HTML and CSS");
  await page.locator("#second").hover({ force: true });
  assert.deepEqual((await get()).inspection, captured, "hovering another element does not replace the snapshot");

  let panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(panelUrl);
  await page.bringToFront();
  await panel.getByText("SELECTED ELEMENT", { exact: true }).waitFor();
  // Leave only our controllable panel context so closing it tests actual cleanup.
  await worker.evaluate(async (tabId) => chrome.sidePanel.close({ windowId: (await chrome.tabs.get(tabId)).windowId }), tabA);
  await panel.getByText("Computed properties", { exact: true }).click();
  const search = panel.getByRole("textbox", { name: "Filter CSS properties" });
  await search.fill("background-color");
  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  await panel.locator(".connection").getByText("Inspector OFF", { exact: true }).waitFor();
  await panel.getByText("Saved inspection", { exact: true }).waitFor();
  assert.deepEqual((await get()).inspection, captured);
  assert.equal(await search.inputValue(), "background-color", "turning OFF preserves the mounted search/filter");
  assert.equal(await panel.getByRole("button", { name: "Refresh inspection", exact: true }).isDisabled(), true);
  await panel.getByText("HTML / Element details", { exact: true }).click();
  assert.equal(await panel.getByRole("button", { name: "Select parent", exact: true }).isDisabled(), true);
  assert.equal(await page.locator("[data-layr-overlay]").count(), 0);
  assert.deepEqual(await listeners("window"), [], "OFF removes every Layr window event listener");
  assert.deepEqual(await listeners("document"), [], "OFF removes every Layr document event listener");
  const priorHovers = await page.evaluate(() => window.pageHovers);
  await page.locator("#first").hover();
  await page.locator("#first").click();
  assert.ok(await page.evaluate((prior) => window.pageHovers > prior, priorHovers), "normal page hover behavior works while OFF");
  assert.equal(await page.evaluate(() => window.pageClicks), 1, "normal buttons work while OFF");
  assert.deepEqual((await get()).inspection, captured, "OFF cannot select another page element");
  const panelCdp = await context.newCDPSession(panel);
  await panelCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByRole("button", { name: "Copy all computed CSS", exact: true }).click();
  assert.match(await panel.evaluate(() => navigator.clipboard.readText()), /background-color: rgb\(37, 99, 235\)/);
  await panel.getByText("Element HTML", { exact: true }).click();
  await panel.getByRole("button", { name: "Copy HTML", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), captured.html);
  await panel.getByRole("button", { name: "Copy All Details", exact: true }).click();
  assert.match(await panel.evaluate(() => navigator.clipboard.readText()), /Ephemeral dropdown item/);
  await panel.getByRole("button", { name: "Copy All Details", exact: true }).click();
  assert.ok(!(await panel.evaluate(() => navigator.clipboard.readText())).includes("snapshot-secret"));

  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  assert.equal((await get()).enabled, true);
  assert.deepEqual((await get()).inspection, captured, "turning ON retains the original snapshot without recapture");
  await panel.close();
  await page.waitForFunction(() => !document.querySelector("[data-layr-overlay]"));
  assert.equal((await get()).enabled, false);
  assert.deepEqual((await get()).inspection, captured, "closing the last panel stops tracking but keeps the snapshot");
  panel = await context.newPage();
  panel.on("pageerror", (error) => errors.push(error.message));
  await panel.goto(panelUrl);
  await page.bringToFront();
  await panel.getByText("Saved inspection", { exact: true }).waitFor();
  assert.match(await panel.locator(".selected-name").innerText(), /dropdown-item/);
  await panel.reload();
  await page.bringToFront();
  await panel.getByText("Saved inspection", { exact: true }).waitFor();
  assert.deepEqual((await saved(tabA, captured)).inspection, captured, "component remounts retain the saved snapshot");

  const other = await context.newPage();
  await other.goto(`http://127.0.0.1:${server.address().port}/other`);
  await other.bringToFront();
  await panel.getByRole("heading", { name: "A closer look starts here.", exact: true }).waitFor();
  assert.equal(await panel.getByText("SELECTED ELEMENT", { exact: true }).count(), 0, "an unrelated tab never shows A's snapshot");
  const tabB = await activate(other);
  await other.locator("#second").click({ force: true });
  await panel.locator(".selected-name").filter({ hasText: "second" }).waitFor();
  const capturedB = (await send(tabB, { type: "LAYR_GET_STATE" })).inspection;
  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  assert.deepEqual((await saved(tabB, capturedB)).inspection, capturedB);
  await page.bringToFront();
  await panel.locator(".selected-name").filter({ hasText: "dropdown-item" }).waitFor();
  await other.bringToFront();
  await panel.locator(".selected-name").filter({ hasText: "second" }).waitFor();
  await other.close();
  await page.bringToFront();
  await panel.locator(".selected-name").filter({ hasText: "dropdown-item" }).waitFor();
  assert.equal((await saved(tabB, null)).inspection, null, "closing a tab removes its session snapshot");
  await panel.getByRole("button", { name: "Clear selection", exact: true }).click();
  await panel.getByRole("heading", { name: "A closer look starts here.", exact: true }).waitFor();
  assert.equal((await get()).inspection, null);
  assert.equal((await saved(tabA, null)).inspection, null, "explicit Clear works while OFF and deletes session data");
  await panel.reload();
  await page.bringToFront();
  await panel.getByRole("heading", { name: "A closer look starts here.", exact: true }).waitFor();
  assert.equal(await panel.getByText("SELECTED ELEMENT", { exact: true }).count(), 0, "cleared data never reappears after a remount");

  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  await page.locator("#first").click({ force: true });
  const first = (await get()).inspection;
  await page.locator("#second").hover({ force: true });
  assert.deepEqual((await get()).inspection, first);
  await page.locator("#second").click({ force: true });
  const second = (await get()).inspection;
  assert.equal(second.id, "second", "an explicit new selection replaces the old snapshot");
  await page.locator("#second").evaluate((element) => element.remove());
  await panel.getByText("Element no longer on page — showing captured details", { exact: true }).waitFor();
  assert.deepEqual((await get()).inspection, second, "DOM removal does not mutate the snapshot");
  const reopenedCdp = await context.newCDPSession(panel);
  await reopenedCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await panel.getByText("HTML / Element details", { exact: true }).click();
  await panel.getByText("Element HTML", { exact: true }).click();
  await panel.getByRole("button", { name: "Copy HTML", exact: true }).click();
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), second.html);
  await panel.getByText("Computed properties", { exact: true }).click();
  await panel.getByRole("button", { name: "Copy all computed CSS", exact: true }).click();
  assert.ok((await panel.evaluate(() => navigator.clipboard.readText())).includes("#second {"));
  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  assert.deepEqual((await get()).inspection, second, "a removed node's HTML and CSS remain when turned OFF");
  assert.deepEqual((await saved(tabA, second)).inspection, second);

  // A document reload destroys every content-script reference. Restore from
  // session storage and keep navigation disabled until a fresh selection.
  await page.reload();
  await panel.getByText("Saved inspection", { exact: true }).waitFor();
  assert.match(await panel.locator(".selected-name").innerText(), /second/);
  await panel.getByRole("button", { name: "Select another element", exact: true }).click();
  await page.locator("[data-layr-overlay]").waitFor({ state: "attached" });
  assert.deepEqual((await get()).inspection, second, "a newly injected content script restores the saved snapshot without recapture");
  await panel.getByRole("switch", { name: "Inspection mode" }).click();
  await page.reload();
  await panel.getByText("Saved inspection", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Clear selection", exact: true }).click();
  await panel.getByRole("heading", { name: "A closer look starts here.", exact: true }).waitFor();
  assert.equal((await saved(tabA, null)).inspection, null, "clearing saved data works even without a content script");
  const { targetInfos } = await browserCdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  await browserCdp.send("Extensions.triggerAction", {
    id: extensionId, targetId: targetInfos.find((target) => target.url === page.url()).targetId,
  });
  await page.locator("[data-layr-overlay]").waitFor({ state: "attached" });
  assert.equal((await get()).inspection, null, "content script restoration cannot resurrect an explicitly cleared snapshot");
  assert.deepEqual(await worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null),
  })), { local: {}, sync: {} }, "no inspection data is persisted to permanent Chrome storage");
  assert.deepEqual(errors, [], "snapshot lifecycle has no runtime errors");
});
