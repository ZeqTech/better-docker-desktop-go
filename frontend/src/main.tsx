import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { api } from "./api";
import { SettingsProvider } from "./SettingsContext";
import { loadSettings } from "./settings";
import "./App.css";

const stored = loadSettings();

// The Docker CLI path must be known before the first status check runs. A saved path that is no
// longer valid (moved, deleted, or refused by the stricter checks) is dropped so Settings does not
// show a path the app is not actually using.
api
  .setDockerPath(stored.dockerPath)
  .then(() => stored)
  .catch(() => ({ ...stored, dockerPath: "" }))
  .then((initial) => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <SettingsProvider initial={initial}>
          <App />
        </SettingsProvider>
      </React.StrictMode>,
    );
  });
