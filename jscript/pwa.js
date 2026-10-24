"use strict";

const installButton = document.getElementById("install-button");
const appStatus = document.getElementById("app-status");
let installPrompt;

function updateConnectionStatus() {
  if (!appStatus.dataset.modelState) return;
  appStatus.textContent = navigator.onLine
    ? appStatus.dataset.modelState
    : `${appStatus.dataset.modelState} · Offline`;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.hidden = true;
  appStatus.textContent = "App installed. Model analysis runs on this device; results are research outputs.";
});

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  });
}
