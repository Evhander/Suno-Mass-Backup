const STATE_KEY = "smb_v4_state";
const CHUNK_PREFIX = "smb_v4_chunk_";
const DONE_PREFIX = "smb_v4_done_";
const ALARM_NAME = "smb_v4_recovery";
const API_BASES = [
  "https://studio-api-prod.suno.com",
  "https://studio-api.prod.suno.com"
];

let scanLoopRunning = false;
let downloadLoopRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function defaultState() {
  return {
    version: 8,
    scan: {
      status: "idle",
      indexMode: "full",
      pages: 0,
      songs: 0,
      liked: 0,
      seen: 0,
      cursor: null,
      hasMore: true,
      startedAt: null,
      lastActivity: null,
      tabId: null,
      apiBase: API_BASES[0],
      error: null
    },
    download: {
      status: "idle",
      scope: "liked",
      targetTotal: 0,
      format: "wav",
      fallbackMp3: false,
      delayMs: 1200,
      page: 1,
      index: 0,
      processed: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      currentTitle: "",
      startedAt: null,
      lastActivity: null,
      error: null,
      lastFailure: null
    },
    logs: []
  };
}

async function getState() {
  const obj = await chrome.storage.local.get(STATE_KEY);
  const s = obj[STATE_KEY] || defaultState();
  s.scan ||= defaultState().scan;
  s.download ||= defaultState().download;
  s.logs ||= [];

  if (typeof s.scan.seen !== "number") s.scan.seen = 0;
  if (typeof s.scan.liked !== "number") s.scan.liked = 0;
  if (!s.scan.indexMode) s.scan.indexMode = "legacy";
  if (!s.download.scope) s.download.scope = "liked";
  if (typeof s.download.targetTotal !== "number") s.download.targetTotal = 0;
  return s;
}

async function setState(s) {
  await chrome.storage.local.set({[STATE_KEY]: s});
}

async function patch(mutator) {
  const s = await getState();
  mutator(s);
  await setState(s);
  return s;
}

async function addLog(text) {
  await patch(s => {
    s.logs.push({t: Date.now(), text});
    if (s.logs.length > 80) s.logs = s.logs.slice(-80);
  });
}

function browserToken() {
  return JSON.stringify({
    token: btoa(JSON.stringify({timestamp: Date.now()}))
  });
}

async function heartbeatSleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(Math.min(2000, end - Date.now()));
    await chrome.storage.local.set({"smb_v4_heartbeat": Date.now()});
  }
}

async function allowAutomaticDownloads() {
  try {
    await chrome.contentSettings.automaticDownloads.set({
      primaryPattern: "https://*.suno.com/*",
      setting: "allow",
      scope: "regular"
    });
    return true;
  } catch (e) {
    await addLog("Could not enable automatic multiple downloads: " + e.message).catch(() => {});
    return false;
  }
}

async function automaticDownloadsStatus() {
  try {
    const r = await chrome.contentSettings.automaticDownloads.get({
      primaryUrl: "https://suno.com/"
    });
    return r?.setting || "unknown";
  } catch (_) {
    return "unknown";
  }
}

async function setDownloadUi(enabled) {
  try {
    await chrome.downloads.setUiOptions({enabled});
  } catch (_) {}
}

async function findSunoTab(preferredId = null) {
  if (preferredId) {
    try {
      const tab = await chrome.tabs.get(preferredId);
      if (tab && /^https:\/\/([a-z0-9-]+\.)?suno\.com\//i.test(tab.url || "")) return tab;
    } catch (_) {}
  }

  const tabs = await chrome.tabs.query({
    url: ["https://suno.com/*", "https://*.suno.com/*"]
  });
  if (!tabs.length) {
    throw new Error("No Suno tab found. Open suno.com and sign in.");
  }
  return tabs.find(t => t.active) || tabs[0];
}

async function freshAuth(tabId) {
  const results = await chrome.scripting.executeScript({
    target: {tabId},
    world: "MAIN",
    func: async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      function cookie(name) {
        const row = document.cookie
          .split(";")
          .map(x => x.trim())
          .find(x => x.startsWith(name + "="));
        return row ? decodeURIComponent(row.slice(name.length + 1)) : null;
      }

      let jwt = null;
      for (let i = 0; i < 40; i++) {
        try {
          if (window.Clerk?.session) {
            jwt = await window.Clerk.session.getToken();
            if (jwt) break;
          }
        } catch (_) {}
        await sleep(250);
      }

      if (!jwt) {
        return {ok: false, error: "Could not read your Suno session. Reload suno.com and make sure you are signed in."};
      }

      let deviceId = cookie("suno_device_id");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        document.cookie = `suno_device_id=${encodeURIComponent(deviceId)}; path=/; max-age=31536000; SameSite=Lax`;
      }

      return {ok: true, jwt, deviceId};
    }
  });

  const v = results?.[0]?.result;
  if (!v?.ok) throw new Error(v?.error || "Could not obtain the Suno session.");
  return v;
}

