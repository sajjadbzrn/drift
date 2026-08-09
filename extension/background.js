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
// Every host check spawns the drift-host process, so the background heartbeat
// refreshes it at most this often (downloads and popup opens still check on
// demand — see the alarm listener at the bottom).
const HOST_REFRESH_MS = 5 * 60 * 1000;
const NUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULTS = { autoCapture: true, nudgeShownAt: 0, sendCookies: true };

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

/** Build a Cookie header for `url` from the browser's cookie jar, or null.
 *  Only used when the user enables the "send cookies" toggle; cookies are
 *  scoped to the download's own site, never sent anywhere else. */
async function getCookiesHeader(url) {
  if (!NS.cookies || !NS.cookies.getAll) return null;
  try {
    const cs = await call(NS.cookies.getAll, { url });
    if (!cs || cs.length === 0) return null;
    const header = cs.map((c) => `${c.name}=${c.value}`).join("; ");
    return header || null;
  } catch (e) {
    return null;
  }
}

const BATCH_MEDIA_RE = /\.(mp4|mkv|webm|mov|avi|m4v|flv|wmv|mp3|wav|flac|ogg|m4a|aac|opus|jpg|jpeg|png|gif|webp|svg|ico|bmp|zip|rar|7z|tar|gz|pdf)$/i;

/** Collect http(s) URLs from a page via chrome.scripting. The context-menu
 *  click grants activeTab access to that tab, so no broad host permission is
 *  needed at runtime for the page itself. */
