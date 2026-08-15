const $ = id => document.getElementById(id);
let lastState = null;

function fmt(ms) {
  if (!ms) return "00:00";
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

async function send(type, extra = {}) {
  return chrome.runtime.sendMessage({type, ...extra});
}

function label(x) {
  return ({idle:"IDLE",running:"RUNNING",paused:"PAUSED",ready:"READY",done:"DONE",error:"ERROR"})[x] || String(x || "—").toUpperCase();
}

function updateScopePreview() {
  const s = lastState;
  if (!s) return;
  const scope = $("scope").value;
  const n = scope === "all" ? (s.scan?.songs || 0) : (s.scan?.liked || 0);
  $("scopePreview").textContent = scope === "all"
    ? `Target: 📚 ${n} songs`
    : `Target: ❤️ ${n} Liked songs`;
}

function render(s) {
  lastState = s;
  const sc = s.scan || {};
  const dl = s.download || {};

  $("scanSongs").textContent = sc.songs || 0;
  $("scanLiked").textContent = sc.liked || 0;
  $("scanPages").textContent = sc.pages || 0;
  $("scanStatus").textContent = label(sc.status);

  $("scanTime").textContent = sc.startedAt
    ? fmt((["ready","paused","error"].includes(sc.status) ? (sc.lastActivity || Date.now()) : Date.now()) - sc.startedAt)
    : "00:00";

  if (sc.indexMode !== "full-v8" && sc.status !== "idle") {
    $("scanMessage").innerHTML = "⚠️ This index was created by an older version. Run <b>NEW FULL SCAN</b> once. After that you can switch between Likes and All without rescanning.";
  } else if (sc.status === "running") {
    $("scanMessage").innerHTML = `Indexing in the background · <b>${sc.songs || 0}</b> songs · <b>❤️ ${sc.liked || 0}</b> Likes.`;
  } else if (sc.status === "ready") {
    $("scanMessage").innerHTML = `✅ Full index ready: <b>${sc.songs || 0}</b> songs · <b>❤️ ${sc.liked || 0}</b> Likes. You no longer need to rescan just to change the filter.`;
  } else if (sc.status === "paused") {
    $("scanMessage").innerHTML = `⏸️ Scan paused after <b>${sc.pages || 0}</b> pages.`;
  } else if (sc.status === "error") {
    $("scanMessage").textContent = "❌ " + (sc.error || "Error") + " · you can resume.";
  } else {
    $("scanMessage").textContent = "Run a full scan. You only need to do it again when your library changes.";
  }

  if (["running","paused","done","error"].includes(dl.status) && dl.scope) {
    $("scope").value = dl.scope;
  }

  $("dlProcessed").textContent = dl.processed || 0;
  $("dlOk").textContent = dl.downloaded || 0;
  $("dlSkip").textContent = dl.skipped || 0;
  $("dlFail").textContent = dl.failed || 0;
  $("currentSong").textContent = dl.currentTitle ? `Now: ${dl.currentTitle}` : "—";

  const total = dl.targetTotal || ($("scope").value === "all" ? (sc.songs || 0) : (sc.liked || 0));
  const pct = total ? Math.min(100, Math.round((dl.processed || 0) * 100 / total)) : 0;
  $("bar").style.width = pct + "%";

  if (dl.status === "running") {
    $("downloadMessage").innerHTML = `Downloading <b>${String(dl.format || "").toUpperCase()}</b> · ${dl.scope === "all" ? "📚 All" : "❤️ Likes"} · ${dl.processed || 0}/${dl.targetTotal || 0} (${pct}%).`;
  } else if (dl.status === "paused") {
    $("downloadMessage").innerHTML = `⏸️ Queue paused at ${dl.processed || 0}/${dl.targetTotal || 0}.`;
  } else if (dl.status === "done") {
    $("downloadMessage").innerHTML = `✅ Queue finished. ${dl.downloaded || 0} downloads · ${dl.skipped || 0} skipped · ${dl.failed || 0} failed.`;
  } else if (dl.status === "error") {
    $("downloadMessage").textContent = "❌ " + (dl.error || "Error") + " · you can resume.";
  } else {
    $("downloadMessage").textContent = "Likes only is the default. You can switch to All without rescanning.";
  }

  const logs = (s.logs || []).slice(-40).map(x => `[${new Date(x.t).toLocaleTimeString()}] ${x.text}`);
  $("logs").textContent = logs.join("\n");
  $("logs").scrollTop = $("logs").scrollHeight;

  const err = sc.status === "error" || dl.status === "error";
  const run = sc.status === "running" || dl.status === "running";
  $("chip").textContent = err ? "Error" : run ? "Running in background" : "Saved";
  $("chip").className = "chip " + (err ? "bad" : run ? "warn" : "good");

  updateScopePreview();
}

async function refresh() {
  try {
    const r = await send("getState");
    if (r?.ok) render(r.state);
  } catch (_) {}
}

async function refreshAutoDownloadStatus() {
  try {
    const r = await send("autoDownloadStatus");
    if (r?.ok && r.setting === "allow") {
      $("autoStatus").textContent = "✅ Multiple downloads: ALLOWED";
      $("autoHelp").textContent = "You should not need to confirm every file individually.";
    } else {
      $("autoStatus").textContent = "⚠️ Multiple downloads: " + String(r?.setting || "unknown").toUpperCase();
      $("autoHelp").textContent = "Click ENABLE once.";
    }
  } catch (_) {
    $("autoStatus").textContent = "⚠️ Could not check the permission.";
  }
}

$("scope").addEventListener("change", updateScopePreview);

$("newScan").onclick = async () => {
  if (!confirm(
    "Suno Mass Backup will perform one FULL scan and store the Like status of every song.\n\n" +
    "After that you can switch between Likes only and All without rescanning.\n\n" +
    "Your download history will not be deleted.\n\nContinue?"
  )) return;

  const r = await send("newScan");
  if (!r?.ok) alert(r?.error || "Could not start the scan.");
  await refresh();
};

$("resumeScan").onclick = async () => {
  const r = await send("resumeScan");
  if (!r?.ok) alert(r?.error || "Could not resume the scan.");
  await refresh();
};

$("pauseScan").onclick = async () => {
  await send("pauseScan");
  await refresh();
};

$("startDownload").onclick = async () => {
  const scope = $("scope").value === "all" ? "all" : "liked";
  const format = $("format").value;
  const fallbackMp3 = $("fallback").checked;
  const delayMs = Number($("delay").value);
  const n = scope === "all" ? (lastState?.scan?.songs || 0) : (lastState?.scan?.liked || 0);

  if (!confirm(
    `Start ${format.toUpperCase()} queue for ${scope === "all" ? "ALL SONGS" : "LIKES ONLY"}?\n\n` +
    `Target: ${n} songs.\n` +
    "Anything already recorded in download history will be skipped."
  )) return;

  const r = await send("startDownload", {scope, format, fallbackMp3, delayMs});
  if (!r?.ok) alert(r?.error || "Could not start the queue.");
  await refresh();
};

$("resumeDownload").onclick = async () => {
  const r = await send("resumeDownload");
  if (!r?.ok) alert(r?.error || "Could not resume the queue.");
  await refresh();
};

$("pauseDownload").onclick = async () => {
  await send("pauseDownload");
  await refresh();
};

$("enableAuto").onclick = async () => {
  const r = await send("enableAutoDownloads");
  if (!r?.ok) alert("Could not enable automatic multiple downloads.");
  await refreshAutoDownloadStatus();
};

$("openSettings").onclick = async () => {
  await send("openDownloadSettings");
};

$("clearHistory").onclick = async () => {
  if (!confirm("Clear the download history?")) return;
  const r = await send("clearHistory");
  alert(r?.ok ? `Cleared ${r.count} history entries.` : (r?.error || "Error"));
};

$("exportIndex").onclick = async () => {
  const r = await send("exportIndex");
  if (!r?.ok) { alert(r?.error || "Error"); return; }
  const blob = new Blob([JSON.stringify(r.rows, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: "Suno Backup/Suno_Library_Index.json",
    saveAs: false,
    conflictAction: "uniquify"
  });
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

refresh();
refreshAutoDownloadStatus();
setInterval(refresh, 1000);
