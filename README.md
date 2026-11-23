# Layr

Look beyond the pixels.

Layr is a lightweight Chrome extension for exploring the HTML, CSS, fonts, and spacing behind a webpage, without opening Developer Tools.

Ever looked at a website and wondered what CSS, font, spacing, or HTML was used?

Turn on Layr, move your mouse over an element, and click its blue inspect icon. A small floating label shows what you're pointing at; the side panel gives you the full details.

Explore the element's HTML, accessible CSS rules, states, images, icons, dimensions, and box model in one scrollable inspector. Move through parents and children, or copy a readable, redacted snapshot.

No complicated tools. No unnecessary steps. Just point, click, and inspect.

## What can Layr do?

- Inspect any webpage element with a click.
- Highlight elements as you move your mouse.
- View HTML, CSS classes, IDs, and attributes.
- Explore computed CSS, colors, fonts, and spacing.
- View CSS grouped by its original selectors, alongside source filenames and links where accessible.
- Distinguish active and overridden author declarations for supported CSS, with unknown status where the cascade cannot be resolved reliably.
- Explore ancestor declarations, inherited CSS variables, and a visual box model.
- Navigate parents and children using a DOM breadcrumb path.
- Copy HTML, CSS, and element details.
- Use **Copy All Details** for an organized snapshot, or copy individual declarations, rules, HTML, attributes, selectors and paths.
- Read accessible state definitions, captured active states, `::before` / `::after` rules and generated pseudo-element values without forcing the page into a different state.
- Distinguish inactive media/support conditions and disabled stylesheets from the current cascade.
- Preview image resources and SVG markup; open or copy resource URLs and explicitly download accessible originals or captured SVG.
- Search CSS properties.
- Work without opening Chrome DevTools.
- Switch between light and dark side-panel themes; your choice stays on this browser.
- Keep a frozen inspection snapshot while the inspector is OFF or the selected element disappears.

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

The panel has no inspection tabs. Its compact **Selected element** summary shows the tag, ID, classes, short text, element type, selector and visual dimensions. The same scrollable view contains collapsible sections:

1. **HTML / Element details** — tag, ID, classes, text, attributes, captured HTML, parent breadcrumbs and an expandable subtree. Use **Select parent**, a breadcrumb, **Child elements**, or a tree node to select a live element. Copy HTML, attributes, selector or element path.
2. **CSS styles** — inline declarations and matching source rules grouped by selector. Each rule shows its accessible stylesheet source and media/support context. Search filters declarations and computed values. Expand **Inherited styles**, **Inactive conditional rules** or **Computed properties** as needed. The computed group selector includes typography, colors, layout, effects and variables. These are final values, separate from original declarations. Declaration status is **applied**, **overridden** or **unknown**; inherited entries are labeled as candidates.
3. **States & pseudo-elements** — accessible hover, focus, focus-visible, active, disabled and checked definitions, plus before/after rules and generated computed values. Labels describe the state at capture time. Selected options record their `selected` state; `:selected` is not a standard CSS pseudo-class. Layr never forces states or simulates a normal/hover comparison.
4. **Images**, when relevant — image, picture/currentSrc/srcset, CSS background and SVG image-reference details. Preview, open, copy or download the resource. Original dimensions are shown only when already known from an image element.
5. **Icons**, when identified — inline/referenced SVG, observable font glyphs, pseudo-element glyphs/images and image icons. Copy SVG or icon HTML, and download captured SVG or accessible resources. No library names or URLs are guessed.
6. **Layout & box model** — captured margin, border, padding and content dimensions, followed by compact display/position information. Expand dimensions, flex/grid and appearance/typography for more detail.
7. **Source coverage** — capture limitations and source availability notes. This is the final section, immediately after Layout & box model.

Secondary sections render when expanded. Everything stays in the same panel. **Copy All Details** includes available source, computed, state, hierarchy and media information; **Copy all available CSS** includes the CSS capture and its limitations. The header keeps Inspector ON/OFF, Freeze Hover, Clear Selection and the existing theme preference. The selected summary also retains Refresh.

CSS declarations using `var(...)` keep their original value and show the selected element's actual computed value directly underneath, with separate copy controls. This works for colors, spacing, fonts, layout, shorthands and other custom property values. Concrete CSS colors get a small swatch. Expand a variable to see accessible declarations, defining selectors/elements, stylesheet links and declared fallbacks. **CSS variables** also lists captured custom properties, including inherited and unresolved references. Nested-variable dependency values are captured on the defining element: overriding a dependency on a child does not retroactively change an inherited variable's computed value. Theme changes appear only after an explicit new capture or Refresh.

