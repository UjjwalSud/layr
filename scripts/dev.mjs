import { build } from "vite";

const watchers = [];
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled(watchers.map((watcher) => watcher.close()));
  process.exit(code);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  // Start with a complete extension, then watch both bundles without either
  // watcher clearing files written by the other one.
  await build();
  await build({ configFile: "vite.content.config.ts" });
  for (const configFile of ["vite.config.ts", "vite.content.config.ts"]) {
    const watcher = await build({
      configFile,
      build: { watch: {}, emptyOutDir: false },
    });
    watchers.push(watcher);
    watcher.on("event", (event) => {
      if (event.code === "ERROR") console.error(event.error);
    });
  }
  console.log(
    "\nWatching Layr sources. Load dist/ in Chrome, then reload the extension and webpage after changes. Press Ctrl+C to stop.\n",
  );
} catch (error) {
  console.error(error);
  await stop(1);
}
