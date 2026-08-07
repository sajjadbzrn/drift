/* global browser, chrome */
"use strict";

// drift companion — background service worker (Chrome + Firefox MV3).
//
// Two paths, decided by whether drift is installed (detected via the native
// messaging host that drift registers on first run):
//   1. drift installed → downloads are handed to drift automatically.
//   2. drift missing   → browser downloads proceed untouched, and drift is
//                        suggested subtly (toolbar badge + popup CTA), at
//                        most once a day — never an interruption.

const NS = typeof browser !== "undefined" ? browser : chrome;
const HOST_NAME = "com.sajjadbzn.drift.host";
const INSTALL_URL = "https://github.com/sajjadbzrn/drift/releases/latest";
const HOST_TTL_MS = 15000;
const NUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULTS = { autoCapture: true, nudgeShownAt: 0 };

let settings = { ...DEFAULTS };
let hostState = "unknown"; // "unknown" | "connected" | "missing" | "forbidden"
let lastHostCheck = 0;
const selfDownloads = new Set(); // download ids started by this extension

// URL -> last-capture timestamp. Pages often re-trigger a download right
// after we cancel the browser copy; without this, drift would get several
// handoffs (and several save dialogs) for one user action.
const recentCaptures = new Map();
const CAPTURE_DEDUPE_MS = 4000;

// ---------------------------------------------------------------- helpers

/** Call a callback-style API and normalize it to a Promise (works with both
 *  Chrome's chrome.* and Firefox's promise-based browser.*). */
function call(fn, ...args) {
  return new Promise((resolve, reject) => {
    const settle = (res) => {
      const err = NS.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    };
    try {
      const ret = fn.call(NS, ...args, settle);
      if (ret && typeof ret.then === "function") {
        ret.then(resolve, (e) => reject(e instanceof Error ? e : new Error(String(e))));
      }
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function looksLikeUrl(s) {
  return /^(https?:\/\/)[^\s]+$/i.test((s || "").trim());
}

async function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...(await NS.storage.local.get(DEFAULTS)) };
  } catch (e) {
    settings = { ...DEFAULTS };
  }
}

function setBadge(text, color) {
  try {
    if (NS.action && NS.action.setBadgeText) NS.action.setBadgeText({ text });
    if (NS.action && NS.action.setBadgeBackgroundColor && color) {
      NS.action.setBadgeBackgroundColor({ color });
    }
  } catch (e) {
    /* badge is cosmetic — never fail a handoff because of it */
  }
}

/** Subtle, rate-limited install suggestion: a small "!" badge, cleared the
 *  moment drift is detected. Never pops a notification, never injects UI. */
async function maybeNudge() {
  const now = Date.now();
  if (now - (settings.nudgeShownAt || 0) < NUDGE_INTERVAL_MS) return;
  settings.nudgeShownAt = now;
  try {
    await NS.storage.local.set({ nudgeShownAt: now });
  } catch (e) {
    /* keep going without persistence */
  }
  setBadge("!", "#f59e0b");
}

// ------------------------------------------------------------- host state

/** Resolve to "connected" | "missing" | "forbidden". Cached for a short TTL;
 *  opening a port spawns the (tiny) drift-host process, so we avoid doing it
 *  more than necessary. */
function checkHost(force) {
  const now = Date.now();
  if (!force && now - lastHostCheck < HOST_TTL_MS && hostState !== "unknown") {
    return Promise.resolve(hostState);
  }
  return new Promise((resolve) => {
    let port = null;
    let settled = false;
    let sawPong = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (port) port.disconnect();
      } catch (e) {
        /* already disconnected */
      }
      hostState = state;
      lastHostCheck = now;
      if (state === "connected") setBadge("", null);
      resolve(state);
    };
    const timer = setTimeout(() => finish(sawPong ? "connected" : "missing"), 2000);
    try {
      port = NS.runtime.connectNative(HOST_NAME);
      port.onMessage.addListener((msg) => {
        if (msg && msg.type === "pong") sawPong = true;
        finish(sawPong ? "connected" : "forbidden");
      });
      port.onDisconnect.addListener(() => {
        const err = NS.runtime.lastError;
        const m = err && err.message ? err.message : "";
        finish(/forbidden|access.*denied|not allowed/i.test(m) ? "forbidden" : "missing");
      });
      port.postMessage({ type: "ping" });
    } catch (e) {
      finish("missing");
    }
  });
}

/** Send one request to the host and resolve "ok" or an error string.
 *  Retries once on disconnection/timeout with a 500ms delay before falling
 *  back, so a brief host restart doesn't drop the user's download. */