async function apiRequest(path, opts = {}) {
  const method = opts.method || "GET";
  const body = opts.body;
  let preferredBase = opts.apiBase || API_BASES[0];
  let preferredTabId = opts.tabId || null;
  let lastError = null;

  for (let outer = 0; outer < 8; outer++) {
    const tab = await findSunoTab(preferredTabId);
    preferredTabId = tab.id;
    const auth = await freshAuth(tab.id);

    for (const base of [preferredBase, ...API_BASES.filter(x => x !== preferredBase)]) {
      try {
        const headers = {
          "Authorization": `Bearer ${auth.jwt}`,
          "Accept": "*/*",
          "browser-token": browserToken(),
          "device-id": auth.deviceId
        };
        if (body !== undefined) headers["Content-Type"] = "application/json";

        const res = await fetch(base + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body)
        });

        if (res.status === 429) {
          const retry = Number(res.headers.get("retry-after"));
          const waitSec = Number.isFinite(retry) && retry > 0
            ? Math.min(120, retry)
            : Math.min(120, 8 * Math.pow(2, outer));
          await addLog(`HTTP 429 · waiting ${waitSec}s.`);
          await heartbeatSleep(waitSec * 1000);
          lastError = new Error("HTTP 429");
          break;
        }

        if (res.status === 401) {
          lastError = new Error("HTTP 401");
          break;
        }

        if (res.ok || [402,403,404].includes(res.status)) {
          return {res, base, tabId: tab.id};
        }

        const text = (await res.text()).slice(0, 500);
        lastError = new Error(`HTTP ${res.status}: ${text}`);
      } catch (e) {
        lastError = e;
      }
    }

    await heartbeatSleep(700);
  }

  throw lastError || new Error("Suno did not respond.");
}

async function removeChunks(maxPages) {
  const keys = [];
  for (let i = 1; i <= Math.max(maxPages || 0, 1); i++) keys.push(CHUNK_PREFIX + i);
  if (keys.length) await chrome.storage.local.remove(keys);
}

function likedByMe(clip) {
  if (clip?.is_liked === true || clip?.is_liked === 1 || clip?.is_liked === "true") return true;

  const reaction = clip?.reaction;
  if (typeof reaction === "string") {
    return ["like", "liked", "upvote", "thumbs_up", "heart"].includes(reaction.toLowerCase());
  }
  if (reaction && typeof reaction === "object") {
    const t = String(reaction.type || reaction.reaction || reaction.name || "").toLowerCase();
    return ["like", "liked", "upvote", "thumbs_up", "heart"].includes(t);
  }
  return false;
}

function minimalClip(clip) {
  return {
    id: clip.id,
    title: clip.title || clip.id,
    audio_url: clip.audio_url || null,
    created_at: clip.created_at || null,
    status: clip.status || null,
    is_liked: likedByMe(clip)
  };
}

async function migrateToV8() {
  const s = await getState();
  let changed = false;

  if (s.version !== 8) {
    s.version = 8;
    changed = true;
  }

  if (s.scan.indexMode !== "full-v8" && s.scan.status !== "idle") {
    if (s.scan.status === "running") s.scan.status = "paused";
    s.scan.error = "V8 needs one full rescan so you can switch between Likes and All without scanning again.";
    s.scan.indexMode = "legacy";
    changed = true;
  }

  if (changed) {
    await setState(s);
    await addLog("V8 enabled · one full rescan stores ALL songs plus the Like flag, then Likes/All can be changed instantly.");
  }
}

async function startNewScan() {
  const old = await getState();
  await removeChunks(old.scan.pages);

  const tab = await findSunoTab();
  const s = defaultState();
  s.scan.status = "running";
  s.scan.indexMode = "full-v8";
  s.scan.startedAt = Date.now();
  s.scan.lastActivity = Date.now();
  s.scan.tabId = tab.id;
  s.logs = [{
    t: Date.now(),
    text: "V8 full scan started. All songs will be indexed; Like status is stored for each song."
  }];
  await setState(s);

  runScanLoop().catch(scanError);
}

