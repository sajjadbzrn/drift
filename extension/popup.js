/* global browser, chrome */
"use strict";

const NS = typeof browser !== "undefined" ? browser : chrome;
const INSTALL_URL = "https://github.com/sajjadbzrn/drift/releases/latest";

const t = (key) => NS.i18n.getMessage(key) || key;

function $(id) {
  return document.getElementById(id);
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
}

async function sendMessage(msg, retries = 0) {
  try {
    return await NS.runtime.sendMessage(msg);
  } catch (e) {
    // MV3 service workers can be killed while the popup is open — retry once
    // to give Chrome time to wake the worker back up.
    if (retries < 1) {
      await new Promise((r) => setTimeout(r, 600));
      return sendMessage(msg, retries + 1);
    }
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function show(viewId) {
  ["connected-view", "missing-view", "forbidden-view"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== viewId);
  });
}

async function refresh() {
  $("checking").classList.remove("hidden");
  // force: true bypasses the background's 15s host-state cache, so opening
  // the popup (and the "Check again" button) always gives a fresh answer.
  const st = await sendMessage({ type: "getState", force: true });
  $("checking").classList.add("hidden");

  const state = st && st.hostState;
  const dot = $("status-dot");
  $("result").textContent = "";
  if (state === "connected") {
    dot.className = "dot dot-ok";
    $("status-line").textContent = t("connectedTitle");
    $("auto-capture").checked = !!(st && st.autoCapture);
    show("connected-view");
  } else if (state === "forbidden") {
    dot.className = "dot dot-warn";
    $("status-line").textContent = t("forbiddenTitle");
    $("ext-id").textContent = NS.runtime.id || "";
    show("forbidden-view");
  } else {
    dot.className = "dot dot-warn";
    $("status-line").textContent = t("notInstalledTitle");
    show("missing-view");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  $("install-btn").textContent = t("installDrift");
  $("send-page").textContent = t("sendPage");
  $("copy-id").textContent = t("copyId");
  $("refresh").textContent = t("refresh");
  $("checking").textContent = t("checking");

  $("auto-capture").addEventListener("change", (e) => {
    void sendMessage({ type: "setAutoCapture", value: e.target.checked });
  });

  $("send-page").addEventListener("click", async () => {
    const result = $("result");
    result.textContent = t("checking");
    let url = "";
    try {
      const tabs = await NS.tabs.query({ active: true, currentWindow: true });
      url = (tabs[0] && tabs[0].url) || "";
    } catch (e) {
      /* no tabs access */
    }
    if (!url || !/^https?:\/\//i.test(url)) {
      result.textContent = t("failed");
      return;
    }
    const res = await sendMessage({ type: "sendPage", url, referrer: url });
    if (res && res.ok) {
      result.textContent = res.fallback ? t("startedInBrowser") : t("sentToDrift");
      if (res.fallback) void refresh();
    } else {
      const err = (res && res.error) ? ` (${res.error})` : "";
      result.textContent = t("failed") + err;
    }
  });

  $("install-btn").addEventListener("click", () => {
    void NS.tabs.create({ url: INSTALL_URL });
  });

  $("copy-id").addEventListener("click", async () => {
    const id = $("ext-id").textContent;
    try {
      await navigator.clipboard.writeText(id);
    } catch (e) {
      /* clipboard unavailable */
    }
  });

  $("refresh").addEventListener("click", () => {
    void refresh();
  });

  void refresh();
});