function sendToDrift(msg, retries = 0) {
  return new Promise((resolve) => {
    let port = null;
    let settled = false;
    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (port) port.disconnect();
      } catch (e) {
        /* already disconnected */
      }
      if (!ok && retries < 1) {
        setTimeout(() => {
          sendToDrift(msg, retries + 1).then(resolve);
        }, 500);
        return;
      }
      resolve(ok ? "ok" : err || "failed");
    };
    const timer = setTimeout(() => done(false, "timeout"), 6000);
    try {
      port = NS.runtime.connectNative(HOST_NAME);
      port.onMessage.addListener((m) => done(!!(m && m.ok), (m && m.error) || null));
      port.onDisconnect.addListener(() => done(false, "host-disconnected"));
      port.postMessage(msg);
    } catch (e) {
      done(false, String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------- auto-capture

NS.downloads.onCreated.addListener(async (item) => {
  try {
    if (!settings.autoCapture) return;
    if (selfDownloads.has(item.id)) {
      selfDownloads.delete(item.id);
      return;
    }
    const url = item && item.url;
    if (!url || !/^https?:\/\//i.test(url)) return;

    // Dedupe repeat captures of the same URL (see recentCaptures above).
    const now = Date.now();
    if (now - (recentCaptures.get(url) || 0) < CAPTURE_DEDUPE_MS) return;
    recentCaptures.set(url, now);
    if (recentCaptures.size > 100) {
      for (const [k, v] of recentCaptures) {
        if (now - v > 60000) recentCaptures.delete(k);
      }
    }

    const state = await checkHost();
    if (state !== "connected") {
      // drift not installed (or not yet allowed) — leave the download alone.
      // Only the "missing" case gets the install nudge; "forbidden" means
      // the user must allow this extension in drift's settings instead.
      if (state === "missing") await maybeNudge();
      return;
    }

    // Chrome reports the absolute local path here; drift only wants the name.
    const filename = item.filename ? item.filename.split(/[\\/]/).pop() || null : null;

    // Hand the download to drift FIRST, then cancel the browser copy, so a
    // failed handoff never loses the user's download.
    const res = await sendToDrift({
      type: "add",
      url,
      filename,
      referrer: item.referrer || null,
    });
    if (res === "ok") {
      try {
        await call(NS.downloads.cancel, item.id);
      } catch (e) {
        /* download already finished — the copy in drift is what matters */
      }
    } else {
      await maybeNudge();
    }
  } catch (e) {
    // never throw out of a listener
  } finally {
    if (item && item.id) selfDownloads.delete(item.id);
  }
});

// ---------------------------------------------------------- context menus

NS.runtime.onInstalled.addListener(() => {
  try {
    NS.contextMenus.removeAll();
  } catch (e) {
    /* not yet created */
  }
  NS.contextMenus.create({
    id: "drift-download-link",
    title: "Download link with drift",
    contexts: ["link"],
  });
  NS.contextMenus.create({
    id: "drift-download-page",
    title: "Download page with drift",
    contexts: ["page"],
  });
  NS.contextMenus.create({
    id: "drift-download-selection",
    title: "Download selection with drift",
    contexts: ["selection"],
  });
});

NS.contextMenus.onClicked.addListener(async (info, tab) => {
  let url = info.linkUrl || info.pageUrl || (tab && tab.url) || "";
  if (info.selectionText && looksLikeUrl(info.selectionText)) {
    url = info.selectionText.trim();
  }
  if (!url || !/^https?:\/\//i.test(url)) return;
  const referrer = (tab && tab.url) || "";

  const state = await checkHost();
  if (state === "connected") {
    const res = await sendToDrift({ type: "add", url, filename: null, referrer });
    if (res !== "ok") await maybeNudge();
  } else {
    // Fallback: run the download in the browser + the subtle install nudge.
    try {
      await call(NS.downloads.download, { url });
    } catch (e) {
      /* let the browser's own download proceed */
    }
    if (state === "missing") await maybeNudge();
  }
});

// ------------------------------------------------------ popup messaging

NS.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg) {
      sendResponse({ ok: false, error: "empty message" });
      return;
    }
    switch (msg.type) {
      case "getState": {
        const state = await checkHost(!!msg.force);
        sendResponse({
          ok: true,
          hostState: state,
          autoCapture: settings.autoCapture,
        });
        break;
      }
      case "setAutoCapture":
        settings.autoCapture = !!msg.value;
        try {
          await NS.storage.local.set({ autoCapture: settings.autoCapture });
        } catch (e) {
          /* non-persistent is acceptable */
        }
        sendResponse({ ok: true });
        break;
      case "sendPage": {
        if (!msg.url || !/^https?:\/\//i.test(msg.url)) {
          sendResponse({ ok: false, error: "invalid url" });
          break;
        }
        const state = await checkHost();
        if (state === "connected") {
          const res = await sendToDrift({
            type: "add",
            url: msg.url,
            filename: null,
            referrer: msg.referrer || null,
          });
          sendResponse({ ok: res === "ok", hostState: state, error: res === "ok" ? null : res });
        } else if (state === "forbidden") {
          // Extension ID not yet allowed in drift's settings — tell the user
          // instead of falling through to a page-download that would be wrong.
          sendResponse({
            ok: false,
            hostState: state,
            error: "Add this extension ID in drift Settings → Browser integration",
          });
        } else {
          try {
            await call(NS.downloads.download, { url: msg.url });
          } catch (e) {
            /* ignored */
          }
          await maybeNudge();
          sendResponse({ ok: true, hostState: state, fallback: true });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message type" });
    }
  })();
  return true; // keep the channel open for the async response
});

void loadSettings();

// Periodic cleanup of the recentCaptures dedupe map so it never grows
// unbounded between the inline prune inside onCreated (which only fires at
// size > 100). Runs every 30 seconds.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of recentCaptures) {
    if (now - v > 60000) recentCaptures.delete(k);
  }
}, 30000);

// Chrome MV3 kills service workers after ~30s of idling. A heartbeat alarm
// keeps the worker alive so auto-capture and host detection stay responsive.
try {
  NS.alarms.create("drift-heartbeat", { periodInMinutes: 0.33 });
  NS.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "drift-heartbeat") {
      void loadSettings();
      // Don't force a host check — just refresh the cached state and let
      // the next actual download request open a port if needed.
      void checkHost(false);
    }
  });
} catch (e) {
  // alarms API may not exist on all browsers (e.g. older Firefox versions) —
  // the extension still works, just without the idle-wake guarantee.
}
