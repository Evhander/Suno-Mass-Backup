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
  return ({idle:"PARADO",running:"TRABAJANDO",paused:"PAUSADO",ready:"LISTO",done:"TERMINADO",error:"ERROR"})[x] || String(x || "—").toUpperCase();
}

function updateScopePreview() {
  const s = lastState;
  if (!s) return;
  const scope = $("scope").value;
  const n = scope === "all" ? (s.scan?.songs || 0) : (s.scan?.liked || 0);
  $("scopePreview").textContent = scope === "all"
    ? `Objetivo: 📚 ${n} canciones`
    : `Objetivo: ❤️ ${n} canciones con Like`;
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
    $("scanMessage").innerHTML = "⚠️ Índice de una versión anterior. Haz <b>NUEVO ESCANEO COMPLETO</b> una sola vez. Después podrás alternar Likes/Todo sin volver a escanear.";
  } else if (sc.status === "running") {
    $("scanMessage").innerHTML = `Indexando en segundo plano · <b>${sc.songs || 0}</b> canciones · <b>❤️ ${sc.liked || 0}</b> Likes.`;
  } else if (sc.status === "ready") {
    $("scanMessage").innerHTML = `✅ Índice completo preparado: <b>${sc.songs || 0}</b> canciones · <b>❤️ ${sc.liked || 0}</b> Likes. Ya no necesitas reescanear para cambiar el filtro.`;
  } else if (sc.status === "paused") {
    $("scanMessage").innerHTML = `⏸️ Escaneo pausado después de <b>${sc.pages || 0}</b> páginas.`;
  } else if (sc.status === "error") {
    $("scanMessage").textContent = "❌ " + (sc.error || "Error") + " · puedes reanudar.";
  } else {
    $("scanMessage").textContent = "Haz un escaneo completo. Solo hace falta una vez mientras tu biblioteca no cambie.";
  }

  if (["running","paused","done","error"].includes(dl.status) && dl.scope) {
    $("scope").value = dl.scope;
  }

  $("dlProcessed").textContent = dl.processed || 0;
  $("dlOk").textContent = dl.downloaded || 0;
  $("dlSkip").textContent = dl.skipped || 0;
  $("dlFail").textContent = dl.failed || 0;
  $("currentSong").textContent = dl.currentTitle ? `Ahora: ${dl.currentTitle}` : "—";

  const total = dl.targetTotal || ($("scope").value === "all" ? (sc.songs || 0) : (sc.liked || 0));
  const pct = total ? Math.min(100, Math.round((dl.processed || 0) * 100 / total)) : 0;
  $("bar").style.width = pct + "%";

  if (dl.status === "running") {
    $("downloadMessage").innerHTML = `Descargando <b>${String(dl.format || "").toUpperCase()}</b> · ${dl.scope === "all" ? "📚 Todo" : "❤️ Likes"} · ${dl.processed || 0}/${dl.targetTotal || 0} (${pct}%).`;
  } else if (dl.status === "paused") {
    $("downloadMessage").innerHTML = `⏸️ Cola pausada en ${dl.processed || 0}/${dl.targetTotal || 0}.`;
  } else if (dl.status === "done") {
    $("downloadMessage").innerHTML = `✅ Cola terminada. ${dl.downloaded || 0} descargas · ${dl.skipped || 0} omitidas · ${dl.failed || 0} fallidas.`;
  } else if (dl.status === "error") {
    $("downloadMessage").textContent = "❌ " + (dl.error || "Error") + " · puedes reanudar.";
  } else {
    $("downloadMessage").textContent = "Por defecto descarga solo Likes. Puedes cambiar a Todo sin reescanear.";
  }

  const logs = (s.logs || []).slice(-40).map(x => `[${new Date(x.t).toLocaleTimeString()}] ${x.text}`);
  $("logs").textContent = logs.join("\n");
  $("logs").scrollTop = $("logs").scrollHeight;

  const err = sc.status === "error" || dl.status === "error";
  const run = sc.status === "running" || dl.status === "running";
  $("chip").textContent = err ? "Error" : run ? "En segundo plano" : "Persistido";
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
      $("autoStatus").textContent = "✅ Descargas múltiples: PERMITIDAS";
      $("autoHelp").textContent = "No deberías tener que confirmar archivo por archivo.";
    } else {
      $("autoStatus").textContent = "⚠️ Descargas múltiples: " + String(r?.setting || "desconocido").toUpperCase();
      $("autoHelp").textContent = "Pulsa ACTIVAR una vez.";
    }
  } catch (_) {
    $("autoStatus").textContent = "⚠️ No pude comprobar el permiso.";
  }
}

$("scope").addEventListener("change", updateScopePreview);

$("newScan").onclick = async () => {
  if (!confirm(
    "Suno Mass Backup hará un escaneo COMPLETO una vez y guardará también el estado Like de cada canción.\n\n" +
    "Después podrás cambiar entre Solo Likes y Todas sin volver a escanear.\n\n" +
    "El historial de descargas no se borra.\n\n¿Continuar?"
  )) return;

  const r = await send("newScan");
  if (!r?.ok) alert(r?.error || "No se pudo iniciar.");
  await refresh();
};

$("resumeScan").onclick = async () => {
  const r = await send("resumeScan");
  if (!r?.ok) alert(r?.error || "No se pudo reanudar.");
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
    `Iniciar cola ${format.toUpperCase()} para ${scope === "all" ? "TODAS" : "SOLO LIKES"}?\n\n` +
    `Objetivo: ${n} canciones.\n` +
    "Lo que ya esté registrado se omitirá."
  )) return;

  const r = await send("startDownload", {scope, format, fallbackMp3, delayMs});
  if (!r?.ok) alert(r?.error || "No se pudo iniciar.");
  await refresh();
};

$("resumeDownload").onclick = async () => {
  const r = await send("resumeDownload");
  if (!r?.ok) alert(r?.error || "No se pudo reanudar.");
  await refresh();
};

$("pauseDownload").onclick = async () => {
  await send("pauseDownload");
  await refresh();
};

$("enableAuto").onclick = async () => {
  const r = await send("enableAutoDownloads");
  if (!r?.ok) alert("No pude activar el permiso automático.");
  await refreshAutoDownloadStatus();
};

$("openSettings").onclick = async () => {
  await send("openDownloadSettings");
};

$("clearHistory").onclick = async () => {
  if (!confirm("¿Borrar el historial de descargas?")) return;
  const r = await send("clearHistory");
  alert(r?.ok ? `Borrados ${r.count} registros.` : (r?.error || "Error"));
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
