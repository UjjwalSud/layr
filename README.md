# Layr

Look beyond the pixels.

Layr is a lightweight Chrome extension for exploring the HTML, CSS, fonts, and spacing behind a webpage, without opening Developer Tools.

Ever looked at a website and wondered what CSS, font, spacing, or HTML was used?

Turn on Layr, move your mouse over an element, and click its blue inspect icon. A small floating label shows what you're pointing at; the side panel gives you the full details.

Explore the element's HTML, computed styles, accessible CSS rules, colors, fonts, dimensions, and box model in one place. Move through parents and children from the panel, or copy a readable, redacted snapshot for your next AI prompt.

No complicated tools. No unnecessary steps. Just point, click, and inspect.

## What can Layr do?

- Inspect any webpage element with a click.
- Highlight elements as you move your mouse.
- View HTML, CSS classes, IDs, and attributes.
- Explore computed CSS, colors, fonts, and spacing.
- View matching CSS rules where accessible.
- Distinguish active and overridden author declarations for supported CSS, with unknown status where the cascade cannot be resolved reliably.
- Explore ancestor declarations, inherited CSS variables, and a visual box model.
- Navigate parents and children using a DOM breadcrumb path.
- Copy HTML, CSS, and element details.
- Use **Copy for AI** to copy tag, text, classes, HTML, dimensions, computed styles, and matching source selectors. Nothing is sent to an AI service.
- Search CSS properties.
- Work without opening Chrome DevTools.
- Switch between light and dark side-panel themes; your choice stays on this browser.

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

The hover label includes the tag, up to two CSS classes, dimensions, and a short direct-text preview when available. Page hover effects and hover listeners continue to work. Selection clicks are intercepted so buttons and links are not activated. You can also click an element directly to select it.

Use **DOM navigation** to select a breadcrumb ancestor, **Select parent**, or expand **Child elements** and pick a child. **Styles** contains final computed values and a **Variables** filter; **Source** contains matching declarations and inherited source candidates. **Layout** shows the box model and visual bounds. Use **Copy inspection** or **Copy for AI** for a readable snapshot.

On a tab that has not been activated yet, a message below the toggle explains how to grant access using Layr's icon in Chrome's top toolbar. After connecting, use the panel toggle to turn inspection on or off.

Press **Esc** to clear the selected element. Turn Inspector mode **OFF**, or close the Layr side panel, to stop inspecting and interact with the website normally.

Use the sun/moon button beside the inspector toggle to switch between light and dark mode. Dark is the default. Layr remembers your choice locally across panel sessions; this changes the panel's appearance without changing the website you're inspecting.

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

Password field values are not read. Form value attributes, textarea/select contents, editable text, scripts, inline event handlers, sensitive attributes and recognized secret patterns are redacted before inspection details leave the page context. URL query/fragment parameter values and URL credentials are also redacted. Sensitive CSS custom properties are redacted.

Redaction is heuristic and cannot recognize every private value in arbitrary page text or CSS. Review copied details before sharing them. Copying only puts details on your clipboard; Layr does not contact an AI service.

## Limitations

Some Chrome internal pages and protected browser content cannot be inspected. Certain cross-origin CSS rules may also be inaccessible.

- Layr inspects iframe elements, but cannot explore the pages inside them. Closed shadow roots are also inaccessible.
- Source separates accessible author declarations from final computed styles. Active/overridden labels cover simple type, class, and ID selectors, specificity, importance, inline styles, source order, and resolved shorthand conflicts. Unknown status covers incomplete sources, cascade layers, advanced selectors, logical/physical property conflicts, animations/transitions, and unresolved shorthand overrides. Some advanced rules, such as nested CSS and container queries, are omitted with a note. Their final effects still appear in computed styles.
- Inherited source entries show candidates for common inherited properties and CSS variables from the nearest 20 ancestors. They do not prove that a value reaches the selection; explicit inheritance, resets, and registered custom properties may behave differently. Browser/user styles, pseudo-elements, and the complete shadow-boundary cascade are not resolved.
- Child navigation lists up to 100 children, including children of open shadow roots. Select a child to continue deeper. Breadcrumbs can cross open shadow-root hosts.
- Details are a snapshot. Use the refresh button to capture later changes. Moving to the inspect icon can end the target's hover state. The label itself does not intercept pointer events; frames are shielded because their click events cannot be intercepted by the parent page. Page handlers registered earlier at the window capture phase can run before Layr's listeners.
- Local files need **Allow access to file URLs** enabled in Layr's Chrome extension settings.

## Checks

```sh
npm run build
npm test
```

Tests exercise the production build in Playwright Chromium, including selection, normal hover behavior, CSS coverage, DOM navigation, redaction, clipboard output, and panel lifecycle. If Chromium is not installed for Playwright, run `npx playwright install chromium` first.

## Built With

React, TypeScript, Vite, Tailwind CSS, Lucide React icons, and Chrome Extension Manifest V3.

---
