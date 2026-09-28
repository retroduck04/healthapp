import { createRoot } from "react-dom/client";
import { App } from "./ui/app";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);

// Offline support and updates.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      const announce = () => window.dispatchEvent(new Event("janos-update"));
      if (reg.waiting && navigator.serviceWorker.controller) announce();
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) announce();
        });
      });
      window.addEventListener("janos-apply-update", () => {
        reg.waiting?.postMessage("skip-waiting");
      });
      setInterval(() => void reg.update(), 60 * 60 * 1000);
    })
    .catch((e) => console.warn("Service worker failed", e));
  // Reload only when an update replaces a running version (not on the very first install).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}