async function collectPageUrls(tab, mediaOnly) {
  if (!NS.scripting || !NS.scripting.executeScript) return [];
  const grab = () => {
    const hrefs = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.href)
      .filter((h) => /^https?:\/\//i.test(h));
    const srcs = Array.from(
      document.querySelectorAll("video[src], audio[src], source[src], img[src]"),
    )
      .map((el) => el.currentSrc || el.src)
      .filter((h) => /^https?:\/\//i.test(h));
    return { hrefs, srcs };
  };
  try {
    const results = await NS.scripting.executeScript({ target: { tabId: tab.id }, func: grab });
    const first = results && results[0] && results[0].result;
    if (!first) return [];
    const raw = mediaOnly
      ? first.hrefs
          .filter((h) => {
            try {
              return BATCH_MEDIA_RE.test(new URL(h).pathname);
            } catch (e) {
              return false;
            }
          })
          .concat(first.srcs)
      : first.hrefs;
    const seen = new Set();
    const out = [];
    for (const u of raw) {
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
      if (out.length >= 60) break;
    }
    return out;
  } catch (e) {
    return [];
  }
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

/** Serial handoff queue. A page (or Chrome re-creating downloads from the
 *  previous session) can create several downloads at once; firing all their
 *  drift:// deep links simultaneously can race drift's cold start and spawn
 *  several save dialogs. Pacing handoffs one at a time keeps them calm. */
let handoffChain = Promise.resolve();
const HANDOFF_PACE_MS = 350;
function queueHandoff(fn) {
  const delay = () => new Promise((r) => setTimeout(r, HANDOFF_PACE_MS));
  // The pace applies on success and failure alike, so a failed handoff can't
  // let the next one fire immediately and re-race drift's cold start.
  const run = handoffChain.then(fn, fn).then(delay, delay);
  handoffChain = run.catch(() => {});
  return run;
}

NS.downloads.onCreated.addListener(async (item) => {
  try {
    if (!settings.autoCapture) return;
    if (selfDownloads.has(item.id)) {
      selfDownloads.delete(item.id);
      return;
    }
    const url = item && item.url;
    if (!url || !/^https?:\/\//i.test(url)) return;

    // Downloads Chrome re-created from a previous session (still in progress
    // when the browser last closed) are not fresh user actions: their links
    // are usually long-expired, and capturing them would make drift pop up a
    // burst of save dialogs and "failed to start" toasts on every browser
    // start. A fresh download always starts at zero bytes received.
    if (item.state === "interrupted" || item.paused || (item.bytesReceived ?? 0) > 0) {
      return;
    }

    // Dedupe repeat captures of the same URL (see recentCaptures above).
    const now = Date.now();
    if (now - (recentCaptures.get(url) || 0) < CAPTURE_DEDUPE_MS) return;
    recentCaptures.set(url, now);
    if (recentCaptures.size > 100) {
      for (const [k, v] of recentCaptures) {
        if (now - v > 60000) recentCaptures.delete(k);
      }
    }

    // Serialize the actual handoff so a burst of downloads can't race drift's
    // cold start (which would open several save dialogs at once).
    await queueHandoff(async () => {
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
      // Forward the site's cookies so login-protected downloads work in drift.
      const cookies = settings.sendCookies ? await getCookiesHeader(url) : null;

      // Hand the download to drift FIRST, then cancel the browser copy, so a
      // failed handoff never loses the user's download.
      const res = await sendToDrift({
        type: "add",
        url,
        filename,
        referrer: item.referrer || null,
        cookies,
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
    });
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
  NS.contextMenus.create({
    id: "drift-download-links",
    title: "Download all links with drift",
    contexts: ["page"],
  });
  NS.contextMenus.create({
    id: "drift-download-media",
    title: "Download all media with drift",
    contexts: ["page"],
  });
});

NS.contextMenus.onClicked.addListener(async (info, tab) => {
  // Batch menus: collect every link / media URL on the page and hand them all
  // to drift at once (the host paces the deep links).
  if (info.menuItemId === "drift-download-links" || info.menuItemId === "drift-download-media") {
    const mediaOnly = info.menuItemId === "drift-download-media";
    const urls = tab ? await collectPageUrls(tab, mediaOnly) : [];
    if (urls.length === 0) return;
    const state = await checkHost();
    if (state !== "connected") {
      if (state === "missing") await maybeNudge();
      return;
    }
    // Cookies are fetched per unique origin, once each.
    const cookieByOrigin = new Map();
    const items = [];
    for (const u of urls) {
      let origin = "";
      try {
        origin = new URL(u).origin;
      } catch (e) {
        continue;
      }
      if (!cookieByOrigin.has(origin)) {
        cookieByOrigin.set(origin, settings.sendCookies ? await getCookiesHeader(u) : null);
      }
      items.push({ url: u, cookies: cookieByOrigin.get(origin) });
    }
    const res = await sendToDrift({ type: "addBatch", urls: items });
    if (res !== "ok") await maybeNudge();
    return;
  }

  let url = info.linkUrl || info.pageUrl || (tab && tab.url) || "";
  if (info.selectionText && looksLikeUrl(info.selectionText)) {
    url = info.selectionText.trim();
  }
  if (!url || !/^https?:\/\//i.test(url)) return;
  const referrer = (tab && tab.url) || "";

  const state = await checkHost();
  if (state === "connected") {
    const cookies = settings.sendCookies ? await getCookiesHeader(url) : null;
    const res = await sendToDrift({ type: "add", url, filename: null, referrer, cookies });
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
          sendCookies: settings.sendCookies,
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
      case "setSendCookies":
        settings.sendCookies = !!msg.value;
        try {
          await NS.storage.local.set({ sendCookies: settings.sendCookies });
        } catch (e) {
          /* non-persistent is acceptable */
        }
        sendResponse({ ok: true });
        break;
      case "openDrift": {
        // Ask the host to fire a drift://open deep link — the OS launches
        // (or focuses) the drift app.
        const res = await sendToDrift({ type: "open" });
        sendResponse({ ok: res === "ok", error: res === "ok" ? null : res });
        break;
      }
      case "sendPage": {
        if (!msg.url || !/^https?:\/\//i.test(msg.url)) {
          sendResponse({ ok: false, error: "invalid url" });
          break;
        }
        const state = await checkHost();
        if (state === "connected") {
          const cookies = settings.sendCookies ? await getCookiesHeader(msg.url) : null;
          const res = await sendToDrift({
            type: "add",
            url: msg.url,
            filename: null,
            referrer: msg.referrer || null,
            cookies,
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

// Keyboard command (Ctrl+Shift+D): send the current page to drift.
try {
  NS.commands.onCommand.addListener(async (command) => {
    if (command !== "send-page-to-drift") return;
    try {
      const tabs = await NS.tabs.query({ active: true, currentWindow: true });
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url || !/^https?:\/\//i.test(url)) return;
      const state = await checkHost();
      if (state === "connected") {
        const cookies = settings.sendCookies ? await getCookiesHeader(url) : null;
        await sendToDrift({ type: "add", url, filename: null, referrer: url, cookies });
      } else if (state === "missing") {
        await maybeNudge();
      }
    } catch (e) {
      /* never throw out of a listener */
    }
  });
} catch (e) {
  // commands API may be unavailable on some browsers — the popup still works
}

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
      // Only re-check the host every few minutes — each check spawns the
      // drift-host process, and doing that on every 20s heartbeat wastes a
      // process while Chrome runs. Downloads and popup opens still refresh
      // host state on demand, so a stale badge is harmless and short-lived.
      if (Date.now() - lastHostCheck > HOST_REFRESH_MS) void checkHost(false);
    }
  });
} catch (e) {
  // alarms API may not exist on all browsers (e.g. older Firefox versions) —
  // the extension still works, just without the idle-wake guarantee.
}
