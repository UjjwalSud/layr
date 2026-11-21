import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const storageKey = "layr-theme";

function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "light" ? "#f7f9fc" : "#101115",
  );
}

// Apply the saved preference before mounting the panel.
export function initializeTheme() {
  applyTheme(readTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    // Keep other open Layr panels in sync without extra extension permissions.
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setTheme(readTheme());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Switching still works for this panel if local storage is unavailable.
    }
  };

  return { theme, toggleTheme };
}