Variable source labels compare accessible author declarations, including ordinary `:root` and attribute-based theme selectors, specificity, inline styles and importance. Incomplete sources, unsupported selectors/cascade features, CSS-wide resets or uncertain inheritance keep definitions labeled as candidates. Registered properties and browser/user styles can affect inheritance. Empty values are labeled **empty or unresolved**, since a valid empty variable, missing value and invalid/circular value cannot always be distinguished through CSSOM. Fallback text is shown as declared; Layr does not guess whether it was used or evaluate variables itself. Source line numbers remain unavailable when CSSOM does not provide them. Variable details are saved with the existing redacted snapshot and remain available after OFF, DOM removal and panel reopening.

On a tab that has not been activated yet, a message below the toggle explains how to grant access using Layr's icon in Chrome's top toolbar. After connecting, use the panel toggle to turn inspection on or off.

For a tooltip or hover menu, press **Alt+Shift+F** while it is visible, or use **Freeze** in the panel. **Hover frozen** shows a compact list with tag, classes, role, text and **Live**/**Captured** status. Select a target to view its full read-only HTML, CSS, computed styles, captured interaction state and layout. You can move away from the trigger and select a captured target after CSS hides it or React removes its portal. The page continues to receive its normal hover and leave events.

The shortcut is registered as a Chrome extension command. If another extension or the operating system uses the same keys, assign Layr a shortcut at `chrome://extensions/shortcuts`. After updating the extension, reload Layr at `chrome://extensions` and refresh the inspected webpage so both the panel and content script use the new build.

**Unfreeze** or **Esc** resumes normal inspection and keeps the selected snapshot. Mouse movement and page clicks do not replace the selection while frozen. **Clear selection** explicitly deletes the selected snapshot. Turn Inspector mode **OFF**, or close the Layr side panel, to stop inspecting and interact with the website normally.

Turning the inspector **OFF** stops hover tracking, observers and capture timers, clears temporary target buffers and removes highlights and floating icons. It keeps the selected snapshot labeled **Saved inspection**, with **Inspector OFF** shown in the status bar. HTML, CSS, layout, captured hierarchy, media, search, and copy actions remain available. Collapsing a section never deletes captured data. **Clear selection** explicitly removes the snapshot.

Snapshots are isolated by browser tab and survive closing/reopening the panel, component remounts, and page reloads within the current extension session. Turning inspection ON again keeps the previous snapshot until you explicitly select another element. Refresh and DOM navigation require active inspection and a live selection; after stopping inspection or restoring saved data, use **Select another element** or click a new element on the webpage. Moving the mouse, hiding a dropdown, or removing its DOM node never recaptures or clears the snapshot.

Use the sun/moon button in the header to switch between light and dark mode. Dark is the default. Layr remembers your choice locally across panel sessions; this changes the panel's appearance without changing the website you're inspecting.

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
Layr does not upload inspection snapshots. Image previews load their original resource URL, and explicitly downloading an image makes a resource request. Resource actions omit the page referrer; downloads omit credentials. Redacted resource URLs are never requested.

Redacted snapshots are kept in `chrome.storage.session`, an in-memory store keyed by tab ID. The `storage` permission enables this session-only preservation; inspection data is not written to `chrome.storage.local`, sync storage, or localStorage. A tab's snapshot is removed when that tab closes or when you clear its selection. Chrome clears session storage on browser restart, extension reload/update, or extension disable. Theme preferences remain in localStorage separately.

Password field values are not read. Form value attributes, textarea/select contents, editable text, scripts, inline event handlers, sensitive attributes and recognized secret patterns are redacted before inspection details leave the page context. URL query/fragment parameter values and URL credentials are also redacted. Sensitive CSS custom properties are redacted.

Redaction is heuristic and cannot recognize every private value in arbitrary page text or CSS. Review copied details before sharing them. Copying only puts details on your clipboard.

## Limitations

Some Chrome internal pages and protected browser content cannot be inspected. Certain cross-origin CSS rules may also be inaccessible.

- Layr inspects iframe elements, but cannot explore the pages inside them. Closed shadow roots are also inaccessible.
- Source separates accessible author declarations from final computed styles. Applied/overridden labels cover simple type, class, and ID selectors, specificity, importance, inline styles, source order, and resolved shorthand conflicts. Unknown status covers incomplete sources, cascade layers, advanced selectors, logical/physical property conflicts, animations/transitions, and unresolved shorthand overrides. Inactive media/support rules are kept separately and excluded from cascade classification. Some advanced rules, such as nested CSS and container queries, are omitted with a note. Their final effects still appear in computed styles. CSSOM does not supply reliable source line numbers; Layr never invents them and needs no debugger permission.
- Inherited source entries show candidates for common inherited properties and CSS variables from the nearest 20 ancestors. They do not prove that a value reaches the selection; explicit inheritance, resets, and registered custom properties may behave differently. Browser/user styles and the complete shadow-boundary cascade are not resolved. Accessible simple state/pseudo selectors are listed; selectors with functional nesting, attributes or escapes are not generalized to infer inactive states. Pseudo computed values are captured only when `content` generates an element. No additional hover/normal snapshots are synthesized.
- Child navigation lists up to 100 children, including children of open shadow roots. The captured light-DOM tree is limited to 120 elements and five descendant levels. It remains expandable after DOM removal or OFF. Select a live child to explore deeper; captured temporary targets and restored snapshots do not expose live navigation. Breadcrumbs can cross open shadow-root hosts. HTML cloning is bounded to 2,000 nodes and 80 levels, with a 60,000-character serialization limit and an explicit truncation indication.
- Media discovery examines at most 80 elements within four levels below the selection, plus its selected background and containing SVG. Image format labels are URL hints. Natural dimensions for background images and SVG references are unavailable unless already captured through an image element. Downloads preserve original resource bytes when CORS and browser policy allow access. Authenticated, cross-origin, file, expired blob or unavailable resources may fail; use Open Image to save manually. No new download or host permissions are added; CSP allows resource fetches for user-initiated downloads. Previews are resource/markup previews, not saved pixels; external styling, fonts and references may differ or disappear. Local SVG symbols are embedded where accessible (up to eight direct references); font icon detection uses observable private-use glyphs, and image-icon detection uses explicit icon/logo/symbol metadata. CSS-only shapes and arbitrary JavaScript-drawn icons cannot always be identified.
- Details are a snapshot. Use the refresh button to capture later changes. Freeze Hover preserves captured data without forcing CSS `:hover`, blocking leave/blur events, changing application state, pausing JavaScript or executing captured markup. Live elements are used while still available; hidden or removed targets have a read-only inspection preview in the panel, rather than an interactive reconstruction of the original UI. The label itself does not intercept pointer events; frames are shielded because their click events cannot be intercepted by the parent page. Page handlers registered earlier at the window capture phase can run before Layr's listeners.
- Temporary detection uses roles, ARIA descriptions, open-state attributes, nearby positioned elements and inserted subtrees, including document-level portals and observed open shadow roots. While a trigger stays hovered, known candidates are rechecked every 100 ms to catch CSS delays and transitions without rescanning the document. Discovery is bounded: 80 weak candidates, 160 nodes per local search, 16 buffered snapshots, up to eight menu descendants, and an eight-second recent-capture window before freezing. Captures skip subtrees larger than 200 descendants and batch work with a time budget. Very brief UI, unmarked distant elements, pseudo-element-only tooltips, closed shadow roots, or targets beyond these limits may be missed. Press the shortcut while the target is visible for best results. Frozen targets remain until Unfreeze/OFF; selected snapshots retain the existing session lifecycle.
- Local files need **Allow access to file URLs** enabled in Layr's Chrome extension settings.
- A saved snapshot can predate a page reload or navigation in the same tab. It is captured data, not live DOM; select a new element to replace it. Session snapshots do not survive browser restarts or extension reloads and are subject to Chrome's session-storage quota.

## Checks

```sh
npm run build
npm test
```

Tests exercise the production build in Playwright Chromium, including selection, normal hover behavior, CSS coverage, DOM navigation, redaction, clipboard output, themes, and saved-snapshot lifecycle. The unified-inspector regression verifies source links, inactive rules, state definitions, declaration copies, tree expansion after removal/OFF, bounded capture, picture/background images, original-byte downloads, SVG exports, pseudo/font icons, unavailable previews and redacted resource blocking. Freeze Hover regressions include a CSS tooltip, an actual React portal removed on pointer leave with preserved hierarchy, dropdown child selection, shortcut/panel controls, Escape/Unfreeze preservation, OFF cleanup and a 6,000-node page with incremental DOM updates and an audit for whole-document rescans. Snapshot regressions cover DOM removal, ON/OFF toggles, listener cleanup, remounts, page reloads, per-tab isolation, explicit clearing, and tab-close cleanup. Panels are checked at 280px and 360px. If Chromium is not installed for Playwright, run `npx playwright install chromium` first.

CSS-variable regressions cover inherited values, nested definitions, theme and `!important` overrides, missing/empty/circular values, nested and literal fallbacks, escaped/Unicode names, pending-substitution shorthands, restricted stylesheet sources, clipboard copies, color swatches, alias redaction and snapshot preservation after removal/OFF/reopening.

## Built With

React, TypeScript, Vite, Tailwind CSS, Lucide React icons, and Chrome Extension Manifest V3.

---
