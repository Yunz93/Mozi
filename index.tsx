import React from "react";
import ReactDOM from "react-dom/client";
import App from "./src/App";
import { installFileDropNavigationGuard } from "./src/app/fileDropNavigationGuard";
import { TrayTaskPopover } from "./src/components/tasks/TrayTaskPopover";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import {
  isIgnorableWindowErrorEvent,
  reportUnhandledRuntimeError,
} from "./src/utils/errorHandler";
import { ensureExcalidrawAssetPath } from "./src/utils/excalidrawAssetPath";
import {
  ensureDynamicFontFaces,
  getInitialFontSettingsFromLocalStorage,
} from "./src/utils/fontSettings";

const removeFileDropNavigationGuard = installFileDropNavigationGuard();
if (import.meta.hot) import.meta.hot.dispose(removeFileDropNavigationGuard);

ensureExcalidrawAssetPath();
import "github-markdown-css/github-markdown.css";
import "katex/dist/katex.min.css";
import "./index.css";
import "./src/styles/markdown-theme.css";
import "./src/styles/editor.css";
import "./src/styles/preview.css";
import "./src/styles/components.css";
import "./src/styles/workspace.css";
import "./src/styles/workspace-settings.css";
import "./src/styles/tasks.css";

// Ensure process.env exists for some libraries
if (typeof window !== "undefined" && !window.process) {
  // @ts-ignore
  window.process = {
    env: {
      NODE_ENV: import.meta.env.MODE || "production",
    },
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    reportUnhandledRuntimeError(event.reason, "unhandledrejection");
  });
  window.addEventListener("error", (event) => {
    if (isIgnorableWindowErrorEvent(event)) {
      return;
    }
    reportUnhandledRuntimeError(event.error ?? event.message, "error");
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

async function bootstrap() {
  try {
    await ensureDynamicFontFaces(getInitialFontSettingsFromLocalStorage());
  } catch {
    // Fallback silently - App mount will retry font registration.
  }

  const root = ReactDOM.createRoot(rootElement!);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        {new URLSearchParams(window.location.search).get("trayTasks") ===
        "1" ? (
          <TrayTaskPopover />
        ) : (
          <App />
        )}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();
