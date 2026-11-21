import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initializeTheme } from "./useTheme";
import "./styles.css";
import "./themes.css";

initializeTheme();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
