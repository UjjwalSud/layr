# Layr

Look beyond the pixels.

Layr is a lightweight Chrome extension that lets you explore what's behind any webpage without opening Developer Tools.

Ever looked at a website and wondered what CSS, font, spacing, or HTML was used?

Just turn on Layr, move your mouse over an element, and click to inspect it.

Layr shows you the details in a clean side panel. You can explore the HTML, CSS, colors, fonts, dimensions, and more — all in one place.

No complicated tools. No unnecessary steps. Just point, click, and inspect.

## What can Layr do?

- Inspect any webpage element with a click.
- Highlight elements as you move your mouse.
- View HTML, CSS classes, IDs, and attributes.
- Explore computed CSS, colors, fonts, and spacing.
- View matching CSS rules where accessible.
- Copy HTML, CSS, and element details.
- Search CSS properties.
- Work without opening Chrome DevTools.

## Getting Started

Requirements:

- Google Chrome 116 or newer.
- Node.js 22.12 or newer and npm.

From the project folder, run:

```sh
npm install
npm run build
```

Then install Layr in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist` folder inside the project (`D:\layr\dist`).
5. Pin Layr from Chrome's Extensions menu so it is easy to find.

### How to Inspect

1. Open a regular website.
2. Click the Layr extension icon.
3. Make sure Inspector mode is **ON**. Clicking the toolbar icon turns it on automatically.
4. Hover over any element.
5. Click its inspect icon.
6. Explore its details in the Layr side panel.

On a tab that has not been activated yet, a message below the toggle explains how to grant access using Layr's icon in Chrome's top toolbar. After connecting, use the panel toggle to turn inspection on or off.

Press **Esc** to clear the selected element. Turn Inspector mode **OFF**, or close the Layr side panel, to stop inspecting and interact with the website normally.

### After Making Changes

Run:

```sh
npm run build
```

Then open `chrome://extensions` and click **Reload** on Layr. Refresh the website you were inspecting, then click Layr again.

To rebuild automatically while you work, run:

```sh
npm run dev
```

This watches the extension's source files and updates `dist`. Reload Layr and refresh the website after each change. Press **Ctrl+C** to stop.

To check TypeScript separately, run:

```sh
npm run typecheck
```

The production build also checks TypeScript. Generated `dist` and `node_modules` folders are kept out of Git.

## Privacy

Layr runs locally in your browser.
No account, backend, analytics, or cloud connection is required.
Layr does not send inspected page data anywhere.

Password field values are not read, and password value attributes are redacted from inspection details. Copying details only puts them on your clipboard.

## Limitations

Some Chrome internal pages and protected browser content cannot be inspected. Certain cross-origin CSS rules may also be inaccessible.

- Layr inspects iframe elements, but cannot explore the pages inside them. Closed shadow roots are also inaccessible.
- Source shows accessible matching rules, rather than a complete CSS cascade. Some advanced rules, such as nested CSS and container queries, are omitted with a note. Their final effects still appear in computed styles.
- Details are a snapshot. Use the refresh button to capture later changes. Page hover effects may differ while inspection is on.
- Local files need **Allow access to file URLs** enabled in Layr's Chrome extension settings.

## Built With

React, TypeScript, Vite, Tailwind CSS, Lucide React icons, and Chrome Extension Manifest V3.

---