async function scanError(e) {
  await patch(s => {
    s.scan.status = "error";
    s.scan.error = e.message;
    s.scan.lastActivity = Date.now();
  });
  await addLog("SCAN ERROR: " + e.message);
}

async function resumeScan() {
  await patch(s => {
    if (["paused","error","running"].includes(s.scan.status)) {
      s.scan.status = "running";
      s.scan.error = null;
      s.scan.lastActivity = Date.now();
    }
  });
  runScanLoop().catch(scanError);
}

async function pauseScan() {
  await patch(s => {
    if (s.scan.status === "running") s.scan.status = "paused";
    s.scan.lastActivity = Date.now();
  });
  await addLog("Scan paused. Cursor saved.");
}

async function runScanLoop() {
  if (scanLoopRunning) return;
  scanLoopRunning = true;

  try {
    while (true) {
      let s = await getState();
      if (s.scan.status !== "running") break;

      const body = s.scan.cursor ? {cursor: s.scan.cursor} : {};
      await addLog(`Requesting page ${s.scan.pages + 1}…`);

      const {res, base, tabId} = await apiRequest("/api/feed/v3", {
        method: "POST",
        body,
        apiBase: s.scan.apiBase,
        tabId: s.scan.tabId
      });

      if (!res.ok) throw new Error(`feed/v3 returned HTTP ${res.status}`);

      const data = await res.json();
      const rawClips = Array.isArray(data?.clips) ? data.clips : [];
      const clips = rawClips.filter(c => c?.id).map(minimalClip);
      const likedCount = clips.reduce((n, c) => n + (c.is_liked ? 1 : 0), 0);
      const page = s.scan.pages + 1;

      await chrome.storage.local.set({[CHUNK_PREFIX + page]: clips});

      s = await getState();
      s.scan.pages = page;
      s.scan.songs += clips.length;
      s.scan.liked += likedCount;
      s.scan.seen += rawClips.length;
      s.scan.cursor = data?.next_cursor || null;
      s.scan.hasMore = !!data?.has_more && !!data?.next_cursor;
      s.scan.lastActivity = Date.now();
      s.scan.apiBase = base;
      s.scan.tabId = tabId;
      s.scan.error = null;
      s.scan.indexMode = "full-v8";
      await setState(s);

      await addLog(`Page ${page}: +${clips.length} songs · ❤️ +${likedCount} · totals ${s.scan.songs} / ❤️ ${s.scan.liked}.`);

      if (!s.scan.hasMore) {
        await patch(st => {
          st.scan.status = "ready";
          st.scan.lastActivity = Date.now();
          st.scan.indexMode = "full-v8";
        });
        await addLog(`Scan complete: ${s.scan.songs} songs · ❤️ ${s.scan.liked} Likes.`);
        break;
      }

      await heartbeatSleep(1250);
    }
  } finally {
    scanLoopRunning = false;
  }
}

function doneKey(id, format) {
  return DONE_PREFIX + format + "_" + id;
}

async function historyStatus(id, format) {
  const key = doneKey(id, format);
  const obj = await chrome.storage.local.get(key);
  const rec = obj[key];
  if (!rec) return {done: false};

  if (rec.downloadId) {
    try {
      const rows = await chrome.downloads.search({id: rec.downloadId});
      if (rows.length) {
        const d = rows[0];
        if (d.state === "complete" || d.state === "in_progress") return {done: true};
        if (d.state === "interrupted") return {done: false};
      }
    } catch (_) {}
  }

  return {done: true};
}

async function markDone(song, format, downloadId, filename) {
  await chrome.storage.local.set({
    [doneKey(song.id, format)]: {
      id: song.id,
      format,
      downloadId,
      filename,
      at: Date.now()
    }
  });
}

function safeFilename(name) {
  let s = String(name || "Untitled")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!s) s = "Untitled";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) s = "_" + s;
  return s.slice(0, 145);
}

async function downloadShouldRun() {
  return (await getState()).download.status === "running";
}

async function resolveWav(song, state) {
  const conv = await apiRequest(`/api/gen/${song.id}/convert_wav/`, {
    method: "POST",
    apiBase: state.scan.apiBase,
    tabId: state.scan.tabId
  });

  if ([402,403,404].includes(conv.res.status)) {
    throw new Error(`WAV unavailable (HTTP ${conv.res.status})`);
  }

  for (let n = 0; n < 60; n++) {
    if (!(await downloadShouldRun())) throw new Error("PAUSED");

    const q = await apiRequest(`/api/gen/${song.id}/wav_file/`, {
      method: "GET",
      apiBase: conv.base,
      tabId: conv.tabId
    });

    if ([402,403].includes(q.res.status)) {
      throw new Error(`WAV unavailable (HTTP ${q.res.status})`);
    }

    if (q.res.ok) {
      const j = await q.res.json().catch(() => ({}));
      const url = j?.wav_file_url || j?.wav_url || j?.audio_url_wav || null;
      if (url) return url;
    }

    await heartbeatSleep(3000);
  }

  throw new Error("WAV conversion exceeded 3 minutes.");
}

async function initiateDownload(song, format, fallbackMp3, state) {
  let url = null;
  let ext = format;

  if (format === "wav") {
    try {
      url = await resolveWav(song, state);
    } catch (e) {
      if (e.message === "PAUSED") throw e;
      if (!fallbackMp3) throw e;
      url = song.audio_url || `https://cdn1.suno.ai/${song.id}.mp3`;
      ext = "mp3";
      await addLog(`WAV failed for "${song.title}" · MP3 fallback.`);
    }
  } else {
    url = song.audio_url || `https://cdn1.suno.ai/${song.id}.mp3`;
  }

  if (!url) throw new Error("No audio URL.");

  const filename = `Suno Backup/${safeFilename(song.title)} [${song.id.slice(0,8)}].${ext}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });

  await markDone(song, ext, downloadId, filename);
  return {ext};
}

async function startDownload(scope, format, fallbackMp3, delayMs) {
  await allowAutomaticDownloads();
  await setDownloadUi(false);

  const s = await getState();
  if (s.scan.status !== "ready") throw new Error("Finish the library scan first.");
  if (s.scan.indexMode !== "full-v8") throw new Error("This is an old index. Run one V8 full scan first.");

  const cleanScope = scope === "all" ? "all" : "liked";
  s.download = {
    status: "running",
    scope: cleanScope,
    targetTotal: cleanScope === "liked" ? s.scan.liked : s.scan.songs,
    format: format === "mp3" ? "mp3" : "wav",
    fallbackMp3: !!fallbackMp3,
    delayMs: Math.max(500, Number(delayMs) || 1200),
    page: 1,
    index: 0,
    processed: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    currentTitle: "",
    startedAt: Date.now(),
    lastActivity: Date.now(),
    error: null,
    lastFailure: null
  };
  await setState(s);

  await addLog(
    `Download queue started · ${s.download.format.toUpperCase()} · ` +
    `${cleanScope === "liked" ? "❤️ Likes only" : "ALL songs"} · target ${s.download.targetTotal}.`
  );

  runDownloadLoop().catch(downloadError);
}

async function downloadError(e) {
  await patch(s => {
    s.download.status = "error";
    s.download.error = e.message;
    s.download.lastActivity = Date.now();
  });
  await setDownloadUi(true);
  await addLog("DOWNLOAD ERROR: " + e.message);
}

async function resumeDownload() {
  await allowAutomaticDownloads();
  await setDownloadUi(false);

  await patch(s => {
    if (["paused","error","running"].includes(s.download.status)) {
      s.download.status = "running";
      s.download.error = null;
      s.download.lastActivity = Date.now();
    }
  });
  runDownloadLoop().catch(downloadError);
}

async function pauseDownload() {
  await patch(s => {
    if (s.download.status === "running") s.download.status = "paused";
    s.download.lastActivity = Date.now();
  });
  await setDownloadUi(true);
  await addLog("Downloads paused. Queue position saved.");
}

async function runDownloadLoop() {
  if (downloadLoopRunning) return;
  downloadLoopRunning = true;

  try {
    while (true) {
      let s = await getState();
      if (s.download.status !== "running") break;

      if (s.download.page > s.scan.pages) {
        s.download.status = "done";
        s.download.currentTitle = "";
        s.download.lastActivity = Date.now();
        await setState(s);
        await setDownloadUi(true);
        await addLog(
          `DONE: ${s.download.downloaded} downloads · ${s.download.skipped} skipped · ${s.download.failed} failed.`
        );
        break;
      }

      const key = CHUNK_PREFIX + s.download.page;
      const obj = await chrome.storage.local.get(key);
      const chunk = Array.isArray(obj[key]) ? obj[key] : [];

      if (s.download.scope === "liked") {
        let nextIndex = s.download.index;
        while (nextIndex < chunk.length && !chunk[nextIndex]?.is_liked) nextIndex++;
        if (nextIndex !== s.download.index) {
          s.download.index = nextIndex;
          s.download.lastActivity = Date.now();
          await setState(s);
        }
      }

      if (s.download.index >= chunk.length) {
        s.download.page += 1;
        s.download.index = 0;
        s.download.lastActivity = Date.now();
        await setState(s);
        continue;
      }

      const song = chunk[s.download.index];
      s.download.currentTitle = song.title || song.id;
      s.download.lastActivity = Date.now();
      await setState(s);

      try {
        const hist = await historyStatus(song.id, s.download.format);
        if (hist.done) {
          s.download.skipped += 1;
          await addLog(`Skipped: ${song.title} · ${s.download.format.toUpperCase()} already recorded.`);
        } else {
          const result = await initiateDownload(
            song,
            s.download.format,
            s.download.fallbackMp3,
            s
          );
          s.download.downloaded += 1;
          await addLog(`Started ${result.ext.toUpperCase()}: ${song.title}`);
        }
      } catch (e) {
        if (e.message === "PAUSED") {
          s.download.status = "paused";
          s.download.lastActivity = Date.now();
          await setState(s);
          break;
        }
        s.download.failed += 1;
        s.download.lastFailure = `${song.title}: ${e.message}`;
        await addLog(`FAILED: ${song.title} · ${e.message}`);
      }

      s.download.processed += 1;
      s.download.index += 1;
      s.download.currentTitle = "";
      s.download.lastActivity = Date.now();
      await setState(s);

      await heartbeatSleep(s.download.delayMs);
    }
  } finally {
    downloadLoopRunning = false;
  }
}

async function clearHistory() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(DONE_PREFIX));
  for (let i = 0; i < keys.length; i += 500) {
    await chrome.storage.local.remove(keys.slice(i, i + 500));
  }
  return keys.length;
}

async function exportIndex() {
  const s = await getState();
  const rows = [];
  for (let p = 1; p <= s.scan.pages; p++) {
    const obj = await chrome.storage.local.get(CHUNK_PREFIX + p);
    const chunk = obj[CHUNK_PREFIX + p];
    if (Array.isArray(chunk)) rows.push(...chunk);
  }
  return rows;
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, {periodInMinutes: 0.5});
  await allowAutomaticDownloads();
  await migrateToV8();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, {periodInMinutes: 0.5});
  await allowAutomaticDownloads();
  await migrateToV8();
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  const s = await getState();

  if (s.scan.status === "running" && !scanLoopRunning) {
    runScanLoop().catch(() => {});
  }
  if (s.download.status === "running" && !downloadLoopRunning) {
    runDownloadLoop().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "getState":
          sendResponse({ok: true, state: await getState()});
          break;
        case "newScan":
          await startNewScan();
          sendResponse({ok: true});
          break;
        case "resumeScan":
          await resumeScan();
          sendResponse({ok: true});
          break;
        case "pauseScan":
          await pauseScan();
          sendResponse({ok: true});
          break;
        case "startDownload":
          await startDownload(msg.scope, msg.format, msg.fallbackMp3, msg.delayMs);
          sendResponse({ok: true});
          break;
        case "resumeDownload":
          await resumeDownload();
          sendResponse({ok: true});
          break;
        case "pauseDownload":
          await pauseDownload();
          sendResponse({ok: true});
          break;
        case "clearHistory":
          sendResponse({ok: true, count: await clearHistory()});
          break;
        case "exportIndex":
          sendResponse({ok: true, rows: await exportIndex()});
          break;
        case "autoDownloadStatus":
          sendResponse({ok: true, setting: await automaticDownloadsStatus()});
          break;
        case "enableAutoDownloads":
          sendResponse({ok: await allowAutomaticDownloads(), setting: await automaticDownloadsStatus()});
          break;
        case "openDownloadSettings":
          await chrome.tabs.create({url: "chrome://settings/downloads"});
          sendResponse({ok: true});
          break;
        default:
          sendResponse({ok: false, error: "Unknown command"});
      }
    } catch (e) {
      sendResponse({ok: false, error: e.message || String(e)});
    }
  })();
  return true;
});

chrome.alarms.create(ALARM_NAME, {periodInMinutes: 0.5});
allowAutomaticDownloads().catch(() => {});
migrateToV8().catch(() => {});
