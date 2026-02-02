/************************************
 * Configurateur Vidéosurveillance (Full Frontend)
 * Refactor propre (vanilla JS)
 *
 * ✅ Mode configurateur (pas liste)
 * Étapes :
 * 1) Caméras (blocs → panier)
 * 2) Supports (accessoires par bloc)
 * 3) NVR + Réseau (Switch PoE)
 * 4) Stockage
 *
 * Données via CSV (/data) :
 * cameras.csv / nvrs.csv / hdds.csv / switches.csv / accessories.csv
 *
 * ✅ FIXES / AJOUTS CONSERVÉS (hors “fix NVR” retiré à ta demande)
 * - accessories.csv = MAPPING camera_id -> accessoires compatibles
 * - normalizeAccessoryMapping aligné avec TON header exact :
 *   camera_id,junction_box_id,junction_box_name,wall_mount_id,wall_mount_name,wall_mount_stand_alone,
 *   ceiling_mount_id,ceiling_mount_name,ceiling_mount_stand_alone,qty,
 *   image_url_junction_box,datasheet_url_junction_box,image_url_wall_mount,datasheet_url_wall_mount,
 *   image_url_ceiling_mount,datasheet_url_ceiling_mount
 * - Ajout normalizeMappedAccessory (robuste false-like)
 * - suggestAccessoriesForBlock utilise qty mapping + qty bloc correctement
 * - Dé-doublonnage sécurisé type+id
 * - Robustesse : si mapping manquant => accessoires vide (message UI déjà prévu)
 * - Junction box proposée SYSTÉMATIQUEMENT (si présente dans le mapping)
 * - parseCsv gère les headers dupliqués (name,name,name -> name, name_2, name_3)
 *   => évite l’écrasement d’objets et corrige les champs qui “disparaissent”
 ************************************/

/* ============================================================
   KPI (tracking) — envoi côté backend
   - Stockage local: session_id
   - Envoi best-effort (pas bloquant)
   ============================================================ */
const KPI = (() => {
  const SESSION_KEY = "cfg_session_id";

  function getSessionId() {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = (crypto?.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "_" + Math.random().toString(16).slice(2));
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  async function send(event, payload = {}) {
    try {
      const body = {
        session_id: getSessionId(),
        event: String(event || "").slice(0, 80),
        payload: payload && typeof payload === "object" ? payload : { value: payload },
      };

      await fetch("/api/kpi/collect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-page-path": location.pathname + location.search + location.hash,
        },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch (e) {
      // jamais casser l'app pour un KPI
    }
  }

  // ✅ compat : si ton code appelle KPI.sendNowait(...)
  function sendNowait(event, payload = {}) {
    // "fire & forget" : on ne await pas
    try { send(event, payload); } catch {}
  }

  return { send, sendNowait, getSessionId };
})();

// ✅ IMPORTANT : rend KPI accessible partout (handlers inclus)
window.KPI = KPI;

// ✅ compat : si tu as des appels kpi("event", {...})
window.kpi = function kpi(event, payload = {}) {
  try {
    if (window.KPI?.sendNowait) window.KPI.sendNowait(event, payload);
    else if (window.KPI?.send) window.KPI.send(event, payload);
  } catch {}
};


function kpiConfigSnapshot(proj) {
  try {
    const sp = proj?.storageParams || {};
    const rec = MODEL?.recording || {};

    // Caméras (liste + quantités)
    const cams = (proj?.perCamera || [])
      .map(r => ({
        id: r.cameraId,
        name: r.cameraName,
        qty: Number(r.qty || 0),
        mbpsPerCam: Number(r.mbpsPerCam || 0),
        mbpsLine: Number(r.mbpsLine || 0),
        source: r.mbpsSource || ""
      }))
      .filter(x => x.id && x.qty > 0);

    // Compléments
    const screenEnabled = !!(MODEL?.complements?.screen?.enabled);
    const enclosureEnabled = !!(MODEL?.complements?.enclosure?.enabled);
    const signageEnabled = !!(MODEL?.complements?.signage?.enabled ?? MODEL?.complements?.signage?.enable);

    // Ids choisis/reco (si tes helpers existent)
    const scrSel = (typeof getSelectedOrRecommendedScreen === "function")
      ? getSelectedOrRecommendedScreen(proj)?.selected
      : null;

    const encSel = (typeof getSelectedOrRecommendedEnclosure === "function")
      ? getSelectedOrRecommendedEnclosure(proj)?.selected
      : null;

    const signSel = (typeof getSelectedOrRecommendedSign === "function")
      ? getSelectedOrRecommendedSign()?.sign
      : null;

    return {
      projectName: String(proj?.projectName ?? MODEL?.projectName ?? "").trim() || null,

      // Résumé sizing
      totalCameras: Number(proj?.totalCameras || 0),
      totalInMbps: Number(proj?.totalInMbps || 0),
      requiredTB: Number(proj?.requiredTB || 0),

      // NVR / Switch
      nvrId: proj?.nvrPick?.nvr?.id || null,
      nvrName: proj?.nvrPick?.nvr?.name || null,
      switchesRequired: !!proj?.switches?.required,
      switchesPortsNeeded: Number(proj?.switches?.portsNeeded || 0) || null,
      switchesTotalPorts: Number(proj?.switches?.totalPorts || 0) || null,

      // Recording (source: proj.storageParams sinon MODEL.recording)
      recording: {
        daysRetention: sp.daysRetention ?? rec.daysRetention ?? null,
        hoursPerDay: sp.hoursPerDay ?? rec.hoursPerDay ?? null,
        overheadPct: sp.overheadPct ?? rec.overheadPct ?? null,
        codec: sp.codec ?? rec.codec ?? null,
        fps: sp.ips ?? rec.fps ?? null,
        mode: sp.mode ?? rec.mode ?? null,
      },

      // Caméras détaillées (top N pour éviter payload énorme)
      camerasTop: cams
        .sort((a,b)=> (b.qty - a.qty))
        .slice(0, 30),

      // Compléments
      complements: {
        screen: {
          enabled: screenEnabled,
          qty: screenEnabled ? Number(MODEL?.complements?.screen?.qty || 1) : 0,
          id: scrSel?.id || null,
          name: scrSel?.name || null,
        },
        enclosure: {
          enabled: enclosureEnabled,
          qty: enclosureEnabled ? Number(MODEL?.complements?.enclosure?.qty || 1) : 0,
          id: encSel?.id || null,
          name: encSel?.name || null,
        },
        signage: {
          enabled: signageEnabled,
          qty: signageEnabled ? Number(MODEL?.complements?.signage?.qty || 1) : 0,
          id: signSel?.id || null,
          name: signSel?.name || null,
          scope: signageEnabled ? (MODEL?.complements?.signage?.scope || null) : null,
        },
      }
    };
  } catch (e) {
    return { error: "snapshot_failed" };
  }
}




(() => {
  "use strict";


  // ==========================================================
  // GLOBALS (doivent exister AVANT toute utilisation)
  // ==========================================================
  let LAST_PROJECT = null;
  let btnToggleResults = null;
  let _renderProjectCache = null;

  window.addEventListener("error", (e) => {
    console.error("JS Error:", e.error || e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("Unhandled promise:", e.reason);
  });

    /* =========================================================
    KPI SAFETY SHIM (anti-crash)
    À placer tout en haut du fichier app.js (après "use strict" si présent)
    ========================================================= */
  (() => {
    try {
      const k = (window.KPI = window.KPI || {});
      // Normaliser sendNowait si manquant
      if (typeof k.sendNowait !== "function" && typeof k.send === "function") {
        k.sendNowait = k.send.bind(k);
      }
      // Corriger la typo mortelle : sendNowaitNowait
      if (typeof k.sendNowaitNowait !== "function" && typeof k.sendNowait === "function") {
        k.sendNowaitNowait = k.sendNowait.bind(k);
      }
      // Si rien n'existe, on stub en no-op pour ne jamais casser l'app
      if (typeof k.sendNowait !== "function") k.sendNowait = () => {};
      if (typeof k.send !== "function") k.send = () => {};
    } catch (e) {
      // no-op
    }
  })();


  // ==========================================================
  // 0) HELPERS
  // ==========================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const safeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m]));

function getUiMode(){
  const m = String(MODEL?.ui?.mode || "simple").toLowerCase();
  return (m === "expert") ? "expert" : "simple";
}
function getSessionId() {
  const k = "cfg_session_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = (crypto?.randomUUID?.() || String(Math.random()).slice(2)) + "-" + Date.now();
    localStorage.setItem(k, v);
  }
  return v;
}

async function track(event, payload = {}) {
  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: getSessionId(),
        event,
        payload
      })
    });
  } catch (e) {
    // silent
  }
}

  const isFalseLike = (v) => {
    if (v == null) return true;
    const s = String(v).trim().toLowerCase();
    return s === "" || s === "false" || s === "0" || s === "no" || s === "n";
  };

  const toBool = (v) => {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "y";
  };

  const toStrOrFalse = (v) => (isFalseLike(v) ? false : String(v).trim());

  const toNum = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const clampInt = (v, min, max) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  };

  const splitList = (v, sep = "|") => {
    if (v == null) return [];
    const s = String(v).trim();
    if (!s) return [];
    return s.split(sep).map((x) => x.trim()).filter(Boolean);
  };

  // ==========================================================
// BRANDING COMELIT (PDF)
// ==========================================================
const COMELIT = {
  GREEN: "#00BF6F",      // Pantone 7480 C approx
  BLUE:  "#1C1F2A",      // Pantone 532 C approx
  WHITE: "#FFFFFF",
  TITLE_FONT: '"Arial Black", Arial, sans-serif',
  TEXT_FONT: 'Arial, sans-serif',
};

// Essaie plusieurs noms possibles (tu ajusteras si besoin)
// Objectif: ne pas casser si le fichier exact change.
function getComelitLogoCandidates() {
  return [
    "/assets/logo/logo.png",
    "/assets/logo/logo.svg",
    "/assets/logo/comelit.png",
    "/assets/logo/comelit.svg",
    "/assets/logo/COMELIT.png",
    "/assets/logo/COMELIT.svg",
  ];
}

  const uid = (prefix = "ID") =>
    `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

  const sum = (arr, fn) => {
    let t = 0;
    for (const x of arr) t += fn(x);
    return t;
  };

  const normalizeEmplacement = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (s.startsWith("ext")) return "exterieur";
    if (s.startsWith("int")) return "interieur";
    return s || "";
  };

  const objectiveToDoriKey = (obj) => {
    if (obj === "dissuasion") return "dori_observation_m";
    if (obj === "detection") return "dori_detection_m";
    return "dori_identification_m";
  };
  
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function getMpFromCam(cam){
  const num = Number(String(cam?.resolution_mp ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}


  function getIrFromCam(cam){
  const num = Number(String(cam?.ir_range_m ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}


  function getDoriForObjective(cam, objective){
  // objective: "dissuasion" | "detection" | "identification"
  if (!cam) return null;

  let v = null;
  if (objective === "dissuasion") v = cam.dori_observation_m;
  else if (objective === "detection") v = cam.dori_detection_m;
  else if (objective === "identification") v = cam.dori_identification_m;
  else v = null;

  const num = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(num) && num > 0 ? num : null;
}
  function getAvailableScreenSizes() {
    const screens = CATALOG.SCREENS || [];
    const sizes = new Set();

    for (const s of screens) {
      const v = Number(s.size_inch);
      if (Number.isFinite(v) && v > 0) sizes.add(v); // ✅ filtre 0 et valeurs invalides
    }

    return Array.from(sizes).sort((a, b) => a - b);
  }


function pickScreenBySize(sizeInch) {
  const screens = CATALOG.SCREENS || [];
  if (!screens.length) return null;

  // 1) match exact
  let exact = screens.find(s => Number(s.size_inch) === Number(sizeInch));
  if (exact) return exact;

  // 2) fallback: closest
  let best = null, bestDelta = Infinity;
  for (const s of screens) {
    const v = Number(s.size_inch);
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(v - Number(sizeInch));
    if (d < bestDelta) { bestDelta = d; best = s; }
  }
  return best || screens[0] || null;
}
const SCREEN_INSIDE_ONLY_ID = "MMON185A";

function isScreenInsideCompatible(enclosure, screen) {
  if (!enclosure || !screen) return false;

  // 1) Si le CSV boîtier donne une liste explicite
  if (Array.isArray(enclosure.screen_compatible_with) && enclosure.screen_compatible_with.length) {
    return enclosure.screen_compatible_with.includes(screen.id);
  }

  // 2) fallback selon ta règle business
  return screen.id === SCREEN_INSIDE_ONLY_ID;
}

function pickBestEnclosure(proj, screen) {
  const encs = CATALOG.ENCLOSURES || [];
  const nvrId = proj?.nvrPick?.nvr?.id || null;
  if (!encs.length || !nvrId) {
    return { enclosure: null, reason: "no_nvr_or_catalog", screenInsideOk: false };
  }

  const encNvrCompatible = encs.filter(e =>
    Array.isArray(e.compatible_with) && e.compatible_with.includes(nvrId)
  );

  if (!encNvrCompatible.length) {
    // Aucun boîtier compatible NVR
    return { enclosure: null, reason: "no_enclosure_for_nvr", screenInsideOk: false };
  }

  // Si écran choisi, on tente un boîtier qui accepte l’écran à l’intérieur
  if (screen) {
    const encBoth = encNvrCompatible.find(e => isScreenInsideCompatible(e, screen));
    if (encBoth) return { enclosure: encBoth, reason: "nvr_and_screen_ok", screenInsideOk: true };

    // Sinon on prend le meilleur compatible NVR mais on indiquera écran outside
    return { enclosure: encNvrCompatible[0], reason: "nvr_ok_screen_not_inside", screenInsideOk: false };
  }

  // Pas d’écran : on prend le meilleur compatible NVR
  return { enclosure: encNvrCompatible[0], reason: "nvr_ok_no_screen", screenInsideOk: false };
}
function getNvrHdmiOutputs(proj) {
  const nvr = proj?.nvrPick?.nvr || null;
  if (!nvr) return null;
  return clampInt(nvr.nvr_output ?? 1, 1, 8);
}

function screenQtyWarning(proj) {
  if (!MODEL.complements.screen.enabled) return null;
  const qty = clampInt(MODEL.complements.screen.qty ?? 1, 1, 99);
  const outputs = getNvrHdmiOutputs(proj);
  if (!outputs) return null;

  if (qty > outputs) {
    if (outputs === 1) return "Attention, l’enregistreur n’a qu’une sortie HDMI.";
    return `Attention, l’enregistreur a ${outputs} sorties HDMI.`;
  }
  return null;
}
function questionSvg(kind) {
  // kind: "screen" | "enclosure" | "signage"
  const title =
    kind === "screen" ? "Écran" :
    kind === "enclosure" ? "Boîtier" :
    "Panneau";

  // Outline icons: color driven by parent (currentColor)
  // CSS handles border/background via .qSvg
  const base = `class="qSvg" width="56" height="56" viewBox="0 0 64 64" aria-label="${title}" role="img"`;

  if (kind === "enclosure") {
    return `
      <svg ${base}>
        <rect x="16" y="14" width="32" height="36" rx="7" fill="none" stroke="currentColor" stroke-width="2.4"/>
        <path d="M20 24h24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
        <path d="M20 30h18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
        <path d="M20 36h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".35"/>
        <circle cx="44" cy="40" r="2.2" fill="currentColor" opacity=".9"/>
      </svg>
    `;
  }

  if (kind === "signage") {
    return `
      <svg ${base}>
        <rect x="14" y="12" width="36" height="26" rx="7" fill="none" stroke="currentColor" stroke-width="2.4"/>
        <path d="M20 20h24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
        <path d="M20 26h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
        <path d="M32 38v10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
        <path d="M24 48h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
      </svg>
    `;
  }

  // screen (default)
  return `
    <svg ${base}>
      <rect x="12" y="16" width="40" height="24" rx="7" fill="none" stroke="currentColor" stroke-width="2.4"/>
      <path d="M24 44h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
      <path d="M28 48h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
      <circle cx="46" cy="34" r="1.9" fill="currentColor" opacity=".7"/>
    </svg>
  `;
}


function renderEnclosureDecisionMessage(proj, screen, enclosureAuto) {
  const nvrId = proj?.nvrPick?.nvr?.id || null;

  if (!nvrId) {
    return `<div class="alert info" style="margin-top:10px">Aucun NVR sélectionné → impossible de proposer un boîtier.</div>`;
  }

  if (!enclosureAuto?.enclosure) {
    return `<div class="alert warn" style="margin-top:10px">Aucun boîtier compatible avec cet enregistreur.</div>`;
  }

  if (screen && enclosureAuto.reason === "nvr_ok_screen_not_inside") {
    return `<div class="alert warn" style="margin-top:10px">
      Boîtier compatible NVR, mais <strong>l’écran ne peut pas se mettre à l’intérieur</strong> du boîtier.
    </div>`;
  }

  if (screen && enclosureAuto.reason === "nvr_and_screen_ok") {
    return `<div class="alert ok" style="margin-top:10px">
      Boîtier compatible avec le NVR et <strong>l’écran peut être intégré</strong>.
    </div>`;
  }

  return `<div class="alert ok" style="margin-top:10px">
    Boîtier compatible avec le NVR.
  </div>`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const base64 = res.split(",", 2)[1] || "";
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ==========================================================
// Score global projet (pondéré par quantité)
// ==========================================================
function computeProjectScoreWeighted(){
  let sumQty = 0;
  let sumScore = 0;

  for (const blk of (MODEL.cameraBlocks || [])) {
    if (!blk.validated) continue;

    const line = (MODEL.cameraLines || []).find(l => l.fromBlockId === blk.id);
    if (!line) continue;

    const qty = clampInt(line.qty || 1, 1, 999);

    const s = Number(blk.selectedCameraScore);
    const used = Number.isFinite(s) ? s : 50;

    sumQty += qty;
    sumScore += used * qty;
  }

  if (sumQty <= 0) return null;

  const avg = Math.round(sumScore / sumQty);
  return clamp(avg, 0, 100);
}



// ==========================================================
// AXE 1 — Lecture “pastilles” (strict)
// ==========================================================
function levelFromScore(score){
  const s = Number(score);
  if (!Number.isFinite(s)) {
    return { level: "LIM", dot: "🟠", label: "LIM" };
  }
  if (s >= 78) return { level: "OK",  dot: "🟢", label: "OK"  };
  if (s >= 60) return { level: "LIM", dot: "🟠", label: "LIM" };
  return          { level: "BAD", dot: "🔴", label: "BAD" };
}

// ==========================================================
// Adaptateur score -> niveaux stricts (ok/warn/bad)
// ==========================================================
function levelFromScoreStrict(score){
  const base = levelFromScore(score); // { level:"OK"|"LIM"|"BAD", dot, label }
  const lvl =
    base.level === "OK"  ? "ok" :
    base.level === "LIM" ? "warn" : "bad";

  return { ...base, level: lvl };
}


// ==========================================================
// Comptage des niveaux de risque (AXE 1)
// ==========================================================
function computeRiskCounters(){
  let ok = 0, warn = 0, bad = 0;

  for (const blk of (MODEL.cameraBlocks || [])){
    if (!blk.validated) continue;

    const sc = Number(blk.selectedCameraScore);
    const safeScore = Number.isFinite(sc) ? sc : 60; // défaut "LIM" plutôt que crash/rouge

    const lvl = levelFromScoreStrict(safeScore).level;

    if (lvl === "ok") ok++;
    else if (lvl === "warn") warn++;
    else bad++;
  }

  return { ok, warn, bad, total: ok + warn + bad };
}


  /**
   * Retourne { score, parts[], ratio, dori, required }
   */
  function scoreCameraForBlock(block, cam){
    const ans = block?.answers || {};
    const required = Number(ans.distance_m || 0);
    const objective = ans.objective || "";
    const dori = getDoriForObjective(cam, objective);

    // 1) Distance vs DORI (60)
    // ratio = dori / required ; >= 1 = OK
    let ratio = null;
    let scoreDori = 0;

    if (required > 0 && Number.isFinite(required) && dori && dori > 0) {
      ratio = dori / required;
      // courbe douce :
      // - ratio >= 1.3 => 60
      // - ratio = 1.0 => 52
      // - ratio = 0.8 => 40
      // - ratio = 0.6 => 25
      // - ratio < 0.4 => 10
      const r = ratio;
      if (r >= 1.3) scoreDori = 60;
      else if (r >= 1.0) scoreDori = 52 + (r - 1.0) * (60 - 52) / 0.3;
      else if (r >= 0.8) scoreDori = 40 + (r - 0.8) * (52 - 40) / 0.2;
      else if (r >= 0.6) scoreDori = 25 + (r - 0.6) * (40 - 25) / 0.2;
      else if (r >= 0.4) scoreDori = 10 + (r - 0.4) * (25 - 10) / 0.2;
      else scoreDori = 6;
      scoreDori = clamp(Math.round(scoreDori), 0, 60);
    } else {
      // info manquante => on reste prudent
      scoreDori = 18;
    }

    // 2) MP (15)
    const mp = getMpFromCam(cam);
    // barème simple (à ajuster à ta gamme)
    let scoreMp = 0;
    if (mp == null) scoreMp = 7;
    else if (mp >= 8) scoreMp = 15;
    else if (mp >= 5) scoreMp = 13;
    else if (mp >= 4) scoreMp = 11;
    else if (mp >= 2) scoreMp = 9;
    else scoreMp = 7;

    // 3) IR (15)
    const ir = getIrFromCam(cam);
    let scoreIr = 0;
    if (ir == null) scoreIr = 7;
    else if (ir >= 60) scoreIr = 15;
    else if (ir >= 40) scoreIr = 13;
    else if (ir >= 30) scoreIr = 11;
    else if (ir >= 20) scoreIr = 9;
    else scoreIr = 7;

    // 4) Bonus cohérence (10)
    // On fait simple : extérieur favorise IR un peu + housings, intérieur favorise MP/détails
    let bonus = 0;
    const empl = normalizeEmplacement(ans.emplacement);
    if (empl === "exterieur" && ir != null && ir >= 30) bonus += 6;
    if (empl === "interieur" && mp != null && mp >= 4) bonus += 6;

    // Bonus petite marge DORI si ratio bien au-dessus
    if (ratio != null && ratio >= 1.15) bonus += 4;

    bonus = clamp(bonus, 0, 10);

    const score = clamp(scoreDori + scoreMp + scoreIr + bonus, 0, 100);

    const parts = [
      `DORI vs distance : ${scoreDori}/60${(ratio!=null ? ` (x${ratio.toFixed(2)})` : "")}`,
      `Qualité capteur : ${scoreMp}/15${(mp!=null ? ` (${mp}MP)` : "")}`,
      `IR / nuit : ${scoreIr}/15${(ir!=null ? ` (${ir}m)` : "")}`,
      `Cohérence usage : ${bonus}/10`
    ];

    return { score, parts, ratio, dori, required };
  }

/**
 * Interprétation score → 3 niveaux + motif principal + phrase
 * Hard rule (A):
 * - Identification : ratio < 0.85 => rouge
 * - Dissuasion / Détection : ratio < 0.80 => rouge
 */
/**
 * Interprétation "métier" du score (3 niveaux) + hard rule DORI
 * - OK / LIMITE / INADAPTÉ
 * - Seuils plus stricts (C) :
 *   OK >= 80
 *   LIMITE 60..79
 *   INADAPTÉ < 60
 * - Hard rule (A) sur la marge DORI :
 *   Identification : ratio < 0.85 => INADAPTÉ
 *   Dissuasion/Détection : ratio < 0.80 => INADAPTÉ
 */
function interpretScoreForBlock(block, cam){
  const sc = scoreCameraForBlock(block, cam);
  const ans = block?.answers || {};
  const obj = String(ans.objective || "").toLowerCase();

  // Base sur score (strict)
  let level = "ok";   // ok | warn | bad
  let badge = "OK";
  let message = "—";

  if (sc.score >= 80) {
    level = "ok"; badge = "OK"; message = "";
  } else if (sc.score >= 60) {
    level = "warn"; badge = "LIMITE"; message = "";
  } else {
    level = "bad"; badge = "INADAPTÉ"; message = "";
  }

  // Hard rule DORI
  let hardRule = false;
  let minRatio = null;

  if (sc.ratio != null && Number.isFinite(sc.ratio)) {
    minRatio = (obj === "identification") ? 0.85 : 0.80;
    if (sc.ratio < minRatio) {
      level = "bad";
      badge = "INADAPTÉ";
      hardRule = true;
    }
  }

  // Helpers
  const ansObj = String(ans.objective || "").toLowerCase();
  const objectiveLbl = (() => {
    try { return objectiveLabel(ansObj) || "Objectif"; } catch { return "Objectif"; }
  })();
  const emplLbl = (() => {
    try { return normalizeEmplacement(ans.emplacement) === "exterieur" ? "extérieur" : "intérieur"; }
    catch { return "site"; }
  })();
  const dist = Number(sc.required || 0);

  const mp = getMpFromCam(cam);
  const ir = getIrFromCam(cam);

  const ratioTxt =
    (sc.ratio != null && Number.isFinite(sc.ratio)) ? `DORI x${sc.ratio.toFixed(2)}` : null;

  // 🧠 Point critique (1 phrase) => sert pour le mode "Simple"
  let keyPoint = "Point critique : —";
  try {
    if (hardRule && minRatio != null && sc.ratio != null) {
      keyPoint = `Point critique : marge DORI insuffisante (x${sc.ratio.toFixed(2)} < x${minRatio.toFixed(2)})`;
    } else {
      // Heuristique simple
      if (ratioTxt && sc.ratio < 1.0) keyPoint = `Point critique : marge DORI faible (${ratioTxt})`;
      else if (ir != null && ir < 30 && emplLbl === "extérieur") keyPoint = `Point critique : IR limite (IR ${ir}m)`;
      else if (mp != null && mp < 4) keyPoint = `Point critique : niveau de détail (${mp}MP)`;
      else keyPoint = `Point critique : marge de sécurité`;
    }
  } catch {
    keyPoint = "Point critique : —";
  }

  // ✅ Phrase commerciale courte, franche, lisible
  // (on évite les pavés et les phrases “tièdes”)
  try {
    const feats = [];
    if (ratioTxt) feats.push(ratioTxt);
    if (mp != null) feats.push(`${mp}MP`);
    if (ir != null) feats.push(`IR ${ir}m`);

    const featTxt = feats.length ? feats.slice(0, 3).join(" • ") : "données partielles";

    if (hardRule && minRatio != null && sc.ratio != null) {
      message = `Non recommandée — marge DORI trop faible pour ${objectiveLbl.toLowerCase()} à ${dist}m (${emplLbl}).`;
    } else if (level === "ok") {
      message = `Recommandée (marge OK) — ${objectiveLbl} ${dist}m (${emplLbl}) • ${featTxt}.`;
    } else if (level === "warn") {
      message = `Acceptable (marge faible) — ${objectiveLbl} ${dist}m (${emplLbl}) • ${featTxt}.`;
    } else {
      message = `Non recommandée — ${objectiveLbl} ${dist}m (${emplLbl}) • ${keyPoint.replace("Point critique : ","")}.`;
    }
  } catch {
    message = message || "—";
  }

  return { ...sc, level, badge, message, hardRule, keyPoint };
}




/**
 * Motif principal "propre" (sans parsing de texte)
 * On sort: "DORI" | "Détails" | "Nuit/IR" | "Cohérence"
 */
function computeMainReason(block, cam, sc){
  // On ré-estime chaque sous-part (mêmes barèmes que scoreCameraForBlock)
  const ans = block?.answers || {};
  const required = Number(ans.distance_m || 0);
  const objective = ans.objective || "";
  const empl = normalizeEmplacement(ans.emplacement);

  // DORI
  let scoreDori = 18;
  const dori = getDoriForObjective(cam, objective);
  const ratio = (required > 0 && dori && dori > 0) ? (dori / required) : null;
  if (ratio != null){
    const r = ratio;
    if (r >= 1.3) scoreDori = 60;
    else if (r >= 1.0) scoreDori = 52 + (r - 1.0) * (60 - 52) / 0.3;
    else if (r >= 0.8) scoreDori = 40 + (r - 0.8) * (52 - 40) / 0.2;
    else if (r >= 0.6) scoreDori = 25 + (r - 0.6) * (40 - 25) / 0.2;
    else if (r >= 0.4) scoreDori = 10 + (r - 0.4) * (25 - 10) / 0.2;
    else scoreDori = 6;
    scoreDori = clamp(Math.round(scoreDori), 0, 60);
  }

  // MP
  const mp = getMpFromCam(cam);
  let scoreMp = 7;
  if (mp == null) scoreMp = 7;
  else if (mp >= 8) scoreMp = 15;
  else if (mp >= 5) scoreMp = 13;
  else if (mp >= 4) scoreMp = 11;
  else if (mp >= 2) scoreMp = 9;

  // IR
  const ir = getIrFromCam(cam);
  let scoreIr = 7;
  if (ir == null) scoreIr = 7;
  else if (ir >= 60) scoreIr = 15;
  else if (ir >= 40) scoreIr = 13;
  else if (ir >= 30) scoreIr = 11;
  else if (ir >= 20) scoreIr = 9;

  // Bonus cohérence
  let bonus = 0;
  if (empl === "exterieur" && ir != null && ir >= 30) bonus += 6;
  if (empl === "interieur" && mp != null && mp >= 4) bonus += 6;
  if (ratio != null && ratio >= 1.15) bonus += 4;
  bonus = clamp(bonus, 0, 10);

  // On veut le "point faible" => normaliser en % de leur max
  const norm = [
    { key: "DORI",       val: scoreDori / 60 },
    { key: "Détails",    val: scoreMp   / 15 },
    { key: "Nuit/IR",    val: scoreIr   / 15 },
    { key: "Cohérence",  val: bonus     / 10 },
  ].sort((a,b) => a.val - b.val);

  return String(norm[0]?.key || "DORI");
}

function objectiveLabel(obj){
  return obj === "dissuasion"
    ? "Dissuasion"
    : obj === "detection"
      ? "Détection"
      : "Identification";
}

function mountingLabel(m){
  return ({ wall: "Mur", ceiling: "Plafond" }[m] || "Mur");
}

function accessoryTypeLabel(t){
  return ({
    junction_box: "Boîtier de connexion",
    wall_mount: "Support mural",
    ceiling_mount: "Support plafond",
  }[t] || t);
}

  const badgeHtml = (text) => {
    const t = safeHtml(text || "");
    if (!t) return "";
    return `<span class="badgePill">${t}</span>`;
  };
function renderBadgesWithMore(badgesHtmlArr, maxVisible = 8) {
  const arr = (badgesHtmlArr || []).filter(Boolean);
  if (arr.length <= maxVisible) {
    return `<div class="badgeRow">${arr.join("")}</div>`;
  }
  const visible = arr.slice(0, maxVisible).join("");
  const hidden = arr.slice(maxVisible).join("");
  const more = arr.length - maxVisible;

  return `
    <div class="badgeRow badgeRowClamp">${visible}</div>
    <div class="badgeMoreLine">
      <details class="pickDetails">
        <summary class="pickDetailsSum">+${more} caractéristiques</summary>
        <div class="pickDetailsBody">
          <div class="badgeRow">${hidden}</div>
        </div>
      </details>
    </div>
  `;
}

  function extractUseCasesFromRow(raw) {
    const cols = ["use_cases_01", "use_cases_02", "use_cases_03"];
    const out = [];

    for (const k of cols) {
      const v = raw[k];
      if (!isFalseLike(v)) out.push(String(v).trim());
    }

    // fallback legacy
    if (!out.length) {
      const legacy = raw.use_cases ?? raw.use_case ?? raw.useCases ?? "";
      const fromPipe = splitList(legacy, "|");
      if (fromPipe.length) return fromPipe;
      if (!isFalseLike(legacy)) return [String(legacy).trim()];
    }

    return [...new Set(out)].filter(Boolean);
  }
  function waitForImages(root, timeoutMs = 3500) {
  const imgs = Array.from(root.querySelectorAll("img"));
  const pending = imgs.filter((img) => !img.complete);

  if (!pending.length) return Promise.resolve(true);

  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(false);
    }, timeoutMs);

    const onDone = () => {
      if (done) return;
      const still = pending.filter((img) => !img.complete);
      if (still.length) return;
      done = true;
      clearTimeout(t);
      resolve(true);
    };

    pending.forEach((img) => {
      img.addEventListener("load", onDone, { once: true });
      img.addEventListener("error", onDone, { once: true });
    });
  });
}

function buildPdfRootForExport(proj) {
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-99999px";
  wrap.style.top = "0";
  wrap.style.width = "794px"; // largeur A4 portrait ~ 210mm @ 96dpi (approx)
  wrap.innerHTML = buildPdfHtml(proj);
  document.body.appendChild(wrap);
  return wrap;
}

  // ==========================================================
  // 0B) CSV PARSER (no deps)
  // ==========================================================
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") {
          row.push(cur);
          cur = "";
        } else if (ch === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else if (ch === "\r") {
          // ignore
        } else {
          cur += ch;
        }
      }
    }

    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }

    if (!rows.length) return [];

    // 1) Raw headers + trim + remove BOM
    const rawHeaders = rows[0].map((h) => String(h ?? "").trim().replace(/^\uFEFF/, ""));

    // 2) ✅ FIX: gérer les headers dupliqués
    // ex: name,name,name -> name, name_2, name_3
    const headers = (() => {
      const counts = new Map();
      return rawHeaders.map((h, idx) => {
        const base = h || `col_${idx + 1}`; // si header vide -> fallback
        const n = (counts.get(base) ?? 0) + 1;
        counts.set(base, n);
        return n === 1 ? base : `${base}_${n}`;
      });
    })();

    const objs = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells || cells.every((c) => String(c ?? "").trim() === "")) continue;

      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]] = String(cells[c] ?? "").trim();
      }
      objs.push(obj);
    }

    return objs;
  }

  async function loadCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Impossible de charger ${url} (${res.status})`);
    return parseCsv(await res.text());
  }

  // ==========================================================
  // 1) DATA (catalog)
  // ==========================================================
  const CATALOG = {
  CAMERAS: [],
  NVRS: [],
  HDDS: [],
  SWITCHES: [],
  SCREENS: [],        // ✅ ajouté
  ENCLOSURES: [],     // ✅ ajouté
  SIGNAGE: [],        // ✅ panneaux de signalisation
  ACCESSORIES_MAP: new Map(), // key = camera_id, value = mapping row
  };

  // ==========================================================
  // 2) MODEL (state)
  // ==========================================================
  const MODEL = {
  cameraBlocks: [],
  cameraLines: [],
  accessoryLines: [],

  recording: {
    daysRetention: 14,
    hoursPerDay: 24,
    fps: 15,
    codec: "h265",
    mode: "continuous",
    overheadPct: 20,
    reservePortsPct: 10,
  },

  complements: {
    screen: { enabled: false, sizeInch: 18, qty: 1 },
    enclosure: { enabled: false, qty: 1 },
    signage: { enabled: false, scope: "Public", qty: 1 },
  },

  ui: {
    activeBlockId: null,
    resultsShown: false,

    // UI prefs (persistées)
    mode: "simple",        // "simple" | "expert"
    demo: false,           // true => UI orientée vente (moins "technique")
    onlyFavs: false,       // filtre favoris dans propositions
    favorites: [],         // [cameraId]
    compare: [],           // [cameraId, cameraId] max 2
    previewByBlock: {},    // { [blockId]: cameraId } => carte "pré-sélectionnée"
  },

  projectName: "",
  
  projectUseCase: "",  // Use case global du projet

  stepIndex: 0,
};

const KPI = (() => {
  const SESSION_KEY = "cfg_session_id";

  function getSessionId() {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2));
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function _buildBody(event, payload) {
    return {
      session_id: getSessionId(),
      event: String(event || "").slice(0, 80),
      payload: payload && typeof payload === "object" ? payload : { value: payload },
    };
  }

  // ✅ Ton send "attendu" (garde la signature) — mais on ne veut pas bloquer l'app
  async function send(event, payload = {}) {
    try {
      const body = _buildBody(event, payload);

      await fetch("/api/kpi/collect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-page-path": location.pathname + location.search + location.hash,
        },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch (e) {
      // ne casse jamais l'app
    }
  }

  // ✅ Fire-and-forget : recommandé pour tous les events UI (aucune latence)
  function sendNowait(event, payload = {}) {
    try {
      const body = _buildBody(event, payload);
      fetch("/api/kpi/collect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-page-path": location.pathname + location.search + location.hash,
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    } catch (e) {}
  }

  // ------------------------------------------------------------
  // KPI "normaux" (métier) : snapshot de configuration
  // ------------------------------------------------------------

  function compactCameras() {
    // attend tes structures existantes : MODEL.cameraLines + getCameraById()
    const lines = Array.isArray(MODEL?.cameraLines) ? MODEL.cameraLines : [];
    const cams = [];

    for (const l of lines) {
      const camId = l?.cameraId;
      if (!camId) continue;
      const cam = (typeof getCameraById === "function") ? getCameraById(camId) : null;
      if (!cam) continue;
      cams.push({
        id: cam.id,
        name: cam.name || "",
        qty: Number(l.qty || 0) || 0,
      });
    }
    return cams.filter(c => c.qty > 0);
  }

  function snapshot(proj) {
    const cams = compactCameras();
    const cam_total_qty = cams.reduce((a, c) => a + (Number(c.qty) || 0), 0);

    const nvr_id = proj?.nvrPick?.nvr?.id || proj?.nvr?.id || null;

    // ⚠️ adapte si ton champ exact diffère (on couvre plusieurs cas)
    const retention_days =
      Number(proj?.storage?.days ?? proj?.storageDays ?? proj?.retention_days ?? proj?.retentionDays ?? NaN);
    const retention_days_ok = Number.isFinite(retention_days) ? retention_days : null;

    const config_type =
      proj?.siteType ||
      proj?.vertical ||
      proj?.environment ||
      (cam_total_qty >= 8 ? "multi-cam" : "petit-site");

    const comp = MODEL?.complements || {};
    const screen_enabled = !!comp?.screen?.enabled;
    const enclosure_enabled = !!comp?.enclosure?.enabled;
    const signage_enabled = !!comp?.signage?.enabled;

    const screen_size_inch = screen_enabled ? (Number(comp?.screen?.sizeInch || 0) || null) : null;
    const screen_qty = screen_enabled ? (Number(comp?.screen?.qty || 1) || 1) : null;

    const signage_scope = signage_enabled ? String(comp?.signage?.scope || "Public") : null;
    const signage_qty = signage_enabled ? (Number(comp?.signage?.qty || 1) || 1) : null;

    return {
      sid: getSessionId(),
      config_type,
      cam_total_qty,
      unique_cam_models: cams.length,
      cameras: cams, // 👈 KPI le plus utile
      nvr_id,
      retention_days: retention_days_ok,
      complements: {
        screen_enabled,
        screen_size_inch,
        screen_qty,
        enclosure_enabled,
        signage_enabled,
        signage_scope,
        signage_qty,
      },
    };
  }

  return { send, sendNowait, sendNowait: sendNowait, getSessionId, snapshot };
})();

  const STEPS = [
    { id: "project", title: "Projet", badge: "1/6", help: "Nom du projet (optionnel) + contexte." },
    { id: "cameras", title: "Caméras", badge: "2/6", help: "Crée des blocs et valide au moins une caméra par bloc." },
    { id: "mounts", title: "Supports", badge: "3/6", help: "Choix des accessoires/suppléments (auto-suggérés)." },
    { id: "nvr_network", title: "NVR + Réseau", badge: "4/6", help: "NVR + switches recommandés." },
    { id: "storage", title: "Stockage", badge: "5/6", help: "Rétention, FPS, codec, stockage requis + HDD." },
    { id: "summary", title: "Résumé", badge: "6/6", help: "Résumé final + exports." },
  ];







// ==========================================================
// 3) DOM CACHE (robuste)
// ==========================================================
const DOM = {
  stepsEl: $("#steps"),
  btnCompute: $("#btnCompute"),
  btnReset: $("#btnReset"),
  btnDemo: $("#btnDemo"),

  progressBar: $("#progressBar"),
  progressText: $("#progressText"),

  resultsEmpty: $("#resultsEmpty"),
  results: $("#results"),
  primaryRecoEl: $("#primaryReco"),
  alertsEl: $("#alerts"),

  dataStatusEl: $("#dataStatus"),

  btnExportPdf: $("#btnExportPdf"),
  btnExportPdfPack: $("#btnExportPdfPack"),
};

  // ==========================================================
  // 4) NORMALIZATION
  // ==========================================================
  function normalizeCamera(raw) {
  const useCases = extractUseCasesFromRow(raw);

  const emplInt = toBool(raw.Emplacement_Interieur ?? raw.emplacement_interieur ?? raw.interieur);
  const emplExt = toBool(raw.Emplacement_Exterieur ?? raw.emplacement_exterieur ?? raw.exterieur);

  // helper: numbers robustes (virgules, "IP66", "IK10", espaces)
  const num = (v, fallback = null) => {
    if (v == null) return fallback;
    if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
    const s = String(v).trim();
    if (!s) return fallback;

    // IP66 / IK10
    const ipik = s.match(/^(IP|IK)\s*([0-9]{2})$/i);
    if (ipik) return Number(ipik[2]);

    // virgule FR -> point
    const cleaned = s.replace(",", ".").replace(/\s+/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    id: String(raw.id ?? "").trim(),
    name: raw.name || "",
    brand_range: raw.brand_range || "",
    family: raw.family || "standard",
    type: raw.form_factor || raw.type || "",

    emplacement_interieur: !!emplInt,
    emplacement_exterieur: !!emplExt,

    resolution_mp: num(raw.resolution_mp, 0),
    sensor_count: num(raw.sensor_count, 0),
    lens_type: raw.lens_type || "",

    focal_min_mm: num(raw.focal_min_mm, null),
    focal_max_mm: num(raw.focal_max_mm, null),

    dori_detection_m: num(raw.dori_detection_m, 0),
    dori_observation_m: num(raw.dori_observation_m, 0),
    dori_recognition_m: num(raw.dori_recognition_m, 0),
    dori_identification_m: num(raw.dori_identification_m, 0),

    ir_range_m: num(raw.ir_range_m, 0),
    white_led_range_m: num(raw.white_led_range_m, 0),

    low_light_raw: raw.low_light_mode || raw.low_light || "",
    low_light: !!String(raw.low_light_mode ?? raw.low_light ?? "").trim(),

    ip: num(raw.ip, null),
    ik: num(raw.ik, null),

    microphone: toBool(raw.Microphone ?? raw.microphone),

    poe_w: num(raw.poe_w, 0),

    // ✅ champ clé pour le débit
    bitrate_mbps_typical: num(raw.bitrate_mbps_typical, null),

    streams_max: num(raw.streams_max, null),
    analytics_level: raw.analytics_level || "",

    use_cases: useCases,

    image_url: raw.image_url || "",
    datasheet_url: raw.datasheet_url || "",
  };
}


  function normalizeNvr(raw) {
  return {
    id: raw.id,
    name: raw.name,
    channels: toNum(raw.channels) ?? 0,
    max_in_mbps: toNum(raw.max_in_mbps) ?? 0,
    nvr_output: clampInt(raw.nvr_output ?? 1, 1, 8), // ✅ raw
    hdd_bays: toNum(raw.hdd_bays) ?? 0,
    max_hdd_tb_per_bay: toNum(raw.max_hdd_tb_per_bay) ?? 0,
    poe_ports: toNum(raw.poe_ports) ?? 0,
    poe_budget_w: toNum(raw.poe_budget_w) ?? 0,
    image_url: raw.image_url || "",
    datasheet_url: raw.datasheet_url || "",
  };
}


  function normalizeHdd(raw) {
    return {
      id: raw.id,
      name: raw.name,
      capacity_tb: toNum(raw.capacity_tb),
      image_url: raw.image_url || "",
      datasheet_url: raw.datasheet_url || "",
    };
  }

  function normalizeSwitch(raw) {
    return {
      id: raw.id,
      name: raw.name,
      poe_ports: toNum(raw.poe_ports) ?? 0,
      poe_budget_w: toNum(raw.poe_budget_w) ?? null,
      uplink_gbps: toNum(raw.uplink_gbps) ?? null,
      managed: toBool(raw.managed),
      image_url: raw.image_url || "",
      datasheet_url: raw.datasheet_url || "",
      notes: raw.notes || "",
    };
  }

  function safeStr(v) {
  return (v ?? "").toString().trim();
}

function safeNum(v) {
  const n = Number((v ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "A|B|C|" => ["A","B","C"] */
function parsePipeList(v) {
  return safeStr(v)
    .split("|")
    .map(s => s.trim())
    .filter(Boolean);
}
  function normalizeScreen(row) {
    const id = safeStr(row.id);

    // parse robuste (accepte "55", "55.0", "55,0", rejette vide)
    const raw = safeStr(row.size_inch);
    const n = Number(String(raw || "").trim().replace(",", "."));
    const size = Number.isFinite(n) && n > 0 ? n : null;

    return {
      id,
      name: safeStr(row.name) || id || "—",

      // important : null si invalide (pas 0)
      size_inch: size,

      format: safeStr(row.format) || "—",
      vesa: safeStr(row.vesa) || "—",

      // ton CSV a "Resolution" (R majuscule)
      resolution: safeStr(row.Resolution || row.resolution) || "—",

      image_url: safeStr(row.image_url) || "",
      datasheet_url: safeStr(row.datasheet_url) || "",
    };
  }

  function normalizeEnclosure(row) {
  const id = safeStr(row.id);
  return {
    id,
    name: safeStr(row.name) || id || "—",

    // peut être vide, ou une ref unique, ou plusieurs refs séparées par |
    screen_compatible_with: parsePipeList(row.screen_compatible_with),

    // liste NVR / XVR compatibles
    compatible_with: parsePipeList(row.compatible_with),

    image_url: safeStr(row.image_url) || "",
    datasheet_url: safeStr(row.datasheet_url) || "",
  };
}

  // ==========================================================
  // 4A) SIGNAGE (panneaux de signalisation)
  // ==========================================================
  // CSV attendu (tes colonnes):
  // id,name,material,fixing,Dimension,Prive_Public,image_url,datasheet_url
  function normalizeSignageRow(raw) {
    if (!raw) return null;
    const id = safeStr(raw.id);
    if (!id) return null;

    const name = safeStr(raw.name) || id;
    const material = safeStr(raw.material);
    const fixing = safeStr(raw.fixing);
    const dimension = safeStr(raw.Dimension ?? raw.dimension);

    // "Public" ou "Privé" (ton CSV = Prive_Public)
    const scope = safeStr(raw.Prive_Public ?? raw.prive_public ?? raw.scope ?? raw.type) || "Public";

    const image_url = safeStr(raw.image_url);
    const datasheet_url = safeStr(raw.datasheet_url);

    return { id, name, material, fixing, dimension, scope, image_url, datasheet_url };
  }

  function getSignages() {
    return Array.isArray(CATALOG.SIGNAGE) ? CATALOG.SIGNAGE : [];
  }

  function pickSignageByScope(scope) {
    const wanted = safeStr(scope || "Public").toLowerCase();
    const signs = getSignages();

    // match exact d’abord
    let hit = signs.find((s) => safeStr(s.scope).toLowerCase() === wanted);
    if (hit) return hit;

    // fallback : si "privé" indispo -> public, et inverse
    if (wanted.includes("priv")) {
      hit = signs.find((s) => safeStr(s.scope).toLowerCase().includes("public"));
      if (hit) return hit;
    } else {
      hit = signs.find((s) => safeStr(s.scope).toLowerCase().includes("priv"));
      if (hit) return hit;
    }

    // fallback final
    return signs[0] || null;
  }

  function getSelectedOrRecommendedSign() {
    const enabled = !!MODEL.complements?.signage?.enabled;
    if (!enabled) return { sign: null, reason: "disabled" };

    const scope = MODEL.complements.signage.scope || "Public";
    const sign = pickSignageByScope(scope);
    if (!sign) return { sign: null, reason: "no_catalog" };
    return { sign, reason: "scope_match" };
  }

  // ==========================================================
  // 4B) ACCESSORIES MAPPING (✅ aligné sur TON CSV)
  // ==========================================================
  function normalizeMappedAccessory({ id, name, type, image_url, datasheet_url, stand_alone }) {
    if (isFalseLike(id)) return null;

    return {
      id: String(id).trim(),
      name: toStrOrFalse(name) || String(id).trim(),
      type, // junction_box | wall_mount | ceiling_mount
      image_url: toStrOrFalse(image_url) || false,
      datasheet_url: toStrOrFalse(datasheet_url) || false,
      stand_alone: !!stand_alone,
    };
  }

  /**
   * ✅ Mapping accessoires par caméra (TON FORMAT)
   * camera_id,junction_box_id,junction_box_name,wall_mount_id,wall_mount_name,wall_mount_stand_alone,
   * ceiling_mount_id,ceiling_mount_name,ceiling_mount_stand_alone,qty,
   * image_url_junction_box,datasheet_url_junction_box,image_url_wall_mount,datasheet_url_wall_mount,
   * image_url_ceiling_mount,datasheet_url_ceiling_mount
   */
  function normalizeAccessoryMapping(raw) {
    // parseCsv enlève le BOM, mais on garde un fallback au cas où
    const cameraId = toStrOrFalse(raw.camera_id ?? raw["\uFEFFcamera_id"]);
    if (!cameraId) return null;

    const qty = clampInt(raw.qty, 1, 999);

    const junction = normalizeMappedAccessory({
      id: raw.junction_box_id,
      name: raw.junction_box_name,
      type: "junction_box",
      image_url: raw.image_url_junction_box,
      datasheet_url: raw.datasheet_url_junction_box,
      stand_alone: false,
    });

    const wall = normalizeMappedAccessory({
      id: raw.wall_mount_id,
      name: raw.wall_mount_name,
      type: "wall_mount",
      image_url: raw.image_url_wall_mount,
      datasheet_url: raw.datasheet_url_wall_mount,
      stand_alone: toBool(raw.wall_mount_stand_alone),
    });

    const ceiling = normalizeMappedAccessory({
      id: raw.ceiling_mount_id,
      name: raw.ceiling_mount_name,
      type: "ceiling_mount",
      image_url: raw.image_url_ceiling_mount,
      datasheet_url: raw.datasheet_url_ceiling_mount,
      stand_alone: toBool(raw.ceiling_mount_stand_alone),
    });

    return {
      cameraId: String(cameraId).trim(),
      qty,
      junction,
      wall,
      ceiling,
    };
  }

  // ==========================================================
  // 5) LOOKUPS
  // ==========================================================
  const getCameraById = (id) => CATALOG.CAMERAS.find((c) => c.id === id) || null;

  function getAllUseCases() {
    const set = new Set();
    for (const c of CATALOG.CAMERAS) {
      for (const u of (c.use_cases || [])) {
        if (!isFalseLike(u)) set.add(String(u).trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }

  // ==========================================================
  // 6) ENGINE - RECO CAMERA
  // ==========================================================
  function recommendCameraForAnswers(ans) {
    let pool = [...CATALOG.CAMERAS];

    const useCase = String(ans.use_case || "").trim();
    const emplacement = normalizeEmplacement(ans.emplacement);
    const objective = String(ans.objective || "").trim();
    const distance = toNum(ans.distance_m);

    if (useCase) pool = pool.filter((c) => (c.use_cases || []).some((u) => u === useCase));

    if (emplacement === "interieur") pool = pool.filter((c) => c.emplacement_interieur === true);
    else if (emplacement === "exterieur") pool = pool.filter((c) => c.emplacement_exterieur === true);

    const doriKey = objectiveToDoriKey(objective || "identification");
    if (Number.isFinite(distance) && distance > 0) {
      pool = pool.filter((c) => (c[doriKey] ?? 0) >= distance);
    }

    if (!pool.length) {
      return {
        primary: null,
        alternatives: [],
        reasons: [
          "Aucune caméra ne match avec ces critères. Essaie :",
          "• baisser la distance",
          "• changer l’objectif ou le use case",
          "• vérifier Emplacement_Interieur/Exterieur dans cameras.csv",
          "• vérifier use_cases_01/02/03 (pas de 'false' à la place d’un vrai libellé)",
        ],
      };
    }

    const scored = pool.map((c) => {
      let score = 0;
      const reasons = [];

      if (Number.isFinite(distance) && distance > 0) {
        const margin = (c[doriKey] ?? 0) - distance;
        if (margin >= 20) {
          score += 4;
          reasons.push("Très bonne marge DORI");
        } else if (margin >= 10) {
          score += 3;
          reasons.push("Bonne marge DORI");
        } else if (margin >= 3) {
          score += 2;
          reasons.push("Marge DORI correcte");
        } else {
          score += 1;
          reasons.push("DORI juste suffisant");
        }
      } else {
        score += 1;
        reasons.push("Distance non renseignée (reco basée sur use case + emplacement)");
      }

      if ((c.resolution_mp ?? 0) >= 8) {
        score += 1;
        reasons.push("Résolution élevée");
      }
      if (c.low_light) {
        score += 1;
        reasons.push("Mode faible luminosité");
      }
      if ((c.ik ?? 0) >= 10) {
        score += 1;
        reasons.push("IK10 (robuste)");
      }
      if ((c.ip ?? 0) >= 67) {
        score += 1;
        reasons.push("IP67 (extérieur)");
      }
      if (c.microphone) {
        score += 1;
        reasons.push("Micro intégré");
      }

      const f = c.focal_min_mm ?? 0;
      if (objective === "dissuasion") {
        if (f > 0 && f <= 2.8) {
          score += 1;
          reasons.push("Grand angle (couverture)");
        }
      } else if (objective === "identification") {
        if (f >= 4.0) {
          score += 1;
          reasons.push("Focale serrée (détails)");
        }
      }

      return { camera: c, score, reasons };
    });

    scored.sort((a, b) => b.score - a.score);
    return { primary: scored[0], alternatives: scored.slice(1, 3), reasons: scored[0].reasons };
  }

  // ==========================================================
  // 7) ENGINE - BLOCS + ACCESSOIRES
  // ==========================================================
  function createEmptyCameraBlock() {
  return {
    id: uid("B"),
    label: "",
    qty: 1,
    quality: "standard",
    answers: {
      use_case: MODEL.projectUseCase || "",  // ✅ Hérite du type de site du projet
      emplacement: "exterieur",
      objective: "",
      distance_m: "",
      mounting: "wall",
    },
    selectedCameraId: null,
    validated: false,
    validatedLineId: null,
    accessories: [],
  };
}

// ==========================================================
// UI PREFS (localStorage) + mode démo
// ==========================================================
const UI_PREFS_KEY = "cfg_ui_prefs_v1";

function applyDemoClass() {
  document.body.classList.toggle("demoMode", !!MODEL?.ui?.demo);
}

function loadUIPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);

    if (p && typeof p === "object") {
      if (p.mode === "simple" || p.mode === "expert") MODEL.ui.mode = p.mode;
      if (typeof p.demo === "boolean") MODEL.ui.demo = p.demo;
      if (typeof p.onlyFavs === "boolean") MODEL.ui.onlyFavs = p.onlyFavs;
      if (Array.isArray(p.favorites)) MODEL.ui.favorites = p.favorites.map(String);
    }
  } catch {}
  applyDemoClass();
}

function saveUIPrefs() {
  try {
    const p = {
      mode: MODEL.ui.mode,
      demo: !!MODEL.ui.demo,
      onlyFavs: !!MODEL.ui.onlyFavs,
      favorites: Array.isArray(MODEL.ui.favorites) ? MODEL.ui.favorites : [],
    };
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p));
  } catch {}
}
// ==========================================================
// 8) ENGINE - BLOCKS SANITY + VALIDATION
// ==========================================================
function sanity() {
  if (!Array.isArray(MODEL.cameraBlocks) || MODEL.cameraBlocks.length === 0) {
    MODEL.cameraBlocks = [createEmptyCameraBlock()];
  }
  if (!MODEL.ui) MODEL.ui = {};

  // Champs UI requis (safe defaults)
  if (!MODEL.ui.activeBlockId && MODEL.cameraBlocks[0]) MODEL.ui.activeBlockId = MODEL.cameraBlocks[0].id;
  if (typeof MODEL.ui.resultsShown !== "boolean") MODEL.ui.resultsShown = false;

  if (MODEL.ui.mode !== "simple" && MODEL.ui.mode !== "expert") MODEL.ui.mode = "simple";
  if (typeof MODEL.ui.demo !== "boolean") MODEL.ui.demo = false;
  if (typeof MODEL.ui.onlyFavs !== "boolean") MODEL.ui.onlyFavs = false;

  if (!Array.isArray(MODEL.ui.favorites)) MODEL.ui.favorites = [];
  if (!Array.isArray(MODEL.ui.compare)) MODEL.ui.compare = [];
  if (!MODEL.ui.previewByBlock || typeof MODEL.ui.previewByBlock !== "object") MODEL.ui.previewByBlock = {};

  // Dé-doublonnage + garde-fous
  MODEL.ui.favorites = Array.from(new Set(MODEL.ui.favorites.map(String)));
  MODEL.ui.compare = Array.from(new Set(MODEL.ui.compare.map(String))).slice(0, 2);

  // Nettoyage preview (si bloc supprimé)
  const blockIds = new Set((MODEL.cameraBlocks || []).map(b => b.id));
  for (const k of Object.keys(MODEL.ui.previewByBlock || {})) {
    if (!blockIds.has(k)) delete MODEL.ui.previewByBlock[k];
  }

  applyDemoClass();
}



  function rebuildAccessoryLinesFromBlocks() {
    const out = [];

    for (const blk of (MODEL.cameraBlocks || [])) {
      if (!blk.validated) continue;
      const camLine = MODEL.cameraLines.find((l) => l.fromBlockId === blk.id);
      const camId = camLine?.cameraId || null;

      for (const accLine of (blk.accessories || [])) {
        out.push({
          type: accLine.type,
          accessoryId: accLine.accessoryId,
          name: accLine.name,
          qty: accLine.qty,
          linkedCameraId: accLine.linkedCameraId || camId || null,
          fromBlockId: blk.id,
          image_url: accLine.image_url || false,
          datasheet_url: accLine.datasheet_url || false,
          stand_alone: !!accLine.stand_alone,
        });
      }
    }

    MODEL.accessoryLines = out;
  }

  function unvalidateBlock(block) {
    block.validated = false;

    if (block.validatedLineId) {
      const idx = MODEL.cameraLines.findIndex((l) => l.lineId === block.validatedLineId);
      if (idx >= 0) MODEL.cameraLines.splice(idx, 1);
    }
    block.validatedLineId = null;

    block.accessories = [];
    rebuildAccessoryLinesFromBlocks();
  }

  // ✅ Invalidation légère : si un bloc déjà "validé" est modifié,
// on le repasse en non-validé + on reset le cache projet pour forcer recompute.
function invalidateIfNeeded(block, reason = "Modification") {
  try {
    // Toujours invalider le cache de rendu/calcul projet
    // (sinon computeProject() peut rester sur un résultat ancien)
    if (typeof _renderProjectCache !== "undefined") _renderProjectCache = null;

    if (!block) return;

    // Si le bloc était validé, on le "dévalide" proprement
    if (block.validated) {
      if (typeof unvalidateBlock === "function") {
        unvalidateBlock(block, reason);
      } else {
        // fallback ultra-safe
        block.validated = false;
        block.selectedCameraId = "";
      }
    }
  } catch (e) {
    console.warn("[invalidateIfNeeded] fallback", e);
    try {
      if (typeof _renderProjectCache !== "undefined") _renderProjectCache = null;
    } catch {}
  }
}

  function suggestAccessoriesForBlock(block) {
    const line = MODEL.cameraLines.find((l) => l.fromBlockId === block.id);
    if (!line) {
      block.accessories = [];
      return;
    }

    const cam = getCameraById(line.cameraId);
    if (!cam) {
      block.accessories = [];
      return;
    }

    const mapRow = CATALOG.ACCESSORIES_MAP.get(cam.id);
    if (!mapRow) {
      block.accessories = [];
      return;
    }

    const camQty = clampInt(line.qty || 1, 1, 999);
    const mounting = block.answers.mounting || "wall";

    const picked = [];

    // ✅ Junction box SYSTÉMATIQUEMENT (si présente)
    if (mapRow.junction?.id) picked.push(mapRow.junction);

    // Support selon pose
    let mountAcc = null;
    if (mounting === "ceiling") mountAcc = mapRow.ceiling?.id ? mapRow.ceiling : null;
    else mountAcc = mapRow.wall?.id ? mapRow.wall : null;

    // fallback si le support attendu n'existe pas
    if (!mountAcc) {
      mountAcc = (mapRow.wall?.id ? mapRow.wall : null) || (mapRow.ceiling?.id ? mapRow.ceiling : null);
    }
    if (mountAcc?.id) picked.push(mountAcc);

    const mult = clampInt(mapRow.qty, 1, 999);
    const lines = picked.map((acc) => ({
      type: acc.type,
      accessoryId: acc.id,
      name: acc.name || acc.id,
      qty: camQty * mult,
      image_url: acc.image_url || false,
      datasheet_url: acc.datasheet_url || false,
      stand_alone: !!acc.stand_alone,
      linkedCameraId: cam.id,
    }));

    // dedupe
    const agg = new Map();
    for (const l of lines) {
      const key = `${l.type}__${l.accessoryId}`;
      const prev = agg.get(key);
      if (!prev) agg.set(key, { ...l });
      else prev.qty += l.qty;
    }

    block.accessories = [...agg.values()].filter((x) => x.accessoryId && x.qty > 0);
  }

  function suggestAccessories() {
    for (const blk of (MODEL.cameraBlocks || [])) {
      if (!blk.validated) continue;
      suggestAccessoriesForBlock(blk);
    }
    rebuildAccessoryLinesFromBlocks();
  }

  function validateBlock(block, reco, forcedCameraId = null) {
    const chosenId = forcedCameraId || block.selectedCameraId || reco?.primary?.camera?.id || null;
    const cam = chosenId ? getCameraById(chosenId) : null;
    if (!cam) {
      alert("Impossible de valider : aucune caméra sélectionnable pour ce bloc.");
      return;
    }

    const qty = clampInt(Number(block.qty || 1), 1, 999);
    block.qty = qty; // ✅ on fixe le type définitivement après validation

    const quality = block.quality || "standard";

    if (block.validatedLineId) {
      const line = MODEL.cameraLines.find((l) => l.lineId === block.validatedLineId);
      if (line) {
        line.cameraId = cam.id;
        line.qty = qty;
        line.quality = quality;
        line.fromBlockId = block.id;
      } else {
        block.validatedLineId = null;
      }
    }

    if (!block.validatedLineId) {
      const lineId = uid("LINE");
      MODEL.cameraLines.push({ lineId, cameraId: cam.id, qty, quality, fromBlockId: block.id });
      KPI.sendNowait("validate_camera", KPI.snapshot());
      block.validatedLineId = lineId;
    }

    block.validated = true;
    block.selectedCameraId = cam.id;

    // ✅ Score /100 stocké dans le bloc (sert pour Résumé + PDF)
    const sc = scoreCameraForBlock(block, cam);
    block.selectedCameraScore = sc.score;
    block.selectedCameraScoreParts = sc.parts; // optionnel

    suggestAccessoriesForBlock(block);
    rebuildAccessoryLinesFromBlocks();
  }

  // ==========================================================
  // 8) ENGINE - PROJET (NVR / SWITCH / HDD)
  // ==========================================================
  function getTotalCameras() {
    return sum(MODEL.cameraLines, (l) => (l.qty || 0));
  }


  /**
   * AXE 1 — Score solution critique
   * Règle : le score le plus faible parmi les blocs validés
   */
  function computeCriticalProjectScore() {
    let worst = null;

    for (const blk of MODEL.cameraBlocks || []) {
      if (!blk.validated) continue;

      const s = Number(blk.selectedCameraScore);
      if (!Number.isFinite(s)) continue;

      if (worst === null || s < worst) {
        worst = s;
      }
    }

    return worst; // null si aucun bloc validé
  }

  function estimateCameraBitrateMbps(camera, rec, quality) {
    let br = camera.bitrate_mbps_typical ?? ((camera.resolution_mp ?? 4) * 1.2);
    br *= (rec.fps / 15);
    if (rec.codec === "h264") br *= 1.35;
    if (rec.mode === "motion") br *= 0.40;

    const q = (quality || "standard").toLowerCase();
    if (q === "low") br *= 0.75;
    else if (q === "high") br *= 1.20;

    return Math.max(0.5, br);
  }

  function computeTotals() {
    const rec = MODEL.recording;
    let totalInMbps = 0;
    let totalPoeW = 0;

    for (const line of MODEL.cameraLines) {
      const cam = getCameraById(line.cameraId);
      if (!cam) continue;
      const qty = line.qty || 0;
      totalPoeW += qty * (cam.poe_w ?? 0);
      const perCam = estimateCameraBitrateMbps(cam, rec, line.quality);
      totalInMbps += qty * perCam;
    }
    return { totalInMbps, totalPoeW };
  }

  function pickNvr(totalCameras, totalInMbps) {
    const candidates = CATALOG.NVRS
      .filter((n) => (n.channels ?? 0) >= totalCameras)
      .sort((a, b) => (a.channels - b.channels) || ((a.max_in_mbps ?? 0) - (b.max_in_mbps ?? 0)));

    for (const nvr of candidates) {
      if ((nvr.max_in_mbps ?? 0) >= totalInMbps) return { nvr, reason: "Canaux + débit OK" };
    }
    if (candidates.length) return { nvr: candidates[candidates.length - 1], reason: "Canaux OK, débit à vérifier" };
    return { nvr: null, reason: "Aucun NVR ne couvre le nombre de caméras" };
  }

  function planPoESwitches(totalCameras, reservePct = 10) {
    const required = totalCameras >= 16;
    if (!required) {
      return { required: false, portsNeeded: 0, totalPorts: 0, plan: [], surplusPorts: 0 };
    }

    const portsNeeded = Math.ceil(totalCameras * (1 + reservePct / 100));

    const catalog = (CATALOG.SWITCHES && CATALOG.SWITCHES.length)
      ? CATALOG.SWITCHES
          .filter((s) => (s.poe_ports ?? 0) > 0)
          .sort((a, b) => b.poe_ports - a.poe_ports)
      : [
          { id: "SW-POE-24", name: "Switch PoE 24 ports", poe_ports: 24 },
          { id: "SW-POE-16", name: "Switch PoE 16 ports", poe_ports: 16 },
          { id: "SW-POE-08", name: "Switch PoE 8 ports", poe_ports: 8 },
          { id: "SW-POE-04", name: "Switch PoE 4 ports", poe_ports: 4 },
        ];

    const plan = [];
    let remaining = portsNeeded;

    // greedy: gros ports d'abord
    for (const sw of catalog) {
      if (remaining <= 0) break;
      const count = Math.floor(remaining / sw.poe_ports);
      if (count > 0) {
        plan.push({ item: sw, qty: count });
        remaining -= count * sw.poe_ports;
      }
    }

    // compléter avec le meilleur switch qui couvre le reste
    if (remaining > 0) {
      let best = null;
      for (const sw of catalog) {
        const surplus = sw.poe_ports - remaining;
        if (surplus >= 0) {
          if (
            !best ||
            surplus < best.surplus ||
            (surplus === best.surplus && sw.poe_ports < best.item.poe_ports)
          ) {
            best = { item: sw, surplus };
          }
        }
      }
      if (best) plan.push({ item: best.item, qty: 1 });
    }

    const totalPorts = plan.reduce((s, p) => s + p.item.poe_ports * p.qty, 0);
    return {
      required: true,
      portsNeeded,
      totalPorts,
      plan,
      surplusPorts: totalPorts - portsNeeded,
    };
  }

  function mbpsToTB(mbps, hoursPerDay, days, overheadPct) {
    const seconds = hoursPerDay * 3600 * days;
    const bits = mbps * 1_000_000 * seconds;
    const bytes = bits / 8;
    let tb = bytes / 1_000_000_000_000;
    tb *= (1 + (overheadPct / 100));
    return tb;
  }

  function pickDisks(requiredTB, nvr) {
    if (!nvr) return null;
    const bays = nvr.hdd_bays ?? 0;
    const maxPerBay = nvr.max_hdd_tb_per_bay ?? 0;
    const maxTotalTB = bays * maxPerBay;

    const sizesFromHdds = [...new Set(CATALOG.HDDS.map((h) => h.capacity_tb).filter((x) => Number.isFinite(x)))]
      .sort((a, b) => b - a);

    const candidateSizes = sizesFromHdds.length ? sizesFromHdds : [16, 12, 8, 4];

    let best = null;
    for (const size of candidateSizes) {
      if (size > maxPerBay) continue;
      const needed = Math.ceil(requiredTB / size);
      if (needed <= bays) {
        best = { sizeTB: size, count: needed, totalTB: needed * size };
        break;
      }
    }

    if (!best) {
      const size = Math.min(maxPerBay, candidateSizes[0] ?? maxPerBay);
      best = { sizeTB: size, count: bays, totalTB: bays * size };
    }

    const hddRef = CATALOG.HDDS.find((h) => h.capacity_tb === best.sizeTB) || null;
    return { ...best, maxTotalTB, hddRef };
  }
  function getStorageParams() {
  // Valeurs par défaut + lecture des champs existants si tu les as déjà
  const days =
    MODEL?.storage?.days ??
    MODEL?.storageDays ??
    MODEL?.storage_retention_days ??
    14;

  const ips =
    MODEL?.storage?.ips ??
    MODEL?.storage?.fps ??
    MODEL?.storageIps ??
    MODEL?.storageFps ??
    12; // IPS par défaut

  const codec =
    MODEL?.storage?.codec ??
    MODEL?.storageCodec ??
    "H.265";

  const marginPct =
    MODEL?.storage?.marginPct ??
    MODEL?.storageMarginPct ??
    15;

  const hoursPerDay =
    MODEL?.storage?.hoursPerDay ??
    MODEL?.storageHoursPerDay ??
    24;

  const recordingMode =
    MODEL?.storage?.mode ??
    MODEL?.storageMode ??
    "Continu";

  return { days, ips, codec, marginPct, hoursPerDay, recordingMode };
}

// Tente de récupérer un "Mbps par caméra" depuis l'objet cam (si ton CSV le fournit)
function pickCamMbpsFromCatalog(cam) {
  if (!cam) return null;

  const candidates = [
    cam.mbps,
    cam.bitrate_mbps,
    cam.bandwidth_mbps,
    cam.stream_mbps,
    cam.bitrate,         // si déjà en Mbps
    cam.bandwidth,       // idem
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// Estimation fallback (pro mais simple) si pas de Mbps en catalog
function estimateCamMbpsFallback(cam, ips, codec) {
  // Récupère une “résolution” si possible (mp / width/height)
  const mpRaw = cam?.mp ?? cam?.megapixel ?? cam?.resolution_mp ?? cam?.sensor_mp;
  let mp = Number(mpRaw);
  if (!Number.isFinite(mp) || mp <= 0) {
    // si tu as width/height dans le CSV
    const w = Number(cam?.width);
    const h = Number(cam?.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      mp = (w * h) / 1_000_000;
    } else {
      mp = 4; // fallback 4MP
    }
  }

  // Heuristique : Mbps ~ MP * (ips/12) * facteurCodec * facteurQualité
  // H.265 ≈ -35% vs H.264 (ordre de grandeur)
  const codecFactor = String(codec).toUpperCase().includes("265") ? 0.65 : 1.0;

  // Qualité “standard” (si tu veux, on pourra brancher un slider)
  const qualityFactor = 1.0;

  const baseAt12ips = mp * 1.2; // 4MP @ 12ips ≈ 4.8 Mbps (ordre de grandeur)
  const mbps = baseAt12ips * (Number(ips) / 12) * codecFactor * qualityFactor;

  // Limites raisonnables pour éviter des aberrations
  return Math.max(0.6, Math.min(mbps, 16));
}

// Construit le tableau par caméra + total
function computePerCameraBitrates() {
  const { ips, codec } = getStorageParams();

  const rows = [];

  (MODEL.cameraLines || []).forEach((l) => {
    const cam = (typeof getCameraById === "function") ? getCameraById(l.cameraId) : null;
    if (!cam) return;

    const qty = Number(l.qty || 0);
    if (!qty) return;

    // 1) Mbps du catalog si dispo, sinon estimation
    const mbpsPerCam = pickCamMbpsFromCatalog(cam) ?? estimateCamMbpsFallback(cam, ips, codec);

    // 2) Label bloc (optionnel)
    const blk = (MODEL.cameraBlocks || []).find((b) => b.id === l.fromBlockId) || null;
    const label = blk?.label ? `${blk.label}` : "";

    rows.push({
      blockLabel: label,
      cameraId: String(cam.id || ""),
      cameraName: String(cam.name || ""),
      qty,
      ips: Number(ips),
      codec: String(codec),
      mbpsPerCam: Number(mbpsPerCam),
      mbpsLine: Number(mbpsPerCam) * qty,
    });
  });

  const totalInMbps = rows.reduce((s, r) => s + (r.mbpsLine || 0), 0);

  return { rows, totalInMbps };
}

 function computeProject() {
  const totalCameras = getTotalCameras();

  const totals = (typeof computeTotals === "function")
    ? computeTotals()
    : { totalInMbps: 0, totalPoeW: 0 };

  const totalPoeW = Number.isFinite(totals.totalPoeW) ? totals.totalPoeW : 0;

  const alerts = [];

  // -----------------------------
  // Paramètres d'enregistrement (source de vérité)
  // -----------------------------
  const rec = MODEL?.recording || {};
  const hoursPerDay = clampNum(rec.hoursPerDay, 1, 24, 24);
  const daysRetention = clampNum(rec.daysRetention, 1, 365, 14);
  const overheadPct = clampNum(rec.overheadPct, 0, 100, 15);

  const ips = clampNum(rec.fps, 1, 60, 12);
  const codec = String(rec.codec || "H.265");
  const mode = String(rec.mode || "Continu");

  // -----------------------------
  // Débit par caméra : priorité bitrate_mbps_typical
  // -----------------------------
  const pickCamMbpsFromCatalog = (cam) => {
    if (!cam) return null;

    const candidates = [
      cam.bitrate_mbps_typical,
      cam.bitrate_mbps,
      cam.mbps,
      cam.bandwidth_mbps,
      cam.stream_mbps,
      cam.bitrate,
      cam.bandwidth,
    ];

    for (const v of candidates) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  const estimateCamMbpsFallback = (cam) => {
    let mp = Number(cam?.resolution_mp);
    if (!Number.isFinite(mp) || mp <= 0) mp = 4;

    const codecFactor = codec.toUpperCase().includes("265") ? 0.65 : 1.0;
    const baseAt12ips = mp * 1.2; // 4MP -> ~4.8 Mbps
    const mbps = baseAt12ips * (ips / 12) * codecFactor;

    return Math.max(0.6, Math.min(mbps, 16));
  };

  const perCamera = (MODEL.cameraLines || [])
    .map((l) => {
      const cam = (typeof getCameraById === "function") ? getCameraById(l.cameraId) : null;
      if (!cam) return null;

      const qty = Number(l.qty || 0);
      if (!qty) return null;

      const blk = (MODEL.cameraBlocks || []).find((b) => b.id === l.fromBlockId) || null;
      const blockLabel = blk?.label ? String(blk.label) : "";

      const catMbps = pickCamMbpsFromCatalog(cam);
      const mbpsPerCam = catMbps ?? estimateCamMbpsFallback(cam);

      return {
        fromBlockId: l.fromBlockId || null,
        blockLabel,
        cameraId: String(cam.id || ""),
        cameraName: String(cam.name || ""),
        qty,
        codec,
        ips,
        mbpsPerCam: Number(mbpsPerCam),
        mbpsLine: Number(mbpsPerCam) * qty,
        mbpsSource: catMbps != null ? "catalog" : "estimate",
      };
    })
    .filter(Boolean);

  const totalInMbps = perCamera.reduce((s, r) => s + (r.mbpsLine || 0), 0);
  const safeIn = Number.isFinite(totalInMbps) ? totalInMbps : 0;

  // -----------------------------
  // Recos NVR / Switches / Disks
  // -----------------------------
  const nvrPick = pickNvr(totalCameras, safeIn);
  const switches = planPoESwitches(totalCameras, rec.reservePortsPct);

  const swBudget = (switches.plan || []).reduce(
    (t, p) => t + (Number(p?.item?.poe_budget_w || 0) * (p.qty || 0)),
    0
  );

  if (swBudget > 0 && totalPoeW > swBudget) {
    alerts.push({
      level: "warn",
      text: `PoE total estimé ${totalPoeW.toFixed(0)}W > budget switches ${swBudget.toFixed(0)}W (à vérifier).`,
    });
  }

  const requiredTB = mbpsToTB(safeIn, hoursPerDay, daysRetention, overheadPct);
  const disks = nvrPick.nvr ? pickDisks(requiredTB, nvrPick.nvr) : null;

  // -----------------------------
  // Alerts
  // -----------------------------
  if (totalCameras <= 0) {
    alerts.push({
      level: "danger",
      text: "Valide au moins 1 caméra (bouton 'Je valide cette caméra') pour ajouter des caméras au panier.",
    });
  }

  if (!nvrPick.nvr) {
    alerts.push({ level: "danger", text: "Aucun NVR compatible. Vérifie nvrs.csv (channels / max_in_mbps)." });
  }

  if (nvrPick.nvr && safeIn > Number(nvrPick.nvr.max_in_mbps || 0)) {
    alerts.push({
      level: "danger",
      text: `Débit total ${safeIn.toFixed(1)} Mbps > limite NVR (${nvrPick.nvr.max_in_mbps} Mbps).`,
    });
  }

  if (switches.required) {
    if (!CATALOG.SWITCHES.length) {
      alerts.push({
        level: "warn",
        text: "switches.csv non chargé : plan PoE généré avec valeurs génériques (4/8/16/24).",
      });
    }
    if (switches.totalPorts < switches.portsNeeded) {
      alerts.push({ level: "danger", text: "Plan switch PoE insuffisant (ports)." });
    }
  }

  if (disks && requiredTB > disks.maxTotalTB) {
    alerts.push({
      level: "danger",
      text: `Stockage requis ~${requiredTB.toFixed(1)} TB > capacité max NVR (${disks.maxTotalTB} TB).`,
    });
  }

  // ✅ On construit l'objet projet
  const proj = {
    projectName: String(MODEL?.projectName || "").trim(),

    totalCameras,
    totalInMbps: safeIn,
    totalPoeW,
    nvrPick,
    switches,
    requiredTB,
    disks,
    alerts,

    perCamera,
    storageParams: {
      daysRetention,
      hoursPerDay,
      overheadPct,
      codec,
      ips,
      mode,
    },
  };

  // ✅ KPI "compute_project" (ne casse jamais l'app)
  try {
    // si tu as KPI.snapshot => top, sinon fallback simple
    if (typeof KPI?.snapshot === "function") {
      KPI.sendNowait("compute_project", KPI.snapshot(proj, { action: "compute" }));
    } else if (typeof KPI?.sendNowait === "function") {
      KPI.sendNowait("compute_project", {
        action: "compute",
        projectName: proj.projectName || null,
        totalCameras: proj.totalCameras,
        totalInMbps: proj.totalInMbps,
        requiredTB: proj.requiredTB,
        daysRetention: proj.storageParams?.daysRetention,
        hoursPerDay: proj.storageParams?.hoursPerDay,
        overheadPct: proj.storageParams?.overheadPct,
        codec: proj.storageParams?.codec,
        ips: proj.storageParams?.ips,
        mode: proj.storageParams?.mode,
        nvr_id: proj.nvrPick?.nvr?.id ?? null,
        switch_required: !!proj.switches?.required,
      });
    } else if (typeof KPI?.send === "function") {
      KPI.send("compute_project", {
        action: "compute",
        projectName: proj.projectName || null,
        totalCameras: proj.totalCameras,
        totalInMbps: proj.totalInMbps,
        requiredTB: proj.requiredTB,
        daysRetention: proj.storageParams?.daysRetention,
        hoursPerDay: proj.storageParams?.hoursPerDay,
        overheadPct: proj.storageParams?.overheadPct,
        codec: proj.storageParams?.codec,
        ips: proj.storageParams?.ips,
        mode: proj.storageParams?.mode,
        nvr_id: proj.nvrPick?.nvr?.id ?? null,
        switch_required: !!proj.switches?.required,
      });
    }
  } catch (e) {
    // silence
  }

  return proj;
}



// petite util locale safe (si tu n’en as pas déjà)
function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}



function recommendScreenForProject(totalCameras) {
  const screens = CATALOG.SCREENS || [];
  if (!screens.length) return null;

  // Heuristique simple (tu pourras raffiner plus tard)
  const target =
    totalCameras <= 8  ? 24 :
    totalCameras <= 16 ? 32 :
    totalCameras <= 32 ? 43 : 55;

  // Choisir le plus proche
  let best = null;
  let bestDelta = Infinity;

  for (const s of screens) {
    const size = Number(s.size_inch);
    if (!Number.isFinite(size)) continue;

    const d = Math.abs(size - target);
    if (d < bestDelta) { bestDelta = d; best = s; }
  }

  return best || screens[0] || null;
}

function recommendEnclosureForNvr(nvrId) {
  const encs = CATALOG.ENCLOSURES || [];
  if (!encs.length || !nvrId) return null;

  // compatible_with = liste de refs NVR séparées par |
  const found = encs.find(e => Array.isArray(e.compatible_with) && e.compatible_with.includes(nvrId));
  return found || null;
}

function getSelectedOrRecommendedScreen(proj) {
  const screens = CATALOG.SCREENS || [];
  if (!screens.length) return { selected: null, recommended: null };

  const selected = MODEL.complements.screen.enabled
    ? pickScreenBySize(MODEL.complements.screen.sizeInch)
    : null;

  const recommended = recommendScreenForProject(proj.totalCameras) || null;
  return { selected: selected || null, recommended };
}
function recommendEnclosureForProject(proj) {
  const nvrId = proj?.nvrPick?.nvr?.id || null;
  if (!nvrId) return null;
  return recommendEnclosureForNvr(nvrId);
}

function getSelectedOrRecommendedEnclosure(proj) {
  const encs = CATALOG.ENCLOSURES || [];
  if (!encs.length) return { selected: null, recommended: null };

  // Ton UX actuelle : boîtier "auto" si enabled
  if (MODEL.complements.enclosure.enabled) {
    const screenSel = MODEL.complements.screen.enabled
      ? pickScreenBySize(MODEL.complements.screen.sizeInch)
      : null;

    const enclosureAuto = pickBestEnclosure(proj, screenSel);
    return { selected: enclosureAuto.enclosure || null, recommended: recommendEnclosureForProject(proj) };
  }

  return { selected: null, recommended: recommendEnclosureForProject(proj) };
}

    // ==========================================================
  // PROJECT CACHE + NAV GUARDS (fixes manquants)
  // ==========================================================

  function getProjectCached() {
    if (_renderProjectCache) return _renderProjectCache;
    _renderProjectCache = computeProject();
    return _renderProjectCache;
  }

  function canGoNext() {
    // règle simple : au moins 1 ligne caméra validée
    return Array.isArray(MODEL.cameraLines) && MODEL.cameraLines.length > 0 && getTotalCameras() > 0;
  }

  // ==========================================================
  // 9) UI - RESULTS
  // ==========================================================
  function ensureToggleButton() {
    if (btnToggleResults) return;
    const headerActions = document.querySelector(".actions");

    btnToggleResults = document.createElement("button");
    btnToggleResults.id = "btnToggleResults";
    btnToggleResults.type = "button";
    btnToggleResults.className = "btn secondary";
    btnToggleResults.textContent = "Afficher résultats";
    btnToggleResults.addEventListener("click", () => {
      MODEL.ui.resultsShown = !MODEL.ui.resultsShown;
      syncResultsUI();
    });

    if (headerActions) headerActions.appendChild(btnToggleResults);
    else if (DOM.results?.parentElement) DOM.results.parentElement.prepend(btnToggleResults);
  }

  function setToggleLabel() {
    if (!btnToggleResults) return;
    btnToggleResults.textContent = MODEL.ui.resultsShown ? "Masquer résultats" : "Afficher résultats";
  }

  function showResultsUI() {
    if (DOM.resultsEmpty) DOM.resultsEmpty.classList.add("hidden");
    if (DOM.results) DOM.results.classList.remove("hidden");
  }

  function hideResultsUI() {
    if (DOM.resultsEmpty) DOM.resultsEmpty.classList.remove("hidden");
    if (DOM.results) DOM.results.classList.add("hidden");
  }


  function renderAlerts(alerts) {
    DOM.alertsEl.innerHTML = "";
    for (const al of alerts) {
      const li = document.createElement("li");
      if (al.level === "danger") li.classList.add("danger");
      if (al.level) li.classList.add(al.level);
      li.textContent = al.text;
      DOM.alertsEl.appendChild(li);
    }
  }

  function renderFinalSummary(proj) {
  const projectScore =
    typeof computeCriticalProjectScore === "function"
      ? computeCriticalProjectScore()
      : null;

  const safe = (v) =>
    typeof safeHtml === "function" ? safeHtml(String(v ?? "")) : String(v ?? "");

  const pickImg = (family, id, obj) => {
    const direct = obj && obj.image_url ? String(obj.image_url) : "";
    if (direct) return direct;

    if (typeof getThumbSrc === "function") {
      const s = getThumbSrc(family, id);
      if (s) return String(s);
    }
    return "";
  };

  const thumb = (imgUrl, alt) => {
    if (imgUrl) {
      return `<div class="sumThumb"><img class="sumThumbImg" src="${safe(imgUrl)}" alt="${safe(alt || "")}"></div>`;
    }
    return `<div class="sumThumb sumThumbPh">—</div>`;
  };

  const row = ({ qty, ref, name, placeLabel, imgUrl }) => {
    const place = placeLabel ? `<div class="sumPlace">${safe(placeLabel)}</div>` : "";
    return `
      <div class="sumRow">
        ${thumb(imgUrl, name)}
        <div class="sumMain">
          <div class="sumTop">
            <span class="sumPill">${safe(qty)}×</span>
            <span class="sumPill">${safe(ref || "—")}</span>
          </div>
          ${place}
          <div class="sumName">${safe(name || "")}</div>
        </div>
      </div>
    `;
  };

  // Caméras (avec libellé de bloc)
  const camRows = (MODEL.cameraLines || [])
    .map((l) => {
      const cam = getCameraById(l.cameraId);
      if (!cam) return null;

      const blk = (MODEL.cameraBlocks || []).find((b) => b.id === l.fromBlockId) || null;
      const placeLabel = blk && blk.label ? `${blk.label}` : "";

      const imgUrl = pickImg("cameras", cam.id, cam);

      return row({
        qty: l.qty || 0,
        ref: cam.id || "—",
        name: cam.name || "",
        placeLabel,
        imgUrl,
      });
    })
    .filter(Boolean);

  const camsHtml = camRows.length
    ? `<div class="sumList">${camRows.join("")}</div>`
    : `<div class="sumEmpty">—</div>`;

  // Accessoires
  const accRows = (MODEL.accessoryLines || [])
    .map((a) => {
      const imgUrl = pickImg("accessories", a.accessoryId, null);
      return row({
        qty: a.qty || 0,
        ref: a.accessoryId,
        name: a.name || a.accessoryId,
        placeLabel: "",
        imgUrl,
      });
    })
    .filter(Boolean);

  const accsHtml = accRows.length
    ? `<div class="sumList">${accRows.join("")}</div>`
    : `<div class="sumEmpty">—</div>`;

  // NVR
  const nvr = proj && proj.nvrPick ? proj.nvrPick.nvr : null;
  const nvrHtml = nvr
    ? `<div class="sumList">${row({
        qty: 1,
        ref: nvr.id,
        name: nvr.name,
        placeLabel: "",
        imgUrl: pickImg("nvrs", nvr.id, nvr),
      })}</div>`
    : `<div class="sumEmpty">—</div>`;

  // Switch PoE
  const swRows =
    proj && proj.switches && proj.switches.required
      ? (proj.switches.plan || []).map((p) => {
          const it = p.item || null;
          const id = (it && it.id) || "—";
          return row({
            qty: p.qty || 0,
            ref: id,
            name: (it && it.name) || "",
            placeLabel: "",
            imgUrl: pickImg("switches", id, it),
          });
        })
      : [];

  const swHtml = swRows.length
    ? `<div class="sumList">${swRows.join("")}</div>`
    : `<div class="sumEmpty">• (non obligatoire)</div>`;

  // Stockage
  const disk = proj ? proj.disks : null;
  const hdd = disk ? disk.hddRef : null;

  const hddHtml = disk
    ? `<div class="sumList">${row({
        qty: disk.count,
        ref: (hdd && hdd.id) || `${disk.sizeTB}TB`,
        name: (hdd && hdd.name) || `Disques ${disk.sizeTB} TB`,
        placeLabel: "",
        imgUrl: pickImg("hdds", (hdd && hdd.id) || `${disk.sizeTB}TB`, hdd),
      })}</div>`
    : `<div class="sumEmpty">—</div>`;

  // Compléments
  const scr = getSelectedOrRecommendedScreen(proj).selected;
  const enc = getSelectedOrRecommendedEnclosure(proj).selected;

  const screenHtml = scr
    ? `<div class="sumList">${row({
        qty: MODEL.complements?.screen?.qty || 1,
        ref: scr.id,
        name: scr.name,
        placeLabel: "",
        imgUrl: pickImg("screens", scr.id, scr),
      })}</div>`
    : `<div class="sumEmpty">• (désactivé)</div>`;

  const enclosureHtml = enc
    ? `<div class="sumList">${row({
        qty: MODEL.complements?.enclosure?.qty || 1,
        ref: enc.id,
        name: enc.name,
        placeLabel: "",
        imgUrl: pickImg("enclosures", enc.id, enc),
      })}</div>`
    : `<div class="sumEmpty">• (désactivé)</div>`;

  const signageEnabled = !!MODEL.complements?.signage?.enabled;
  const signObj =
    typeof getSelectedOrRecommendedSign === "function"
      ? getSelectedOrRecommendedSign()
      : { sign: null };
  const sign = signObj?.sign || null;

  const signageHtml = signageEnabled
    ? sign
      ? `<div class="sumList">${row({
          qty: MODEL.complements?.signage?.qty || 1,
          ref: sign.id,
          name: sign.name,
          placeLabel: "",
          imgUrl: pickImg("signage", sign.id, sign),
        })}</div>`
      : `<div class="sumEmpty">—</div>`
    : `<div class="sumEmpty">• (désactivé)</div>`;

  const totalMbps = (proj && proj.totalInMbps != null ? proj.totalInMbps : 0).toFixed(1);
  const reqTb = (proj && proj.requiredTB != null ? proj.requiredTB : 0).toFixed(1);

  return `
    <div class="recoCard finalSummary">
      <div class="recoHeader">
        <div>
          <div class="recoName">Résumé de la solution</div>
          <div class="muted">Format devis (Qté × Réf — Désignation)</div>
        </div>

        <div class="score">
          ${projectScore != null ? `${projectScore}/100` : "—"}
          <div class="muted" style="margin-top:6px;text-align:right;line-height:1.3">score</div>
        </div>
      </div>

      <div class="finalGrid">
        <div class="finalCard">
          <div class="finalCardHead">
            <div class="finalCardTitle">Caméras</div>
            <div class="finalChip">${camRows.length} ligne(s)</div>
          </div>
          ${camsHtml}
        </div>

        <div class="finalCard">
          <div class="finalCardHead">
            <div class="finalCardTitle">NVR</div>
            <div class="finalChip">${nvr ? "1 ligne" : "—"}</div>
          </div>
          ${nvrHtml}
        </div>

        <div class="finalCard">
          <div class="finalCardHead">
            <div class="finalCardTitle">Supports / accessoires</div>
            <div class="finalChip">${accRows.length} ligne(s)</div>
          </div>
          ${accsHtml}
        </div>

        <div class="finalCard">
          <div class="finalCardHead">
            <div class="finalCardTitle">Switch PoE</div>
            <div class="finalChip">${swRows.length ? `${swRows.length} ligne(s)` : "—"}</div>
          </div>
          ${swHtml}
        </div>

        <div class="finalCard">
          <div class="finalCardHead">
            <div class="finalCardTitle">Stockage</div>
            <div class="finalChip">${disk ? "1 ligne" : "—"}</div>
          </div>
          ${hddHtml}
        </div>

        <div class="finalCard">
          <div class="finalCardHead">
            <div class="finalCardTitle">Produits complémentaires</div>
            <div class="finalChip">optionnel</div>
          </div>

          <div class="finalSub">
            <div class="finalSubTitle">Écran</div>
            ${screenHtml}
          </div>

          <div class="finalSub">
            <div class="finalSubTitle">Boîtier NVR</div>
            ${enclosureHtml}
          </div>

          <div class="finalSub">
            <div class="finalSubTitle">Panneau de signalisation</div>
            ${signageHtml}
          </div>
        </div>
      </div>

      <div class="finalKpis">
        <div class="kpiTile">
          <div class="kpiLabel">Débit total estimé</div>
          <div class="kpiValue">${safe(totalMbps)} <span class="kpiUnit">Mbps</span></div>
        </div>
        <div class="kpiTile">
          <div class="kpiLabel">Stockage requis</div>
          <div class="kpiValue">~${safe(reqTb)} <span class="kpiUnit">TB</span></div>
        </div>
      </div>
    </div>
  `;
}


function setFinalContent(proj) {
  // Source de vérité pour export PDF / boutons / etc.
  LAST_PROJECT = proj;

  // 1) On génère le HTML du résumé
  const html = renderFinalSummary(proj);

  // 2) On l'injecte là où ton PDF allait le chercher "avant"
  if (DOM?.primaryRecoEl) DOM.primaryRecoEl.innerHTML = html;

  // 3) Si tu as une étape "summary" dédiée, tu peux aussi alimenter son conteneur
  // (mets ici le bon id/element si tu l'as)
  if (DOM?.summaryEl) DOM.summaryEl.innerHTML = html;

  // 4) Alertes (si utilisées)
  if (typeof renderAlerts === "function") renderAlerts(proj.alerts);

  // 5) On nettoie les alternatives si tu ne veux plus les afficher
  if (DOM?.alternativesEl) DOM.alternativesEl.innerHTML = "";

  MODEL.ui = MODEL.ui || {};
  MODEL.ui.resultsShown = true;
}


// ==========================================================
// THUMBS / IMAGES (LOCAL DATA ONLY)
// ==========================================================
const LOCAL_IMG_ROOT = "/data/Images";
const IMG_EXTS = ["png", "jpg", "jpeg", "webp"];
const __thumbCache = new Map();

function getThumbSrc(family, id) {
  try {
    const fam = String(family || "").trim();
    const ref = String(id || "").trim();
    if (!fam || !ref) return "";

    const key = `${fam}::${ref}`;
    if (__thumbCache.has(key)) return __thumbCache.get(key);

    // 👉 Convention projet : 1 image = <ID>.png dans /data/Images/<family>/
    const url = `${LOCAL_IMG_ROOT}/${fam}/${encodeURIComponent(ref)}.png`;

    __thumbCache.set(key, url);
    return url;
  } catch {
    return "";
  }
}

const LOCAL_PDF_ROOT = "/data/fiche_tech";

// ✅ Datasheets 100% locaux (même logique que getThumbSrc)
function getDatasheetSrc(family, ref) {
  const id = String(ref || "").trim();
  if (!id) return "";
  const fam = String(family || "").toLowerCase().trim();

  let folder = fam;
  if (fam === "cameras") folder = "cameras";
  else if (fam === "nvrs") folder = "nvrs";
  else if (fam === "hdds") folder = "hdds";
  else if (fam === "switches") folder = "switches";
  else if (fam === "accessories") folder = "accessories";
  else if (fam === "screens") folder = "screens";
  else if (fam === "enclosures") folder = "enclosures";
  else if (fam === "signage") folder = "signage";

  // on suppose: /data/Datasheets/<folder>/<ID>.pdf
  return `${LOCAL_PDF_ROOT}/${folder}/${encodeURIComponent(id)}.pdf`;
}

// ✅ Force le catalogue à utiliser les médias locaux (images + fiches)
function applyLocalMediaToCatalog() {
  const apply = (familyKey, list) => {
    if (!Array.isArray(list)) return;
    const fam = String(familyKey || "").toLowerCase();
    for (const it of list) {
      const id = String(it?.id || "").trim();
      if (!id) continue;
      it.image_url = getThumbSrc(fam, id);
      it.datasheet_url = getDatasheetSrc(fam, id);
    }
  };

  apply("cameras", CATALOG?.CAMERAS);
  apply("nvrs", CATALOG?.NVRS);
  apply("hdds", CATALOG?.HDDS);
  apply("switches", CATALOG?.SWITCHES);
  apply("accessories", CATALOG?.ACCESSORIES);
  apply("screens", CATALOG?.SCREENS);
  apply("enclosures", CATALOG?.ENCLOSURES);
  apply("signage", CATALOG?.SIGNAGE);
}



function imgTag(family, ref) {
  const src = getThumbSrc(family, ref);
  if (!src) return "—";
  return `<img class="thumb" src="${src}" alt="${ref}"
    onerror="this.style.display='none'; this.insertAdjacentHTML('afterend','<span class=muted>—</span>');" />`;
}

  function buildPdfHtml(proj) {
  const now = new Date();
  const dateStr = now.toLocaleString("fr-FR");

  const safe = (v) =>
    typeof safeHtml === "function" ? safeHtml(String(v ?? "")) : String(v ?? "");

  const projectScore =
    typeof computeCriticalProjectScore === "function"
      ? computeCriticalProjectScore()
      : null;

  // Branding COMELIT
  const LOGO_SRC = "/assets/logo.png";
  const COMELIT_GREEN = "#00BC70"; // Pantone 7480 C
  const COMELIT_BLUE = "#1C1F2A"; // Pantone 532 C

  // ✅ Nom du projet (priorité proj -> MODEL)
  const projectName = String(proj?.projectName ?? MODEL?.projectName ?? "").trim();
  const projectNameDisplay = projectName ? projectName : "—";

  // Helpers FR
  const frCodec = (c) => {
    const s = String(c || "").toLowerCase().trim();
    if (s === "h265" || s === "h.265") return "H.265";
    if (s === "h264" || s === "h.264") return "H.264";
    return c ? String(c).toUpperCase() : "—";
  };

  const frMode = (m) => {
    const s = String(m || "").toLowerCase().trim();
    if (s === "continuous" || s === "continu" || s === "24/7") return "Continu";
    if (s === "motion" || s === "détection" || s === "detection") return "Sur détection";
    if (s === "mixed" || s === "mixte") return "Mixte";
    return m ? String(m) : "—";
  };

  const imgTag = (family, ref) => {
    const src = getThumbSrc(family, ref);
    if (!src) return "—";
    return `<img class="thumb" crossorigin="anonymous" src="${src}" alt="${safe(ref)}"
      onerror="this.style.display='none'; this.insertAdjacentHTML('afterend','<span class=muted>—</span>');" />`;
  };

  // Tableau produits (Qté / Réf / Désignation / Image)
  const row4 = (qty, ref, name, family) => `
    <tr>
      <td class="colQty">${safe(qty)}</td>
      <td class="colRef">${safe(ref || "—")}</td>
      <td class="colName">${safe(name || "")}</td>
      <td class="colImg">${imgTag(family, ref)}</td>
    </tr>
  `;

  const table4 = (rowsHtml) => {
    if (!rowsHtml) return `<div class="muted">—</div>`;
    return `
      <table class="tbl">
        <thead>
          <tr>
            <th class="colQty">Qté</th>
            <th class="colRef">Référence</th>
            <th class="colName">Désignation</th>
            <th class="colImg">Image</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  };

  // ✅ Header commun (V3) : logo | titres | score
const headerHtml = (subtitle) => `
  <div class="pdfHeader">
    <div class="headerGrid">
      <img class="brandLogo" src="${LOGO_SRC}" onerror="this.style.display='none'" alt="Comelit">

      <div class="headerTitles">
        <div class="mainTitle">Rapport de configuration Vidéosurveillance</div>
        <div class="metaLine">Généré le ${safe(dateStr)} • Configurateur Comelit (MVP)</div>
      </div>

      <div class="scorePill">
        <span class="scoreLabel">Score</span>
        <span class="scoreValue">${projectScore != null ? `${safe(projectScore)}/100` : "—"}</span>
      </div>
    </div>

    <div class="headerSubWrap">
      <div class="headerSubLine">
        <span class="headerSubDot"></span>
        <span class="headerSubText">${safe(subtitle)}</span>
      </div>
    </div>
  </div>
`;


  // Extraction produits
  const camsRows = (MODEL.cameraLines || [])
    .map((l) => {
      const cam = typeof getCameraById === "function" ? getCameraById(l.cameraId) : null;
      if (!cam) return "";
      const blk = (MODEL.cameraBlocks || []).find((b) => b.id === l.fromBlockId) || null;
      const label = blk?.label ? `${blk.label} — ` : "";
      return row4(l.qty || 0, cam.id, `${label}${cam.name || ""}`, "cameras");
    })
    .filter(Boolean)
    .join("");

  const accRows = (MODEL.accessoryLines || [])
    .map((a) => row4(a.qty || 0, a.accessoryId || "—", a.name || a.accessoryId || "", "accessories"))
    .filter(Boolean)
    .join("");

  const nvr = proj?.nvrPick?.nvr || null;
  const nvrRows = nvr ? row4(1, nvr.id, nvr.name, "nvrs") : "";

  const swRows = proj?.switches?.required
    ? (proj?.switches?.plan || [])
        .map((p) => row4(p.qty || 0, p?.item?.id || "—", p?.item?.name || "", "switches"))
        .filter(Boolean)
        .join("")
    : "";

  const disk = proj?.disks || null;
  const hdd = disk?.hddRef || null;
  const hddRows = disk
    ? row4(disk.count || 0, hdd?.id || `${disk.sizeTB}TB`, hdd?.name || `Disques ${disk.sizeTB} TB`, "hdds")
    : "";

  const scr =
    typeof getSelectedOrRecommendedScreen === "function"
      ? getSelectedOrRecommendedScreen(proj)?.selected
      : null;

  const enc =
    typeof getSelectedOrRecommendedEnclosure === "function"
      ? getSelectedOrRecommendedEnclosure(proj)?.selected
      : null;

  const signageEnabled = !!(MODEL?.complements?.signage?.enabled ?? MODEL?.complements?.signage?.enable);
  const sign =
    typeof getSelectedOrRecommendedSign === "function"
      ? getSelectedOrRecommendedSign()?.sign || null
      : null;

  const compRows = [
    scr ? row4(MODEL?.complements?.screen?.qty || 1, scr.id, scr.name, "screens") : "",
    enc ? row4(MODEL?.complements?.enclosure?.qty || 1, enc.id, enc.name, "enclosures") : "",
    signageEnabled && sign ? row4(MODEL?.complements?.signage?.qty || 1, sign.id, sign.name, "signage") : "",
  ]
    .filter(Boolean)
    .join("");

  // KPI
  const totalMbps = Number(proj?.totalInMbps ?? 0);
  const requiredTB = Number(proj?.requiredTB ?? 0);

  // Paramètres enregistrement
  const sp = proj?.storageParams || {};
  const daysRetention = sp.daysRetention ?? MODEL?.recording?.daysRetention ?? 14;
  const hoursPerDay = sp.hoursPerDay ?? MODEL?.recording?.hoursPerDay ?? 24;
  const overheadPct = sp.overheadPct ?? MODEL?.recording?.overheadPct ?? 15;
  const codec = frCodec(sp.codec ?? MODEL?.recording?.codec ?? "H.265");
  const ips = sp.ips ?? MODEL?.recording?.fps ?? 12;
  const mode = frMode(sp.mode ?? MODEL?.recording?.mode ?? "Continu");

  // Annexe : débit par caméra
  const MAX_ANNEX_ROWS = 22;
  const perCam = Array.isArray(proj?.perCamera) ? proj.perCamera : [];
  const perCamShown = perCam.slice(0, MAX_ANNEX_ROWS);
  const perCamHiddenCount = Math.max(0, perCam.length - perCamShown.length);

  const perCamRows = perCamShown
    .map(
      (r) => `
      <tr>
        <td class="aQty">${safe(r.qty)}</td>
        <td class="aRef">${safe(r.cameraId)}</td>
        <td class="aName">${safe(r.blockLabel ? r.blockLabel + " — " + r.cameraName : r.cameraName)}</td>
        <td class="aNum">${safe(Number(r.mbpsPerCam || 0).toFixed(2))}</td>
        <td class="aNum">${safe(Number(r.mbpsLine || 0).toFixed(2))}</td>
      </tr>
    `
    )
    .join("");

  // =====================================================================
  // ✅ ANNEXE 2 — SYNOPTIQUE (FIT AUTO + MARGES + IMAGES DATA)
  // Objectif : "tout tient sur 1 page", moins collé, et plus il y a de cam,
  // plus ça rétrécit automatiquement.
  // =====================================================================

const buildSynopticHtml = (proj) => {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safe = (v) =>
    typeof safeHtml === "function" ? safeHtml(String(v ?? "")) : String(v ?? "");

  // -----------------------------
  // Helpers robustes
  // -----------------------------
  const firstTruthy = (...vals) =>
    vals.find((v) => v != null && String(v).trim() !== "") ?? "";

  const toId = (obj) =>
    firstTruthy(
      obj?.id,
      obj?.ref,
      obj?.sku,
      obj?.code,
      obj?.product_id,
      obj?.productId,
      obj?.article,
      obj?.article_id
    );

  const isObj = (v) => v && typeof v === "object";

  const deepScan = (root, maxNodes = 2500) => {
    const out = [];
    const seen = new Set();
    const queue = [root];
    while (queue.length && out.length < maxNodes) {
      const cur = queue.shift();
      if (!isObj(cur)) continue;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      if (Array.isArray(cur)) for (const it of cur) queue.push(it);
      else for (const k of Object.keys(cur)) queue.push(cur[k]);
    }
    return out;
  };

  const findInCatalogById = (catalogList, wantedId) => {
    if (!wantedId) return null;
    if (!Array.isArray(catalogList)) return null;
    const norm = String(wantedId).trim().toLowerCase();
    return (
      catalogList.find((x) => String(toId(x) || "").trim().toLowerCase() === norm) ||
      null
    );
  };

  // -----------------------------
  // 0) Récupération caméraLines robuste (MODEL ou proj)
  // -----------------------------
  const getAllCameraLines = () => {
    const linesModel = Array.isArray(MODEL?.cameraLines) ? MODEL.cameraLines : [];
    if (linesModel.length) return linesModel;

    // Fallbacks courants côté proj
    const p1 = Array.isArray(proj?.cameraLines) ? proj.cameraLines : [];
    if (p1.length) return p1;

    const p2 = Array.isArray(proj?.cameras?.lines) ? proj.cameras.lines : [];
    if (p2.length) return p2;

    // Certains projets gardent un plan de caméras
    const plan = Array.isArray(proj?.cameras?.plan) ? proj.cameras.plan : [];
    // Convertit plan -> lines si possible
    if (plan.length) {
      // plan item typique: { qty, item:{id,name...} } ou {qty, cameraId}
      return plan
        .map((p) => {
          const qty = Number(p?.qty || 0);
          const camId = String(p?.cameraId || p?.item?.id || "");
          if (!qty || !camId) return null;
          return { qty, cameraId: camId, fromBlockId: p?.fromBlockId || "ALL" };
        })
        .filter(Boolean);
    }

    // Dernier recours : deepScan pour trouver des objets qui ressemblent à une line
    const nodes = deepScan(proj);
    const found = [];
    for (const n of nodes) {
      if (!isObj(n)) continue;
      if (!("qty" in n) && !("quantity" in n)) continue;
      const camId = n.cameraId || n.camId || n.id || n.ref;
      if (!camId) continue;
      const qty = Number(n.qty ?? n.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      found.push({ qty, cameraId: String(camId), fromBlockId: n.fromBlockId || "ALL" });
      if (found.length > 80) break;
    }
    return found;
  };

  const sumCams = () => {
    const lines = getAllCameraLines();
    return lines.reduce((acc, l) => acc + Number(l?.qty || 0), 0);
  };

  // -----------------------------
  // 1) Groupes caméras (robuste)
  // -----------------------------
  const buildCameraBlocks = () => {
    const blocks = Array.isArray(MODEL?.cameraBlocks) ? MODEL.cameraBlocks : [];
    const lines = getAllCameraLines();

    const map = new Map();

    for (const l of lines) {
      const qty = Number(l?.qty || 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const camId = String(l?.cameraId || l?.id || "").trim();
      if (!camId) continue;

      // Cam depuis fonction existante ou catalogue
      let cam = null;
      if (typeof getCameraById === "function") cam = getCameraById(camId);
      if (!cam) cam = findInCatalogById(CATALOG?.CAMERAS, camId);

      if (!cam) continue;

      const fromId = l?.fromBlockId || "ALL";
      const blk = blocks.find((b) => b.id === fromId) || null;
      const blockLabel =
        String(blk?.label || "").trim() ||
        (fromId === "ALL" ? "Caméras" : `Bloc ${String(fromId).slice(0, 6)}`);

      if (!map.has(fromId)) {
        map.set(fromId, {
          blockId: fromId,
          label: blockLabel,
          qty: 0,
          refs: [],
          primaryRef: String(cam.id || camId || ""),
        });
      }

      const b = map.get(fromId);
      b.qty += qty;

      const ref = String(cam.id || camId || "");
      if (ref && !b.refs.includes(ref)) b.refs.push(ref);
      if (!b.primaryRef && ref) b.primaryRef = ref;
    }

    const ordered = [];

    // Respecte l’ordre des blocks UI quand dispo
    for (const blk of blocks) if (map.has(blk.id)) ordered.push(map.get(blk.id));

    // Ajoute le reste
    for (const [, v] of map.entries()) if (!ordered.includes(v)) ordered.push(v);

    // Si pas de blocks UI, mais on a des cams : fallback “ALL”
    if (ordered.length === 0) {
      const total = sumCams();
      if (total > 0) {
        ordered.push({
          blockId: "ALL",
          label: "Caméras",
          qty: total,
          refs: [],
          primaryRef: "",
        });
      }
    }

    return ordered;
  };

  // -----------------------------
  // 2) Switches (inchangé, mais safe)
  // -----------------------------
  const expandSwitches = () => {
    const list = [];
    const plan = Array.isArray(proj?.switches?.plan) ? proj.switches.plan : [];
    let sIdx = 1;

    for (const p of plan) {
      const qty = Number(p?.qty || 0);
      const item = p?.item || {};
      const id = String(item?.id || "SWITCH");
      const name = String(item?.name || id);

      const portsCandidates = [
        item?.ports,
        item?.ports_count,
        item?.poe_ports,
        item?.poe_ports_count,
      ];

      let portsCap = 0;
      for (const v of portsCandidates) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          portsCap = n;
          break;
        }
      }
      if (!portsCap) portsCap = 8;

      const count = Math.max(1, qty || 0);
      for (let k = 0; k < count; k++) list.push({ idx: sIdx++, id, name, portsCap });
    }

    if ((proj?.switches?.required || false) && list.length === 0) {
      list.push({ idx: 1, id: "SWITCH", name: "Switch PoE", portsCap: 8 });
    }

    if (!(proj?.switches?.required || false)) return [];
    return list;
  };

  // -----------------------------
  // 3) Allocation blocs -> switches
  // -----------------------------
  const allocateBlocksToSwitches = (camBlocks, switches) => {
    if (!switches.length) return [];
    const buckets = switches.map((sw) => ({ sw, blocks: [], used: 0 }));
    let si = 0;

    for (const b of camBlocks) {
      if (si >= buckets.length) si = Math.max(0, buckets.length - 1);

      while (
        si < buckets.length - 1 &&
        buckets[si].used + b.qty > buckets[si].sw.portsCap &&
        buckets[si].used > 0
      ) {
        si++;
      }

      buckets[si].blocks.push(b);
      buckets[si].used += b.qty;
    }
    return buckets;
  };

  // -----------------------------
  // 4) Résolution NVR / HDD / SCREEN (identique à ta logique)
  // -----------------------------
  const camBlocks = buildCameraBlocks();
  const switches = expandSwitches();
  const alloc = allocateBlocksToSwitches(camBlocks, switches);

  const camCount = Math.max(1, camBlocks.length);
  const swCount = Math.max(0, switches.length);

  const nvr = proj?.nvrPick?.nvr || proj?.nvrPick?.item || proj?.nvr || null;
  const nvrId = String(toId(nvr) || "—");
  const nvrName = String(nvr?.name || "");

  // HDD
  const resolveHdd = () => {
    const diskPlan =
      proj?.storage?.diskPlan ||
      proj?.storage?.disk ||
      proj?.storage?.plan ||
      proj?.storage?.hddPlan ||
      proj?.diskPlan ||
      proj?.disk ||
      null;

    const candidates = [];

    const directObj =
      proj?.hddPick?.hdd ||
      proj?.hddPick?.item ||
      proj?.storage?.hddPick?.hdd ||
      proj?.storage?.hddPick?.item ||
      proj?.storage?.hdd ||
      proj?.hdd ||
      null;

    if (directObj) candidates.push(directObj);

    if (Array.isArray(diskPlan?.items)) {
      for (const it of diskPlan.items) {
        if (!it) continue;
        if (it.item) candidates.push(it.item);
        candidates.push(it);
      }
    } else if (Array.isArray(diskPlan)) {
      for (const it of diskPlan) {
        if (!it) continue;
        if (it.item) candidates.push(it.item);
        candidates.push(it);
      }
    } else if (diskPlan && typeof diskPlan === "object") {
      candidates.push(diskPlan);
      if (diskPlan.item) candidates.push(diskPlan.item);
    }

    const nodes = deepScan(proj);
    for (const n of nodes) candidates.push(n);

    const pick = (obj) => {
      const id = String(toId(obj) || "").trim();
      if (!id) return null;
      const inCat = findInCatalogById(CATALOG?.HDDS, id);
      if (inCat) return inCat;
      const cap = obj?.capacity_tb ?? obj?.capacityTB ?? obj?.capacity;
      if (Number.isFinite(Number(cap))) return obj;
      return null;
    };

    let found = null;
    for (const c of candidates) {
      found = pick(c);
      if (found) break;
    }

    const qty =
      Number(
        firstTruthy(
          diskPlan?.count,
          diskPlan?.qty,
          diskPlan?.quantity,
          diskPlan?.items?.[0]?.qty,
          diskPlan?.items?.[0]?.count,
          diskPlan?.items?.[0]?.quantity,
          0
        )
      ) || 0;

    const id = found ? String(toId(found) || "") : "";
    return { id, obj: found, qty };
  };

  // SCREEN
  const resolveScreen = () => {
    const enabled = !!(proj?.complements?.screen?.enabled || MODEL?.complements?.screen?.enabled);

    const direct =
      proj?.complements?.screen?.pick ||
      proj?.complements?.screen?.selected ||
      proj?.complements?.screen?.item ||
      proj?.complements?.screenPick?.screen ||
      proj?.screenPick?.screen ||
      proj?.screen ||
      MODEL?.complements?.screen?.pick ||
      MODEL?.complements?.screen?.selected ||
      null;

    const directId = String(toId(direct) || "").trim();
    const directInCat = directId ? findInCatalogById(CATALOG?.SCREENS, directId) : null;

    if (directInCat) return { enabled: true, id: String(toId(directInCat) || ""), obj: directInCat };
    if (direct && directId && /^([MH]MON)/i.test(directId)) return { enabled: true, id: directId, obj: direct };

    const sizeInch =
      Number(
        firstTruthy(
          proj?.complements?.screen?.sizeInch,
          proj?.complements?.screen?.size_inch,
          proj?.complements?.screen?.size,
          MODEL?.complements?.screen?.sizeInch,
          MODEL?.complements?.screen?.size_inch,
          MODEL?.complements?.screen?.size
        )
      ) || 0;

    if (enabled && sizeInch > 0 && Array.isArray(CATALOG?.SCREENS)) {
      let best = null;
      let bestD = Infinity;
      for (const s of CATALOG.SCREENS) {
        const si = Number(s?.size_inch ?? s?.sizeInch ?? 0);
        if (!Number.isFinite(si) || si <= 0) continue;
        const d = Math.abs(si - sizeInch);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) return { enabled: true, id: String(toId(best) || ""), obj: best };
    }

    const nodes = deepScan(proj);
    for (const n of nodes) {
      const id = String(toId(n) || "").trim();
      if (!id) continue;
      const inCat = findInCatalogById(CATALOG?.SCREENS, id);
      if (inCat) return { enabled: true, id: String(toId(inCat) || ""), obj: inCat };
    }

    return { enabled: !!enabled, id: "", obj: null };
  };

  const hddRes = resolveHdd();
  const hddId = String(hddRes.id || "");
  const hddObj = hddRes.obj;
  const hddQty = Number(hddRes.qty || 0) || 0;

  const screenRes = resolveScreen();
  const scrEnabled = !!screenRes.enabled;
  const screenId = String(screenRes.id || "");
  const scr = screenRes.obj;

  // -----------------------------
  // 5) Layout adaptatif (W/H virtuels)
  // -----------------------------
  const W = 1120;
  const H = 720;

  let densityScale = 1;
  if (camCount > 4) densityScale -= (camCount - 4) * 0.05;
  if (swCount > 2) densityScale -= (swCount - 2) * 0.06;
  densityScale = clamp(densityScale, 0.65, 1);


  // Grille
  const camX = 70;
  const swX = 400;
  const coreX = 880;

  const topY = 150;
  const bottomY = H - 140;

  const distributeY = (count) => {
    if (count <= 1) return [Math.round((topY + bottomY) / 2)];
    const gap = (bottomY - topY) / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(topY + i * gap));
  };

  const camYs = distributeY(camCount);
  const swYs = distributeY(Math.max(1, swCount || 1));

  // Helpers % (pour fit parfait dans la page)
  const pctX = (x) => `${((x / W) * 100).toFixed(3)}%`;
  const pctY = (y) => `${((y / H) * 100).toFixed(3)}%`;
  const pctW = (w) => `${((w / W) * 100).toFixed(3)}%`;
  const pctH = (h) => `${((h / H) * 100).toFixed(3)}%`;

  // -----------------------------
  // 6) Nodes & images
  // -----------------------------
  const camCardW = 240;
  const swCardW = 210;

  const blockToSwitch = new Map();
  alloc.forEach((b) => (b.blocks || []).forEach((blk) => blockToSwitch.set(blk.blockId, b.sw.idx)));

  const camNodes = camBlocks.map((b, i) => ({
    ...b,
    x: camX,
    y: camYs[i] || camYs[camYs.length - 1],
    img: typeof getThumbSrc === "function" ? getThumbSrc("cameras", b.primaryRef) : "",
  }));

  const swNodes = switches.map((sw, i) => ({
    ...sw,
    x: swX,
    y: swYs[i] || swYs[swYs.length - 1],
    img: typeof getThumbSrc === "function" ? getThumbSrc("switches", sw.id) : "",
  }));

  const screenX = coreX - 170;
  const screenY = 135;
  const nvrY = 320;

  const wanW = 360;
  const wanH = 92;
  const wanX0 = clamp(Math.round(coreX - wanW / 2), 30, W - 30 - wanW);
  const wanY = 555;

  // -----------------------------
  // 7) Câbles (SVG full canvas)
  // -----------------------------
  const cableOrtho = (x1, y1, x2, y2, stroke, dash = "", w = 3.4) => {
    const midX = Math.round((x1 + x2) / 2);
    return `
      <path d="M ${x1} ${y1}
               L ${midX} ${y1}
               L ${midX} ${y2}
               L ${x2} ${y2}"
        fill="none"
        stroke="${stroke}"
        stroke-width="${w}"
        stroke-linecap="round"
        stroke-linejoin="round"
        ${dash ? `stroke-dasharray="${dash}"` : ""} />
    `;
  };

  const poeLines = camNodes
    .map((c) => {
      const x1 = c.x + camCardW - 18;
      const y1 = c.y + 28;

      const nvrEntryX = Math.round(coreX - 190);
      const nvrEntryY = nvrY + 60;

      if (!swNodes.length) return cableOrtho(x1, y1, nvrEntryX, nvrEntryY, "#dc2626", "", 3.8);

      const swIdx = blockToSwitch.get(c.blockId) || swNodes[0]?.idx || 1;
      const sw = swNodes.find((s) => s.idx === swIdx) || swNodes[0];

      const x2 = sw.x - 18;
      const y2 = sw.y + 28;

      return cableOrtho(x1, y1, x2, y2, "#dc2626", "", 3.8);
    })
    .join("");

  const uplinkLines = swNodes
    .map((sw) => {
      const x1 = sw.x + swCardW - 18;
      const y1 = sw.y + 28;

      const nvrEntryX = Math.round(coreX - 190);
      const nvrEntryY = nvrY + 60;

      return cableOrtho(x1, y1, nvrEntryX, nvrEntryY, "#6b7280", "6 6", 3.4);
    })
    .join("");

  const hdmiLine =
    scrEnabled && screenId
      ? (() => {
          const x1 = coreX + 10;
          const y1 = nvrY + 45;
          const x2 = screenX + 40;
          const y2 = screenY + 75;
          return cableOrtho(x1, y1, x2, y2, "#2563eb", "", 3.2);
        })()
      : "";

  const nvrToWan = (() => {
    const x1 = coreX + 10;
    const y1 = nvrY + 150;
    const x2 = wanX0 + 20;
    const y2 = wanY + 46;
    return cableOrtho(x1, y1, x2, y2, "#6b7280", "6 6", 3.2);
  })();

  const cablesSvg = `
    <svg class="synSvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
      ${poeLines}
      ${uplinkLines}
      ${hdmiLine}
      ${nvrToWan}
    </svg>
  `;

  // -----------------------------
  // 8) Cards HTML (position en %)
  // -----------------------------
  const card = ({ x, y, w, h, barColor, title, line1, line2, imgSrc }) => {
    const left = x - 24;
    const top = y - 18;
    const hasImg = !!String(imgSrc || "").trim();

    return `
      <div class="synCard" style="left:${pctX(left)}; top:${pctY(top)}; width:${pctW(w)}; height:${pctH(h)};">
        ${barColor ? `<div class="synBar" style="background:${barColor}"></div>` : ``}
        <div class="synInner">
          <div class="synIcon">
            ${
              hasImg
                ? `<img class="synImg" src="${imgSrc}" alt="">`
                : `<div class="synImgPh"></div>`
            }
          </div>
          <div class="synTxt">
            <div class="synT">${safe(title)}</div>
            ${line1 ? `<div class="synL1">${safe(line1)}</div>` : ``}
            ${line2 ? `<div class="synL2">${safe(line2)}</div>` : ``}
          </div>
        </div>
      </div>
    `;
  };

  const camCards = camNodes
    .map((c) => {
      const refLine =
        c.refs && c.refs.length > 1 ? `${c.refs[0]} + …` : c.refs?.[0] || c.primaryRef || "—";
      return card({
        x: c.x,
        y: c.y,
        w: camCardW,
        h: 96,
        barColor: COMELIT_GREEN,
        title: c.label,
        line1: `${refLine} • ${c.qty} cam`,
        line2: "",
        imgSrc: c.img,
      });
    })
    .join("");

  const swCards = swNodes
    .map((sw) => {
      const bucket = alloc.find((a) => a.sw.idx === sw.idx);
      const used = bucket ? Number(bucket.used || 0) : 0;
      return card({
        x: sw.x,
        y: sw.y,
        w: swCardW,
        h: 96,
        barColor: "",
        title: `Switch ${sw.idx}`,
        line1: `${sw.id} • ${used}/${sw.portsCap} ports`,
        line2: "⚡ 230V",
        imgSrc: sw.img,
      });
    })
    .join("");

  const nvrImg = typeof getThumbSrc === "function" ? getThumbSrc("nvrs", nvrId) : "";
  const nvrCardW = 360;
  const nvrCardH = 200;
  const nvrCardX = clamp(Math.round(coreX - nvrCardW / 2), 30, W - 30 - nvrCardW);
  const nvrCardY = Math.round(nvrY);

  const hddImg =
    (hddObj?.image_url || hddObj?.image || "") ||
    (hddId && typeof getThumbSrc === "function" ? getThumbSrc("hdds", hddId) : "");

  const hddLabel = hddId ? `${Math.max(1, hddQty || 1)}× ${hddId}` : "HDD : —";

  const nvrCardHtml = `
    <div class="synCard synNvr" style="left:${pctX(nvrCardX)}; top:${pctY(nvrCardY)}; width:${pctW(nvrCardW)}; height:${pctH(nvrCardH)};">
      <div class="synBar" style="background:${COMELIT_BLUE}"></div>
      <div class="synInner synInnerNvr">
        <div class="synIcon synIconBig">
          ${nvrImg ? `<img class="synImg" src="${nvrImg}" alt="">` : `<div class="synImgPh"></div>`}
        </div>
        <div class="synTxt">
          <div class="synT">NVR</div>
          <div class="synL1">${safe(nvrId)}</div>
          <div class="synL2">${safe(nvrName)}</div>
          <div class="synL2">⚡ 230V</div>

          <div class="synHddMini">
            <div class="synHddIcon">
              ${hddImg ? `<img class="synImgMini" src="${hddImg}" alt="">` : `<div class="synImgPhMini"></div>`}
            </div>
            <div class="synHddTxt">${safe(hddLabel)}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const scrImg =
    (scr && screenId && typeof getThumbSrc === "function" ? getThumbSrc("screens", screenId) : "") ||
    (scr?.image_url || scr?.image || "");

  const screenHtml =
    scrEnabled && screenId
      ? `
        <div class="synCard" style="left:${pctX(screenX)}; top:${pctY(screenY)}; width:${pctW(320)}; height:${pctH(110)};">
          <div class="synInner">
            <div class="synIcon">
              ${scrImg ? `<img class="synImg" src="${scrImg}" alt="">` : `<div class="synImgPh"></div>`}
            </div>
            <div class="synTxt">
              <div class="synT">Écran</div>
              <div class="synL1">${safe(screenId)}</div>
              <div class="synL2">⚡ 230V</div>
            </div>
          </div>
        </div>
      `
      : "";

  const wanHtml = `
    <div class="synCard" style="left:${pctX(wanX0)}; top:${pctY(wanY)}; width:${pctW(wanW)}; height:${pctH(wanH)};">
      <div class="synInner">
        <div class="synTxt" style="padding-left:8px">
          <div class="synT">Accès distant / WAN</div>
          <div class="synL1">Box Internet / Internet / VPN / App</div>
        </div>
      </div>
    </div>
  `;

  const projectNameDisplay = String(MODEL?.project?.name || proj?.projectName || "—");
  const headerHtml = `
    <div class="synHeader">
      <div class="synH1">Synoptique — Installation & câblage</div>
      <div class="synMeta">Projet : ${safe(projectNameDisplay)}</div>
      <div class="synMeta">Débit ~${Number(proj?.totalInMbps ?? 0).toFixed(1)} Mbps • Stockage ~${Number(
        proj?.requiredTB ?? 0
      ).toFixed(1)} To</div>
    </div>
  `;

  const legendHtml = `
    <div class="synLegend">
      <span class="dot" style="background:#dc2626"></span><span>PoE</span>
      <span class="dot" style="background:#6b7280"></span><span>Uplink</span>
      <span class="dot" style="background:#2563eb"></span><span>HDMI</span>
      <span class="sep"></span>
      <span class="hint">PoE max 90m / 250m</span>
    </div>
  `;

  return `
    <div class="synWrap">
      <div class="synCanvas" data-syn-fit="1">
        <div class="synStage" data-density-scale="${densityScale}">

          ${headerHtml}
          ${legendHtml}
          ${cablesSvg}
          ${camCards}
          ${swCards}
          ${screenHtml}
          ${nvrCardHtml}
          ${wanHtml}
        </div>
      </div>

      <style>
        /* Le wrap prend toute la place dispo (piloté par la page landscape) */
        .synWrap{ width:100%; height:100%; border: 1px solid var(--c-line); border-radius:18px; background:#fff; overflow:hidden; }
        .synCanvas{ width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center; }
        .synStage{ position:relative; width:${W}px; height:${H}px; }

        .synSvg{ position:absolute; left:0; top:0; width:100%; height:100%; z-index:1; pointer-events:none; }

        .synHeader{ position:absolute; left:3.6%; top:3.8%; z-index:3; }
        .synH1{ font-family:Arial Black, Arial, sans-serif; font-size:16px; color:${COMELIT_BLUE}; }
        .synMeta{ margin-top:4px; font-size:10px; font-weight:700; color:#475569; }

        .synLegend{
          position:absolute; right:3.2%; top:3.4%; z-index:3;
          display:flex; align-items:center; gap:8px;
          background:#fff; border:1px solid #e5e7eb; border-radius:14px;
          padding:10px 12px; font-size:10px; font-weight:800; color:#475569;
        }
        .synLegend .dot{ width:10px; height:10px; border-radius:999px; display:inline-block; }
        .synLegend .sep{ width:1px; height:16px; background:#e5e7eb; display:inline-block; margin:0 4px; }
        .synLegend .hint{ font-weight:800; }

        .synCard{
          position:absolute; z-index:2;
          background:#fff; border:1px solid #e5e7eb; border-radius:16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          overflow:hidden;
        }
        .synBar{ position:absolute; left:0; top:0; bottom:0; width:8px; }
        .synInner{ display:flex; gap:12px; padding:14px; }
        .synInnerNvr{ padding-left:18px; }

        .synIcon{ width:56px; height:56px; border:1px solid #e5e7eb; border-radius:14px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .synIconBig{ width:78px; height:78px; border-radius:16px; }
        .synImg{ width:100%; height:100%; object-fit:contain; display:block; }
        .synImgPh{ width:100%; height:100%; background:#f8fafc; }
        .synTxt{ min-width:0; }
        .synT{ font-size:12px; font-weight:900; color:${COMELIT_BLUE}; }
        .synL1{ margin-top:4px; font-size:10px; font-weight:800; color:#475569; }
        .synL2{ margin-top:3px; font-size:10px; font-weight:800; color:#b45309; }

        .synNvr{ background:#f8fafc; }
        .synHddMini{
          margin-top:10px; display:flex; align-items:center; gap:10px;
          background:#fff; border:1px solid #e5e7eb; border-radius:14px;
          padding:10px 12px;
        }
        .synHddIcon{ width:32px; height:32px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; overflow:hidden; display:flex; align-items:center; justify-content:center;}
        .synImgMini{ width:100%; height:100%; object-fit:contain; display:block; }
        .synImgPhMini{ width:100%; height:100%; background:#f8fafc; }
        .synHddTxt{ font-size:10px; font-weight:900; color:#475569; }
      </style>
      <script>
(() => {
  try {
    const wrap = document.currentScript?.closest('.synWrap');
    if (!wrap) return;

    const canvas = wrap.querySelector('.synCanvas[data-syn-fit="1"]');
    const stage  = wrap.querySelector('.synStage');
    if (!canvas || !stage) return;

    const W = 1120, H = 720;
    const density = Number(stage.getAttribute('data-density-scale') || '1');

    // Taille dispo (zone synoptique dans la page)
    const cw = canvas.clientWidth || 0;
    const ch = canvas.clientHeight || 0;
    if (cw <= 0 || ch <= 0) return;

    // Fit pur
    let fit = Math.min(cw / W, ch / H);

    // Petit boost pour "remplir" (sans déborder)
    fit *= 1.08;

    // Clamp safe (évite de grossir trop si petits écrans)
    fit = Math.max(0.55, Math.min(1.25, fit));

    // Scale final = fit * pénalité densité
    const finalScale = fit * density;

    stage.style.transformOrigin = '50% 50%';
    stage.style.transform = 'scale(' + finalScale.toFixed(4) + ')';
  } catch(e) {}
</script>

    </div>
  `;
};


    return `
<div id="pdfReportRoot" style="font-family: Arial, sans-serif; color:${COMELIT_BLUE}; background:#ffffff;">
  <style>
    * { box-sizing: border-box; }
    html, body { width:100%; background:#ffffff; }

    :root{
      --c-green: ${COMELIT_GREEN};
      --c-blue:  ${COMELIT_BLUE};
      --c-white: #ffffff;
      --c-muted: #475569;
      --c-line:  #e5e7eb;
      --c-soft:  #f8fafc;
      --c-blue-soft: #eef2f7;
    }

    .pdfPage{
      width: 210mm;
      height: 297mm;  /* ✅ FIXE */
      box-sizing: border-box;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      margin: 0;

      /* ✅ V2: page plus “pleine” */
      padding: 6mm;                 /* au lieu de 18/18/14 */
      background: var(--c-white);

      }

    .pdfPage:last-child{
      page-break-after: auto;
      break-after: auto;
    }
    .pdfPageLandscape{
      width: 297mm;
      height: 210mm;  /* ✅ FIXE */
      padding: 6mm;
      box-sizing: border-box;
      overflow: hidden;
      display:flex;
      flex-direction:column;
    }

    .pdfPageLandscape .landscapeBody{
      flex: 1 1 auto;
      display:flex;
      flex-direction:column;
      min-height: 0;
    }

    /* ✅ synWrap = prend toute la hauteur dispo */
    .pdfPageLandscape .synWrap{
      flex: 1 1 auto;
      height: 100%;
      padding: 0;      /* important : c’est le synWrap interne qui gère le bord */
      border: none;    /* évite double bord si tu en as un ailleurs */
      min-height: 0;
    }


  /* Optionnel : footer plus proche en paysage */
  .pdfPageLandscape .footerLine{
    margin-top: 6px;
  }


    .pdfHeader{
      border-bottom:3px solid var(--c-blue);
      padding-bottom:8px;
      margin-bottom:10px;
    }

    .headerGrid{
      display:grid;
      grid-template-columns: 120px 1fr auto;
      column-gap: 12px;
      align-items:center;
    }
    .brandLogo{
      width:132px;             /* ✅ avant 120 */
      height:auto;
      object-fit:contain;
    }


    .headerTitles{
      min-width:0;
      text-align:center;
      padding:0 8px;
    }

    .mainTitle{
      font-family:"Arial Black", Arial, sans-serif;
      font-size:22px;            /* ✅ + lisible */
      line-height:1.15;
      color:var(--c-blue);
      margin:0;
      white-space:normal;
      overflow:visible;
      text-overflow:clip;
    }

    .metaLine{
      margin-top:4px;
      font-size:11.5px;          /* ✅ avant 10.5 */
      color:var(--c-muted);
      line-height:1.25;
    }

    .scorePill{
      display:inline-flex;
      align-items:center;
      gap:6px;
      border:1px solid var(--c-line);
      border-left:6px solid var(--c-green);
      border-radius:999px;
      background:var(--c-soft);
      padding:6px 10px;
      white-space:nowrap;
      justify-self:end;
    }
    .scoreLabel{
      font-size:10px;
      color:var(--c-muted);
      font-weight:900;
      text-transform:uppercase;
      letter-spacing:0.3px;
    }
    .scoreValue{
      font-family:"Arial Black", Arial, sans-serif;
      font-size:12px;
      color:var(--c-blue);
    }

    .headerSub{
      margin-top:6px;           /* ✅ plus respirant */
      font-size:14px;            /* ✅ avant 12.5 */
      font-weight:900;
      color:var(--c-blue);
    }
    .headerSubWrap{
      margin-top:10px;
      padding-top:10px;
      border-top:1px solid var(--c-line);
    }

    .headerSubLine{
      display:flex;
      align-items:center;
      gap:10px;
    }

    .headerSubDot{
      width:10px;
      height:10px;
      border-radius:999px;
      background:var(--c-green);
      flex:0 0 auto;
    }

    .headerSubText{
      font-size:14px;          /* ✅ plus gros */
      font-weight:900;
      color:var(--c-blue);
      line-height:1.2;
    }

    .projectCard{
      margin-top:10px;
      border:1px solid var(--c-line);
      border-left:10px solid var(--c-green);
      border-radius:16px;
      padding:12px;           /* ✅ moins “gros” */
      background:var(--c-soft);
    }

    .projectLabel{
      font-size:11px;
      color:var(--c-muted);
      font-weight:900;
      text-transform:uppercase;
      letter-spacing:0.3px;
    }
    .projectValue{
      margin-top:10px;
      font-family:"Arial Black", Arial, sans-serif;
      font-size:26px;
      line-height:1.15;
      color:var(--c-blue);
      overflow-wrap:anywhere;
    }
    .projectHint{
      margin-top:10px;
      font-size:11px;
      color:var(--c-muted);
      line-height:1.35;
    }

    .kpiRow{
      display:flex;
      gap:12px;
      margin-top:10px;
    }

    .kpiBox{
      flex:1 1 0;
      border:1px solid var(--c-line);
      border-radius:14px;
      background:var(--c-soft);
      padding:12px;             /* ✅ + de présence */
    }

    .kpiLabel{
      font-size:12px;           /* ✅ avant 11 */
      color:var(--c-muted);
      font-weight:800;
    }

    .kpiValue{
      margin-top:4px;
      font-size:16px;           /* ✅ avant 14 */
      font-weight:900;
      color:var(--c-blue);
    }

    /* ✅ muted un peu plus grand, sinon ça “fait vide” */
    .muted{
      color:var(--c-muted);
      font-size:12px;           /* ✅ avant 11 */
      line-height:1.35;
      overflow-wrap:anywhere;
      word-break:break-word;
    }

    .section{
      margin-top:10px;          /* ✅ avant 7 */
      padding:12px;             /* ✅ avant 8 */
      border:1px solid var(--c-line);
      border-radius:14px;
      background:#fff;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .sectionTitle{
      font-family:"Arial Black", Arial, sans-serif;
      font-size:13.5px;       /* ✅ + grand */
      margin:0 0 8px 0;
      color:var(--c-blue);
    }

    .tbl{
      width:100%;
      border-collapse:collapse;
      font-size:12px;         /* ✅ + lisible */
      table-layout:fixed;
      overflow-wrap:anywhere;
    }

    .tbl th, .tbl td{
      border:1px solid var(--c-line);
      padding:9px 10px;         /* ✅ avant 7/8 */
      vertical-align:top;
    }

    .tbl th{
      background:var(--c-blue-soft);
      text-align:left;
      font-weight:900;
      color:var(--c-blue);
    }

    .colQty{ width:62px; }      /* ✅ avant 54 */
    .colRef{ width:150px; }     /* ✅ avant 130 */
    .colImg{ width:96px; text-align:center; } /* ✅ avant 76 */

      .thumb{
        width:58px;             /* ✅ + grand */
        height:58px;
        object-fit:contain;
        border:1px solid var(--c-line);
        border-radius:10px;
        background:#fff;
        display:inline-block;
      }


    .annexGrid{ display:flex; gap:10px; align-items:stretch; }
    .annexColL{ flex:0 0 40%; }
    .annexColR{ flex:1 1 auto; }

    .tblAnnex{
      width:100%;
      border-collapse:collapse;
      font-size:9.5px;
      overflow-wrap:anywhere;
    }
    .tblAnnex th, .tblAnnex td{
      border:1px solid var(--c-line);
      padding:5px 6px;
      vertical-align:top;
    }
    .tblAnnex th{
      background:var(--c-blue-soft);
      text-align:left;
      font-weight:900;
      color:var(--c-blue);
    }
    .aQty{ width:36px; }
    .aRef{ width:92px; }
    .aNum{ width:70px; text-align:right; }

    .footerLine{
      margin-top:10px;
      text-align:center;
      font-size:10px;
      color:var(--c-muted);
    }

    /* =========================================================
       ✅ ANNEXE 2 — SYNOPTIQUE (LANDSCAPE NATIF)
       ========================================================= */

  .synWrap{
  width: 100%;
  height: 180mm;   /* tu étais à 178mm c'est ok */
  border: 1px solid var(--c-line);
  border-radius: 18px;
  background: #fff;
  overflow: hidden;
  padding: 10mm;   /* ✅ un poil moins, ça agrandit le schéma utile */
}
.synCanvas{
  width: 100%;
  height: 100%;
  display:flex;
  align-items:center;
  justify-content:center;
}
.synCanvas svg{
  width: 100%;
  height: 100%;
  display:block;
}


.synCanvas svg{
  width: 100%;
  height: 100%;
  display:block;
}

  </style>

  <!-- ✅ PAGE 0 : NOM DU PROJET -->
  <div class="pdfPage">
    ${headerHtml("Nom du projet")}

    <div class="projectCard">
      <div class="projectLabel">Quel est le nom de votre projet ?</div>
      <div class="projectValue">${safe(projectNameDisplay)}</div>
      <div class="projectHint">
        Conseil : court et clair (site + zone). Exemple : “École Jules Ferry — Entrée”.
      </div>
    </div>

    <div class="footerLine">Comelit — With you always</div>
  </div>

  <!-- ✅ PAGE 1 -->
  <div class="pdfPage">
    ${headerHtml("Caméras & accessoires caméras")}

    <div class="kpiRow">
      <div class="kpiBox">
        <div class="kpiLabel">Débit total estimé</div>
        <div class="kpiValue">${safe(totalMbps.toFixed(1))} Mbps</div>
        <div class="muted">Basé sur le débit typique du catalogue quand disponible.</div>
      </div>

      <div class="kpiBox">
        <div class="kpiLabel">Stockage requis</div>
        <div class="kpiValue">~${safe(requiredTB.toFixed(1))} To</div>
        <div class="muted">Détail dans l’Annexe 1.</div>
      </div>

      <div class="kpiBox">
        <div class="kpiLabel">Paramètres d’enregistrement</div>
        <div class="kpiValue">${safe(daysRetention)} jours</div>
        <div class="muted">${safe(codec)} • ${safe(ips)} IPS • ${safe(mode)} • Marge ${safe(overheadPct)}%</div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Caméras</div>
      ${table4(camsRows)}
    </div>

    <div class="section">
      <div class="sectionTitle">Accessoires caméras</div>
      ${table4(accRows)}
    </div>

    <div class="footerLine">Comelit — With you always</div>
  </div>

  <!-- ✅ PAGE 2 -->
  <div class="pdfPage">
    ${headerHtml("Équipements & options (NVR / réseau / stockage / compléments)")}

    <div class="section">
      <div class="sectionTitle">Enregistreur (NVR)</div>
      ${table4(nvrRows)}
    </div>

    <div class="section">
      <div class="sectionTitle">Commutateurs PoE</div>
      ${proj?.switches?.required ? table4(swRows) : `<div class="muted">(non obligatoire)</div>`}
    </div>

    <div class="section">
      <div class="sectionTitle">Stockage</div>
      ${table4(hddRows)}
    </div>

    <div class="section">
      <div class="sectionTitle">Produits complémentaires</div>
      ${table4(compRows)}
      ${!signageEnabled ? `<div class="muted" style="margin-top:6px">Panneau de signalisation : (désactivé)</div>` : ``}
    </div>

    <div class="footerLine">Comelit — With you always</div>
  </div>

  <!-- ✅ PAGE 3 -->
  <div class="pdfPage">
    ${headerHtml("Annexe 1 — Dimensionnement du stockage")}

    <div class="annexGrid">
      <div class="annexColL">
        <div class="section">
          <div class="sectionTitle">Hypothèses</div>
          <table class="tblAnnex">
            <thead><tr><th>Paramètre</th><th>Valeur</th></tr></thead>
            <tbody>
              <tr><td>Jours de conservation</td><td>${safe(daysRetention)}</td></tr>
              <tr><td>Heures / jour</td><td>${safe(hoursPerDay)}</td></tr>
              <tr><td>Mode d’enregistrement</td><td>${safe(mode)}</td></tr>
              <tr><td>Codec</td><td>${safe(codec)}</td></tr>
              <tr><td>IPS</td><td>${safe(ips)}</td></tr>
              <tr><td>Marge</td><td>${safe(overheadPct)}%</td></tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <div class="sectionTitle">Formule (présentation)</div>
          <div class="muted">
            To ≈ (Débit total (Mbps) × 3600 × Heures/jour × Jours) ÷ (8 × 1024 × 1024) × (1 + Marge)
          </div>
          <div class="muted" style="margin-top:8px">
            Débit total estimé : <strong>${safe(totalMbps.toFixed(2))} Mbps</strong><br>
            Stockage requis : <strong>~${safe(requiredTB.toFixed(2))} To</strong>
          </div>
        </div>
      </div>

      <div class="annexColR">
        <div class="section">
          <div class="sectionTitle">Débit par caméra (détail)</div>

          ${
            perCamRows
              ? `
                <table class="tblAnnex">
                  <thead>
                    <tr>
                      <th class="aQty">Qté</th>
                      <th class="aRef">Référence</th>
                      <th class="aName">Désignation</th>
                      <th class="aNum">Mbps/cam</th>
                      <th class="aNum">Mbps total</th>
                    </tr>
                  </thead>
                  <tbody>${perCamRows}</tbody>
                </table>
                ${
                  perCamHiddenCount > 0
                    ? `<div class="muted" style="margin-top:6px">… + ${safe(perCamHiddenCount)} ligne(s) supplémentaires non affichées (pour tenir sur 1 page)</div>`
                    : ``
                }
                <div class="muted" style="margin-top:6px">
                  Total débit : <strong>${safe(totalMbps.toFixed(2))} Mbps</strong>
                </div>
              `
              : `<div class="muted">—</div>`
          }

          <div class="muted" style="margin-top:6px">
            Source : catalogue caméras → <em>bitrate_mbps_typical</em> (si vide : estimation).
          </div>
        </div>
      </div>
    </div>

    <div class="footerLine">Comelit — With you always</div>
  </div>

  <!-- ✅ PAGE 4 : SYNOPTIQUE -->
  <div class="pdfPage pdfPageLandscape">
    ${headerHtml("Annexe 2 — Synoptique de l’installation")}
    <div class="landscapeBody">
      ${buildSynopticHtml(proj)}
    </div>
    <div class="footerLine">Comelit — With you always</div>
  </div>

</div>`;
}

function syncResultsUI() {
  const stepId = STEPS[MODEL.stepIndex]?.id;
  const isSummary = (stepId === "summary");

  const isLastStep = MODEL.stepIndex >= (STEPS.length - 1);

  const resultsEmpty = document.getElementById("resultsEmpty");
  const results = document.getElementById("results");

  const gridEl = document.querySelector("#mainGrid") || document.querySelector(".appGrid");
  const resultCard = document.querySelector("#resultCard") || document.querySelector("#resultsCard") || document.querySelector(".resultsCard");

  // ✅ Sur SUMMARY : on veut 1 colonne et ZERO carte résultats (car le résumé est dans l’étape)
  if (isSummary) {
    if (gridEl) gridEl.classList.add("singleCol");
    if (resultCard) resultCard.classList.add("hiddenCard");
    if (results) results.classList.add("hidden");
    if (resultsEmpty) resultsEmpty.classList.add("hidden");
    return;
  }

  // Hors summary : comportement normal
  // Résultats visibles uniquement sur la dernière étape (si tu gardes cette logique)
  if (!isLastStep && MODEL.ui.resultsShown) MODEL.ui.resultsShown = false;

  if (resultsEmpty) resultsEmpty.classList.toggle("hidden", isLastStep);
  if (results) results.classList.toggle("hidden", !isLastStep);

  const showCol = isLastStep && MODEL.ui.resultsShown && stepId !== "summary";
  if (stepId === "summary") {
  DOM.mainGrid?.classList.add("singleCol");
  DOM.resultsCard?.classList.add("hiddenCard");
}


  if (gridEl) gridEl.classList.toggle("singleCol", !showCol);
  if (resultCard) resultCard.classList.toggle("hiddenCard", !isLastStep);
}





function updateNavButtons() {
  const stepId = STEPS[MODEL.stepIndex]?.id;

  const btnPrev = document.getElementById("btnPrev");
if (btnPrev) {
  if (MODEL.stepIndex > 0) {
    btnPrev.style.display = "inline-flex";
    btnPrev.disabled = false;
  } else {
    btnPrev.style.display = "none";
  }
}
  if (!DOM.btnCompute) return;

  if (stepId === "summary") {
    DOM.btnCompute.disabled = true;
    DOM.btnCompute.textContent = "Terminé";
    return;
  }

  if (stepId === "project") {
  const isProjectComplete = MODEL.projectName?.trim() && MODEL.projectUseCase?.trim();
  if (!isProjectComplete) {
    btnCompute.disabled = true;
    btnCompute.title = "Remplissez le nom et le type de site";
  }
}
  DOM.btnCompute.disabled = false;

  // Optionnel: libellés contextuels
  if (stepId === "storage") DOM.btnCompute.textContent = "Finaliser & Voir le résumé";
  else DOM.btnCompute.textContent = "Suivant";
}




  // ==========================================================
  // 10) UI - STEPS RENDER
  // ==========================================================
    function updateProgress() {
    const pct = Math.round(((MODEL.stepIndex + 1) / STEPS.length) * 100);
    if (DOM.progressBar) DOM.progressBar.style.width = `${pct}%`;
    if (DOM.progressText) DOM.progressText.textContent = `Étape ${MODEL.stepIndex + 1}/${STEPS.length} • ${pct}%`;
  }


  function canRecommendBlock(blk) {
      const ans = blk?.answers || {};
      const d = toNum(ans.distance_m);
      // ✅ CORRIGÉ : ne vérifie plus use_case
      return !!ans.emplacement && !!ans.objective && Number.isFinite(d) && d > 0;
    }

  function buildRecoForBlock(blk) {
    if (!canRecommendBlock(blk)) return null;
    const ans = blk.answers;
    return recommendCameraForAnswers({
      use_case: ans.use_case || MODEL.projectUseCase || "",  // ✅ CORRIGÉ : fallback
      emplacement: ans.emplacement,
      objective: ans.objective,
      distance_m: toNum(ans.distance_m),
    });
  }

  function doriBadgesHTML(cam) {
    const d = cam.dori_detection_m ?? 0;
    const o = cam.dori_observation_m ?? 0;
    const r = cam.dori_recognition_m ?? 0;
    const i = cam.dori_identification_m ?? 0;

    return `
      <div class="badgeRow">
        ${badgeHtml(`Détection: ${d} m`)}
        ${badgeHtml(`Observation: ${o} m`)}
        ${badgeHtml(`Reconnaissance: ${r} m`)}
        ${badgeHtml(`Identification: ${i} m`)}
      </div>
    `;
  }
  function renderBadgesWithMore(badgesHtmlArr, maxVisible = 8) {
  const arr = (badgesHtmlArr || []).filter(Boolean);
  if (arr.length <= maxVisible) {
    return `<div class="badgeRow">${arr.join("")}</div>`;
  }
  const visible = arr.slice(0, maxVisible).join("");
  const hidden = arr.slice(maxVisible).join("");
  const more = arr.length - maxVisible;

  return `
    <div class="badgeRow badgeRowClamp">${visible}</div>
    <details class="pickDetails">
      <summary class="pickDetailsSum">+${more} caractéristiques</summary>
      <div class="pickDetailsBody">
        <div class="badgeRow">${hidden}</div>
      </div>
    </details>
  `;
}

function camPickCardHTML(blk, cam, label) {
  if (!cam) return "";
  
  const isValidated = blk.validated && blk.selectedCameraId === cam.id;
  const interp = interpretScoreForBlock(blk, cam);
  
  // Config niveau
  const levelConfig = {
    ok:   { icon: "✅", label: "Recommandée", color: "#00BC70", bg: "rgba(0,188,112,.1)" },
    warn: { icon: "⚠️", label: "Acceptable", color: "#F59E0B", bg: "rgba(245,158,11,.1)" },
    bad:  { icon: "❌", label: "Non adaptée", color: "#DC2626", bg: "rgba(220,38,38,.1)" }
  };
  const lvl = levelConfig[interp.level] || levelConfig.warn;

  // Specs principales
  const mp = cam.resolution_mp || cam.megapixels || "—";
  const ir = cam.ir_range_m || "—";
  const ip = cam.ip ? `IP${cam.ip}` : "";
  const ik = cam.ik ? `IK${cam.ik}` : "";
  const hasAI = cam.ai_features || cam.analytics_level;

  // Message court et clair
  const shortMessage = interp.level === "ok" 
    ? "Répond parfaitement à vos critères"
    : interp.level === "warn"
    ? "Convient avec quelques limites"
    : "Ne correspond pas aux critères";

  return `
    <div class="cameraPickCard lvl-${safeHtml(interp.level)}" style="border-left:4px solid ${lvl.color}">
      <div class="cameraPickTop">
        ${cam.image_url 
          ? `<img class="cameraPickImg" src="${cam.image_url}" alt="${safeHtml(cam.name)}" loading="lazy">`
          : `<div class="cameraPickImg" style="display:flex;align-items:center;justify-content:center;background:var(--panel2);color:var(--muted);font-size:24px">📷</div>`
        }
      
        <div class="cameraPickMeta">
          <!-- Header avec nom et score -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div style="min-width:0;flex:1">
              <div class="cameraPickTitle" style="font-size:14px;font-weight:900;color:var(--cosmos)">${safeHtml(cam.id)}</div>
              <div class="cameraPickName" style="font-size:12px;color:var(--muted);margin-top:2px">${safeHtml(cam.name || "")}</div>
            </div>
            <div style="min-width:55px;padding:8px 10px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);text-align:center">
              <div style="font-size:16px;font-weight:900;color:var(--cosmos)">${interp.score ?? "—"}</div>
              <div style="font-size:10px;color:var(--muted)">/100</div>
            </div>
          </div>

          <!-- Verdict clair -->
          <div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:${lvl.bg};border:1px solid ${lvl.color}30">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:16px">${lvl.icon}</span>
              <span style="font-weight:900;color:${lvl.color}">${lvl.label}</span>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${shortMessage}</div>
          </div>

          <!-- Specs clés en badges -->
          <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
            <span class="badgePill" style="font-weight:900">${mp} MP</span>
            <span class="badgePill">IR ${ir}m</span>
            ${ip ? `<span class="badgePill">${ip}</span>` : ""}
            ${ik ? `<span class="badgePill">${ik}</span>` : ""}
            ${hasAI ? `<span class="badgePill" style="background:rgba(0,188,112,.1);border-color:rgba(0,188,112,.3)">🤖 IA</span>` : ""}
            ${isValidated ? `<span class="badgePill" style="background:rgba(0,188,112,.15);border-color:rgba(0,188,112,.4);color:#065f46">✓ Sélectionnée</span>` : ""}
          </div>

          <!-- Actions -->
          <div class="cameraPickActions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button
              data-action="validateCamera"
              data-camid="${safeHtml(cam.id)}"
              class="btnPrimary"
              style="flex:1;min-width:140px"
            >
              ${isValidated 
                ? "✓ Caméra sélectionnée" 
                : interp.level === "ok" 
                  ? "Choisir cette caméra" 
                  : "Sélectionner quand même"
              }
            </button>

            ${cam.datasheet_url ? `
              <a class="btnGhost btnDatasheet" href="${cam.datasheet_url}" target="_blank" rel="noreferrer" style="text-decoration:none">
                📄 Fiche
              </a>
            ` : ""}
          </div>

          <!-- Détails (accordéon) -->
          <details style="margin-top:10px">
            <summary style="cursor:pointer;font-size:12px;font-weight:900;color:var(--muted);padding:6px 0">
              + Voir les détails techniques
            </summary>
            <div style="padding:10px;margin-top:6px;background:var(--panel2);border-radius:10px;font-size:12px">
              ${interp.message ? `<div style="margin-bottom:8px">${safeHtml(interp.message)}</div>` : ""}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;color:var(--muted)">
                <div>• Gamme: ${safeHtml(cam.brand_range || "—")}</div>
                <div>• Focale: ${cam.focal_min_mm || "—"}${cam.focal_max_mm ? `-${cam.focal_max_mm}` : ""}mm</div>
                <div>• Low light: ${cam.low_light ? "Oui" : "Non"}</div>
                <div>• PoE: ${cam.poe_w || "—"}W</div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  `;
}

  function renderStepCameras() {
    const risk = computeRiskCounters();
    if (!Array.isArray(MODEL.cameraBlocks) || !MODEL.cameraBlocks.length) {
      MODEL.cameraBlocks = [createEmptyCameraBlock()];
    }
    if (!MODEL.ui.activeBlockId) MODEL.ui.activeBlockId = MODEL.cameraBlocks[0].id;

    const useCases = getAllUseCases();
    const activeBlock =
      MODEL.cameraBlocks.find((b) => b.id === MODEL.ui.activeBlockId) || MODEL.cameraBlocks[0];
    MODEL.ui.activeBlockId = activeBlock.id;

    const totals = computeTotals();
    const totalCams = getTotalCameras();
    const validatedCount = MODEL.cameraBlocks.filter((b) => b.validated).length;

    const leftBlocks = MODEL.cameraBlocks
      .map((blk, idx) => {
        const ans = blk.answers || {};
        const isActive = blk.id === MODEL.ui.activeBlockId;

        return `
        <div class="recoCard cameraBlockCard" data-action="setActiveBlock" data-bid="${safeHtml(blk.id)}"
             style="padding:12px;cursor:pointer;${isActive ? "outline:1px solid rgba(0,150,255,.35)" : ""}">
          <div class="recoHeader">
            <div>
              <div class="recoName">
                Bloc caméra ${idx + 1}
                ${blk.label ? `• ${safeHtml(blk.label)}` : ""}
                • ${blk.validated ? "✅ Validé" : "⏳ En cours"}
                ${isActive ? `<span style="margin-left:8px" class="badgePill">Actif</span>` : ""}
              </div>
              <div class="muted">Remplis ici → puis choisis/valides la caméra à droite</div>
            </div>
            <div class="score">${blk.qty || 1}x</div>
          </div>

                    <div style="margin-top:10px">
            <strong>Nom du bloc (zone)</strong>
            <input
              data-action="inputBlockLabel"
              data-bid="${safeHtml(blk.id)}"
              type="text"
              maxlength="60"
              value="${safeHtml(blk.label ?? "")}"
              placeholder="ex: Parking entrée, Couloir RDC…"
              style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)"
            />
          </div>

          <div class="kv" style="margin-top:12px">
            <div>
              <strong>Emplacement <span style="color:#DC2626">*</span></strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="emplacement"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid ${ans.emplacement ? 'var(--line)' : 'rgba(220,38,38,.4)'};background:var(--panel2);color:var(--text)">
                <option value="">— choisir —</option>
                <option value="interieur" ${normalizeEmplacement(ans.emplacement) === "interieur" ? "selected" : ""}>Intérieur</option>
                <option value="exterieur" ${normalizeEmplacement(ans.emplacement) === "exterieur" ? "selected" : ""}>Extérieur</option>
              </select>
            </div>

            <div>
              <strong>Objectif <span style="color:#DC2626">*</span></strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="objective"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid ${ans.objective ? 'var(--line)' : 'rgba(220,38,38,.4)'};background:var(--panel2);color:var(--text)">
                <option value="">— choisir —</option>
                <option value="dissuasion" ${ans.objective === "dissuasion" ? "selected" : ""}>Dissuasion</option>
                <option value="detection" ${ans.objective === "detection" ? "selected" : ""}>Détection</option>
                <option value="identification" ${ans.objective === "identification" ? "selected" : ""}>Identification</option>
              </select>
            </div>

            <div>
              <strong>Distance max (m) <span style="color:#DC2626">*</span></strong>
              <input data-action="inputBlockField" data-bid="${safeHtml(blk.id)}" data-field="distance_m" type="number" min="1" max="999"
                value="${safeHtml(ans.distance_m ?? "")}" placeholder="ex: 23"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid ${ans.distance_m ? 'var(--line)' : 'rgba(220,38,38,.4)'};background:var(--panel2);color:var(--text)" />
              <div class="muted" style="margin-top:6px">
                DORI : ${safeHtml(ans.objective ? objectiveLabel(ans.objective) : "—")}
              </div>
            </div>

            <div>
              <strong>Type de pose</strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="mounting"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
                <option value="wall" ${ans.mounting === "wall" ? "selected" : ""}>Mur</option>
                <option value="ceiling" ${ans.mounting === "ceiling" ? "selected" : ""}>Plafond</option>
              </select>
            </div>

            <div>
              <strong>Quantité</strong>
              <input data-action="inputBlockQty" data-bid="${safeHtml(blk.id)}" type="number" min="1" max="999"
                value="${safeHtml(blk.qty ?? 1)}"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)" />
            </div>

            <div>
              <strong>Qualité</strong>
              <select data-action="changeBlockQuality" data-bid="${safeHtml(blk.id)}"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
                <option value="low" ${blk.quality === "low" ? "selected" : ""}>Low (éco)</option>
                <option value="standard" ${(!blk.quality || blk.quality === "standard") ? "selected" : ""}>Standard</option>
                <option value="high" ${blk.quality === "high" ? "selected" : ""}>High (détails)</option>
              </select>
            </div>
          </div>

          <div class="reasons" style="margin-top:12px">
            ${
              canRecommendBlock(blk)
                ? `✅ Critères OK → recommandations disponibles à droite.`
                : `⚠️ Remplis les champs obligatoires (<span style="color:#DC2626">*</span>) pour voir les propositions.`
            }
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            ${blk.validated ? `<button data-action="unvalidateBlock" data-bid="${safeHtml(blk.id)}" class="btnGhost" type="button">Annuler validation</button>` : ``}
            <button data-action="removeBlock" data-bid="${safeHtml(blk.id)}" class="btnGhost" type="button">Supprimer bloc</button>
          </div>
        </div>
      `;
      })
      .join("");

    const reco = buildRecoForBlock(activeBlock);
    const ansA = activeBlock.answers || {};

    let rightHtml = `
      <div class="recoCard" style="padding:12px">
        <div class="proposalsTitle">
          <div>
            <div class="recoName">Propositions caméra</div>
            <div class="muted">
              Bloc actif :
              <strong>${safeHtml(ansA.use_case || "—")}</strong> •
              ${safeHtml(normalizeEmplacement(ansA.emplacement) || "—")} •
              ${safeHtml(ansA.objective || "—")} •
              ${safeHtml(ansA.distance_m || "—")}m
            </div>
          </div>
          <div class="score">🎯</div>
        </div>
      </div>
    `;

    if (!canRecommendBlock(activeBlock)) {
      rightHtml += `<div class="recoCard" style="padding:12px"><div class="muted">⚠️ Remplis les champs obligatoires (<span style="color:#DC2626">*</span>) : <strong>Emplacement</strong>, <strong>Objectif</strong> et <strong>Distance</strong> pour voir les propositions.</div></div>`;
    } else {
      const primary = reco?.primary?.camera || null;
      const alternatives = (reco?.alternatives || []).map((x) => x.camera).filter(Boolean);

      if (!primary) {
        rightHtml += `
          <div class="recoCard" style="padding:12px">
            <div class="reasons">
              <strong>Aucune caméra compatible</strong><br>
              ${(reco?.reasons || []).map((r) => `• ${safeHtml(r)}`).join("<br>")}
            </div>
          </div>
        `;
} else {
  // ---- Liste candidates (tri + filtre) ----
  const favSet = new Set((MODEL.ui.favorites || []).map(String));
  const mode = MODEL.ui.mode === "expert" ? "expert" : "simple";

  const items = [primary, ...alternatives].filter(Boolean).map((cam) => {
    const interp = interpretScoreForBlock(activeBlock, cam);
    const lvlRank = interp.level === "ok" ? 0 : interp.level === "warn" ? 1 : 2;
    const ratioRank = (interp.ratio != null && Number.isFinite(interp.ratio)) ? interp.ratio : -999;
    const isFav = favSet.has(String(cam.id));
    return { cam, interp, lvlRank, ratioRank, isFav };
  });

  // Filtre favoris (optionnel)
  const filtered = MODEL.ui.onlyFavs ? items.filter(x => x.isFav) : items;

  // Tri: favoris > niveau (ok/warn/bad) > score > ratio
  filtered.sort((a, b) => {
    if (a.isFav !== b.isFav) return a.isFav ? -1 : 1;
    if (a.lvlRank !== b.lvlRank) return a.lvlRank - b.lvlRank;
    if ((b.interp.score || 0) !== (a.interp.score || 0)) return (b.interp.score || 0) - (a.interp.score || 0);
    return (b.ratioRank || 0) - (a.ratioRank || 0);
  });

  // Simple = Top 3, Expert = tout
  let shown = filtered;
  if (mode === "simple") {
    shown = filtered.slice(0, 3);
    // garantit que la "primary" reste visible si elle est filtrée par tri (hors mode favoris)
    if (!MODEL.ui.onlyFavs) {
      const hasPrimary = shown.some(x => String(x.cam.id) === String(primary.id));
      if (!hasPrimary) {
        shown = [items.find(x => String(x.cam.id) === String(primary.id))].filter(Boolean).concat(shown.slice(0, 2));
      }
    }
  }

  // Compare panel
  const cmp = Array.isArray(MODEL.ui.compare) ? MODEL.ui.compare.map(String) : [];
  const cmpA = cmp[0] ? getCameraById(cmp[0]) : null;
  const cmpB = cmp[1] ? getCameraById(cmp[1]) : null;

  const compareHtml = (cmpA && cmpB) ? `
    <div class="compareCard">
      <div class="compareHead">
        <div>
          <div class="compareTitle">Comparatif rapide</div>
          <div class="muted">Deux caméras sélectionnées • compare les points clés en 10 secondes.</div>
        </div>
        <button class="btnGhost btnSmall" data-action="uiClearCompare" type="button">Vider</button>
      </div>
      <div class="compareGrid">
        <div class="compareCol">
          <div class="compareName">${safeHtml(cmpA.id)} — ${safeHtml(cmpA.name)}</div>
          <div class="muted">${safeHtml(cmpA.brand_range || "")}</div>
        </div>
        <div class="compareCol">
          <div class="compareName">${safeHtml(cmpB.id)} — ${safeHtml(cmpB.name)}</div>
          <div class="muted">${safeHtml(cmpB.brand_range || "")}</div>
        </div>

        <div class="compareRowK">MP</div>
        <div class="compareRowV">${safeHtml(String(getMpFromCam(cmpA) ?? "—"))}</div>
        <div class="compareRowV">${safeHtml(String(getMpFromCam(cmpB) ?? "—"))}</div>

        <div class="compareRowK">IR</div>
        <div class="compareRowV">${safeHtml(String(getIrFromCam(cmpA) ?? "—"))} m</div>
        <div class="compareRowV">${safeHtml(String(getIrFromCam(cmpB) ?? "—"))} m</div>

        <div class="compareRowK">DORI (ID)</div>
        <div class="compareRowV">${safeHtml(String(cmpA.dori_identification_m ?? "—"))} m</div>
        <div class="compareRowV">${safeHtml(String(cmpB.dori_identification_m ?? "—"))} m</div>

        <div class="compareRowK">Analytics</div>
        <div class="compareRowV">${safeHtml(String(cmpA.analytics_level || "—"))}</div>
        <div class="compareRowV">${safeHtml(String(cmpB.analytics_level || "—"))}</div>
      </div>
    </div>
  ` : "";

// Toolbar 2.0 — Simple / Détails (Détails = mode "expert" interne)
const toolbarHtml = "";


const cardsHtml = shown.length
  ? `
    <div class="cameraCards">
      ${shown
        .map((x) =>
          camPickCardHTML(
            activeBlock,
            x.cam,
            (String(x.cam.id) === String(primary.id) ? "Meilleur choix" : "Alternative")
          )
        )
        .join("")}
    </div>
  `
  : `
    <div class="recoCard" style="padding:12px">
      <div class="muted">
        ${
          MODEL.ui.onlyFavs
            ? "Aucune caméra dans tes favoris pour ce bloc. Désactive le filtre ⭐ pour revoir toutes les propositions."
            : "Aucune caméra à afficher."
        }
      </div>
    </div>
  `;

// ✅ Ajout final (ordre voulu)
rightHtml += toolbarHtml + compareHtml + cardsHtml;
}
    }

    return `
      <div class="stepSplit">
        <div class="blocksCol">
          ${leftBlocks}

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
            <button data-action="addBlock" class="btnGhost" type="button">+ Ajouter un autre modèle de caméra</button>
          </div>

          <div class="reasons" style="margin-top:12px">
            <strong>Résumé (panier validé) :</strong><br>
            • Blocs validés : ${validatedCount} / ${MODEL.cameraBlocks.length}<br>
            • Total caméras : ${totalCams}<br>
            • Débit total estimé : ${totals.totalInMbps.toFixed(1)} Mbps<br>
            • PoE total (approx.) : ${totals.totalPoeW.toFixed(0)} W
          </div>
        </div>

        <div class="proposalsCol">
          ${rightHtml}
        </div>
      </div>
    `;
  }

  function renderStepProject() {
  const val = MODEL.projectName || "";
  const useCase = MODEL.projectUseCase || "";
  const useCases = getAllUseCases();

  // Vérifie si les champs sont remplis
  const isComplete = val.trim().length > 0 && useCase.trim().length > 0;

  return `
    <div class="stepSplit">
      <div class="blocksCol">
        <div class="recoCard" style="padding:14px">
          <div class="recoHeader">
            <div>
              <div class="recoName">Informations projet</div>
              <div class="muted">Ces informations apparaîtront sur le PDF et guideront les recommandations.</div>
            </div>
            <div class="score">📝</div>
          </div>

          <!-- Nom du projet -->
          <div style="margin-top:14px">
            <strong>Nom du projet <span style="color:#DC2626">*</span></strong>
            <input
              data-action="projName"
              type="text"
              maxlength="80"
              value="${safeHtml(val)}"
              placeholder="Ex : Copro Victor Hugo — Parking"
              style="width:100%;margin-top:6px;padding:10px;border-radius:12px;border:1px solid ${val.trim() ? 'var(--line)' : 'rgba(220,38,38,.5)'};background:var(--panel2);color:var(--text)"
            />
            <div class="muted" style="margin-top:6px">
              Conseil : site + zone (court et clair). Exemple : "École Jules Ferry — Entrée".
            </div>
          </div>

          <!-- Use Case global -->
          <div style="margin-top:14px">
            <strong>Type de site <span style="color:#DC2626">*</span></strong>
            <select
              data-action="projUseCase"
              style="width:100%;margin-top:6px;padding:10px;border-radius:12px;border:1px solid ${useCase.trim() ? 'var(--line)' : 'rgba(220,38,38,.5)'};background:var(--panel2);color:var(--text)"
            >
              <option value="">— Sélectionner le type de site —</option>
              ${useCases.map(u => `<option value="${safeHtml(u)}" ${useCase === u ? "selected" : ""}>${safeHtml(u)}</option>`).join("")}
            </select>
            <div class="muted" style="margin-top:6px">
              Ce choix pré-filtrera les caméras adaptées à votre environnement.
            </div>
          </div>

          ${!isComplete ? `
            <div class="alert warn" style="margin-top:14px">
              ⚠️ Veuillez remplir tous les champs obligatoires (*) pour continuer.
            </div>
          ` : `
            <div class="alert ok" style="margin-top:14px">
              ✅ Informations complètes. Vous pouvez passer à l'étape suivante.
            </div>
          `}
        </div>
      </div>

      <div class="proposalsCol">
        <div class="recoCard" style="padding:14px">
          <div class="recoName">Aperçu</div>
          <div class="muted" style="margin-top:6px">
            Le PDF commencera par une page "Informations projet" avec :<br>
            • Nom du projet<br>
            • Type de site<br>
            • Date de génération<br>
            • Score projet
          </div>
        </div>

        <div class="recoCard" style="padding:14px;margin-top:10px">
          <div class="recoName">Pourquoi le type de site ?</div>
          <div class="muted" style="margin-top:6px">
            Le type de site permet de :<br>
            • Filtrer les caméras adaptées<br>
            • Pré-configurer les paramètres<br>
            • Optimiser les recommandations
          </div>
        </div>
      </div>
    </div>
  `;
}

  function renderStepAccessories() {
    const validatedBlocks = (MODEL.cameraBlocks || []).filter((b) => b.validated);

    if (!validatedBlocks.length) {
      return `
        <div class="reasons" style="margin-top:10px">Proposition automatique <strong>par bloc caméra</strong> (caméra validée + emplacement + pose). Tu peux ajuster.</div>
        <div class="muted" style="margin-top:12px">Aucun bloc validé. Retourne à l’étape 1 et valide au moins un bloc caméra.</div>
      `;
    }

    const blocksHtml = validatedBlocks
      .map((blk) => {
        const camLine = MODEL.cameraLines.find((cl) => cl.fromBlockId === blk.id);
        const cam = camLine ? getCameraById(camLine.cameraId) : null;
        const lines = blk.accessories || [];
        const emplLabel = normalizeEmplacement(blk.answers.emplacement) === "exterieur" ? "Extérieur" : "Intérieur";

        const linesHtml = lines.length
          ? lines
              .map(
                (acc, li) => `
            <div class="reasons" style="padding:10px;border:1px solid var(--line);border-radius:12px">
              <div style="display:flex;gap:10px;align-items:flex-start">
                <div style="flex:1">
                  <strong>${safeHtml(acc.name || acc.accessoryId)}</strong>
                  <div class="muted">${safeHtml(accessoryTypeLabel(acc.type))}</div>

                  ${acc.datasheet_url ? `<div style="margin-top:6px"><a href="${acc.datasheet_url}" target="_blank" rel="noreferrer">📄 Fiche technique</a></div>` : ""}

                  <div style="margin-top:10px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
                    <div>
                      <strong>Quantité</strong><br>
                      <input data-action="accQty" data-bid="${safeHtml(blk.id)}" data-li="${li}"
                        type="number" min="1" max="999" value="${acc.qty}"
                        style="width:160px;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)" />
                    </div>

                    <button data-action="accDelete" data-bid="${safeHtml(blk.id)}" data-li="${li}"
                      style="padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--text);cursor:pointer" type="button">
                      Supprimer
                    </button>
                  </div>
                </div>

                ${acc.image_url ? `<img src="${acc.image_url}" alt="" style="width:100px;height:80px;object-fit:cover;border-radius:12px;border:1px solid var(--line)">` : ""}
              </div>
            </div>
          `
              )
              .join("")
          : `<div class="muted">Aucun accessoire trouvé pour ce bloc (mapping manquant dans accessories.csv ?).</div>`;

        return `
        <div class="recoCard" style="padding:12px">
          <div class="recoHeader">
            <div>
              <div class="recoName">Bloc : ${safeHtml(cam?.name || "Caméra")}</div>
              <div class="muted">
                ${blk.qty || 1}× • Pose: ${safeHtml(mountingLabel(blk.answers.mounting))} • ${safeHtml(emplLabel)} • Use case: ${safeHtml(blk.answers.use_case || "—")}
              </div>
            </div>
            <div class="score">ACC</div>
          </div>

          <div style="margin-top:10px;display:grid;gap:10px">
            ${linesHtml}
          </div>
        </div>
      `;
      })
      .join("");

    return `
      <div class="reasons" style="margin-top:10px">Proposition automatique <strong>par bloc caméra</strong> (caméra validée + emplacement + pose). Tu peux ajuster.</div>

      <button data-action="recalcAccessories" type="button"
        style="margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--text);cursor:pointer">
        Recalculer les accessoires (auto) — par bloc
      </button>

      <div style="margin-top:12px;display:grid;gap:12px">
        ${blocksHtml}
      </div>
    `;
  }

  function renderStepNvrNetwork() {
    const proj = getProjectCached();
    const nvr = proj.nvrPick.nvr;

    const nvrHtml = nvr
      ? `
    <div class="recoCard">
      <div class="recoHeader">
        <div>
          <div class="recoName">${safeHtml(nvr.id)} — ${safeHtml(nvr.name)}</div>
          <div class="muted">NVR • ${nvr.channels} canaux • ${nvr.max_in_mbps} Mbps</div>
        </div>
        <div class="score">NVR</div>
      </div>

      <div class="kv">
        <div><strong>Caméras :</strong> ${proj.totalCameras}</div>
        <div><strong>Débit total :</strong> ${proj.totalInMbps.toFixed(1)} Mbps</div>
        <div><strong>Raison :</strong> ${safeHtml(proj.nvrPick.reason)}</div>
        <div><strong>Baies :</strong> ${nvr.hdd_bays} • <strong>Max/baie :</strong> ${nvr.max_hdd_tb_per_bay} TB</div>
      </div>

      ${
        nvr.image_url
          ? `
        <div class="reasons" style="margin-top:10px">
          <img 
            src="${nvr.image_url}" 
            alt="" 
            style="
              width:100%;
              max-height:240px;
              object-fit:contain;
              display:block;
              margin:auto;
              border-radius:12px;
              border:1px solid var(--line);
              background: rgba(255,255,255,.03);
            "
          >
        </div>
      `
          : ""
      }

      ${
        nvr.datasheet_url
          ? `
        <div class="reasons" style="margin-top:8px">
          <a href="${nvr.datasheet_url}" target="_blank" rel="noreferrer">📄 Fiche technique NVR</a>
        </div>
      `
          : ""
      }
    </div>
  `
      : `
    <div class="recoCard">
      <div class="recoHeader">
        <div>
          <div class="recoName">Enregistreur (NVR)</div>
          <div class="muted">Aucun modèle compatible</div>
        </div>
        <div class="score">NVR</div>
      </div>
      <div class="reasons">Ajoute des NVR dans <code>nvrs.csv</code> (channels, max_in_mbps).</div>
    </div>
  `;

    const sw = proj.switches;

    const switchLineCard = (p) => {
      const item = p.item;
      const ref = item.id || "";
      const name = item.name || ref || "Switch";
      const ports = item.poe_ports ?? 0;
      const budget = item.poe_budget_w ?? null;

      return `
      <div class="reasons" style="padding:10px;border:1px solid var(--line);border-radius:12px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="flex:1">
            <strong>${p.qty} × ${safeHtml(ref ? `${ref} — ${name}` : name)}</strong>
            <div class="muted">
              ${ports} ports PoE
              ${budget != null ? ` • Budget ${budget} W` : ""}
              ${item.uplink_gbps != null ? ` • Uplink ${item.uplink_gbps} Gb` : ""}
            </div>

            ${
              item.datasheet_url
                ? `
              <div style="margin-top:6px">
                <a href="${item.datasheet_url}" target="_blank" rel="noreferrer">📄 Fiche technique switch</a>
              </div>
            `
                : ""
            }
          </div>

          ${
            item.image_url
              ? `
            <img 
              src="${item.image_url}" 
              alt="" 
              style="
                width:110px;
                height:80px;
                object-fit:contain;
                border-radius:12px;
                border:1px solid var(--line);
                background: rgba(255,255,255,.03);
              "
            >
          `
              : ""
          }
        </div>
      </div>
    `;
    };

    const swHtml = !sw.required
      ? `
    <div class="recoCard" style="margin-top:10px">
      <div class="recoHeader">
        <div>
          <div class="recoName">Réseau PoE</div>
          <div class="muted">Switch non obligatoire (&lt; 16 caméras)</div>
        </div>
        <div class="score">PoE</div>
      </div>
      <div class="reasons">Pour ce MVP, on impose des switches PoE à partir de 16 caméras (réserve ${MODEL.recording.reservePortsPct}%).</div>
    </div>
  `
      : `
    <div class="recoCard" style="margin-top:10px">
      <div class="recoHeader">
        <div>
          <div class="recoName">Réseau PoE (switch obligatoire)</div>
          <div class="muted">Ports requis: ${sw.portsNeeded} • Ports proposés: ${sw.totalPorts} • Surplus: ${sw.surplusPorts}</div>
        </div>
        <div class="score">PoE</div>
      </div>

      <div class="reasons" style="margin-top:10px">
        <strong>Plan switches :</strong>
      </div>

      <div style="margin-top:10px;display:grid;gap:10px">
        ${sw.plan.map(switchLineCard).join("")}
      </div>

      <div class="reasons" style="margin-top:12px">
        <strong>Règle :</strong> ports >= caméras + ${MODEL.recording.reservePortsPct}% réserve.
      </div>
    </div>
  `;

    return `${nvrHtml}${swHtml}`;
  }

  function renderStepStorage() {
    const proj = getProjectCached();
    const rec = MODEL.recording;

    const nvr = proj.nvrPick.nvr;
    const disk = proj.disks;
    const hdd = disk?.hddRef || null;
    
    return `
    <div style="margin-top:10px">
      <div class="kv">
        <div>
          <strong>Jours rétention</strong>
          <input data-action="recDays" type="number" min="1" max="365" value="${rec.daysRetention}"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
        </div>
        <div>
          <strong>Heures/jour</strong>
          <input data-action="recHours" type="number" min="1" max="24" value="${rec.hoursPerDay}"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
        </div>
        <div>
          <strong>FPS</strong>
          <select data-action="recFps"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
            ${[10, 12, 15, 20, 25].map((v) => `<option value="${v}" ${rec.fps === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div>
          <strong>Codec</strong>
          <select data-action="recCodec"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
            <option value="h265" ${rec.codec === "h265" ? "selected" : ""}>H.265</option>
            <option value="h264" ${rec.codec === "h264" ? "selected" : ""}>H.264</option>
          </select>
        </div>
        <div>
          <strong>Mode</strong>
          <select data-action="recMode"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
            <option value="continuous" ${rec.mode === "continuous" ? "selected" : ""}>Continu</option>
            <option value="motion" ${rec.mode === "motion" ? "selected" : ""}>Détection (approx.)</option>
          </select>
        </div>
        <div>
          <strong>Marge (%)</strong>
          <input data-action="recOver" type="number" min="0" max="100" value="${rec.overheadPct}"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--text)">
        </div>
      </div>
      <div class="help" style="margin-top:10px">Les calculs se mettent à jour quand tu changes ces paramètres.</div>
    </div>

    <div class="recoCard" style="margin-top:10px">
      <div class="recoHeader">
        <div>
          <div class="recoName">Stockage calculé</div>
          <div class="muted">${proj.totalCameras} caméras • ${proj.totalInMbps.toFixed(1)} Mbps</div>
        </div>
        <div class="score">HDD</div>
      </div>

      <div class="kv">
        <div><strong>Stockage requis :</strong> ~${proj.requiredTB.toFixed(1)} TB</div>
        <div><strong>NVR :</strong> ${nvr ? safeHtml(`${nvr.id} — ${nvr.name}`) : "—"}</div>
      </div>

      ${
        disk
          ? `
        <div class="reasons" style="margin-top:10px">
          <strong>Proposition :</strong><br>
          • ${disk.count} × ${disk.sizeTB} TB (total ${disk.totalTB} TB)<br>
          • Capacité max NVR : ${disk.maxTotalTB} TB
        </div>

        ${
          hdd
            ? `
          <div class="reasons" style="margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:12px">
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="flex:1">
                <strong>${safeHtml(hdd.id)} — ${safeHtml(hdd.name || "")}</strong>
                <div class="muted">${hdd.capacity_tb ?? disk.sizeTB} TB</div>
                ${hdd.datasheet_url ? `<div style="margin-top:6px"><a href="${hdd.datasheet_url}" target="_blank" rel="noreferrer">📄 Fiche technique HDD</a></div>` : ""}
              </div>

              ${
                hdd.image_url
                  ? `
                <img 
                  src="${hdd.image_url}" 
                  alt="" 
                  style="
                    width:110px;
                    height:80px;
                    object-fit:contain;
                    border-radius:12px;
                    border:1px solid var(--line);
                    background: rgba(255,255,255,.03);
                  "
                >
              `
                  : ""
              }
            </div>
          </div>
        `
            : `
          <div class="muted" style="margin-top:10px">
            (Info HDD non trouvée dans hdds.csv pour ${disk.sizeTB} TB)
          </div>
        `
        }
      `
          : `
        <div class="reasons" style="margin-top:10px">Ajoute des disques dans <code>hdds.csv</code> (capacity_tb).</div>
      `
      }
    </div>
  `;
  }

function renderStepSummary() {
  const proj = LAST_PROJECT;

  const exportHtml = `
    <div class="exportRow exportRowSummary">
      <button class="btn primary" id="btnExportPdf">Exporter PDF</button>
      <button class="btn secondary" id="btnExportPdfPack">PDF + Fiches techniques</button>
      <button class="btnGhost" id="btnBackToEdit">Modifier la configuration</button>
    </div>
  `;

  return `
    <div class="step stepSummary">
      <div class="stepTitleRow">
        <div class="stepTitle">Résumé & Export</div>
        <div class="stepBadge">6/6</div>
      </div>

      <div class="stepHelp">
        Ton résumé final est affiché en pleine largeur.
        <br>Tu peux exporter le PDF, ou revenir modifier la config si besoin.
      </div>

      <div class="summaryHint ${proj ? "ok" : "warn"}">
        ${proj
          ? "✅ Configuration finalisée."
          : "⚠️ Aucune configuration finalisée (reviens à l’étape Stockage et clique Finaliser)."}
      </div>

      ${proj ? exportHtml : ""}

      <div class="summaryFullWidth">
        ${proj
          ? renderFinalSummary(proj)
          : `<div class="recoCard" style="padding:12px"><div class="muted">—</div></div>`}
      </div>
    </div>
  `;
}

  // ✅ Compat: ancien nom utilisé par render()
if (typeof renderStepMounts !== "function" && typeof renderStepAccessories === "function") {
  window.renderStepMounts = renderStepAccessories;
}
function bindSummaryButtons() {
  const stepId = STEPS[MODEL.stepIndex]?.id;
  if (stepId !== "summary") return;

  const btnBack = document.getElementById("btnBackToEdit");
  if (btnBack && !btnBack.dataset.bound) {
    btnBack.dataset.bound = "1";
    btnBack.addEventListener("click", () => {
      const storageIdx = STEPS.findIndex(s => s.id === "storage");
      if (storageIdx >= 0) {
        MODEL.stepIndex = storageIdx;
        MODEL.ui.resultsShown = false;
        syncResultsUI();
        render();
      }
    });
  }

  const btnPdf = document.getElementById("btnExportPdf");
  if (btnPdf && !btnPdf.dataset.bound) {
    btnPdf.dataset.bound = "1";
    btnPdf.addEventListener("click", () => {
      if (typeof exportProjectPdfPro === "function") exportProjectPdfPro();
      else alert("Export PDF indisponible.");
    });
  }

  const btnPack = document.getElementById("btnExportPdfPack");
  if (btnPack && !btnPack.dataset.bound) {
    btnPack.dataset.bound = "1";
    btnPack.addEventListener("click", () => {
      if (typeof exportProjectPdfPackPro === "function") exportProjectPdfPackPro();
      else alert("Export pack indisponible.");
    });
  }
}

  // ==========================================================
  // MAIN RENDER (manquait → causait "render is not defined")
  // ==========================================================
function render() {
  if (!Array.isArray(STEPS) || !STEPS.length) return;

  if (!Number.isFinite(MODEL.stepIndex)) MODEL.stepIndex = 0;
  MODEL.stepIndex = Math.max(0, Math.min(MODEL.stepIndex, STEPS.length - 1));

  const stepId = STEPS[MODEL.stepIndex]?.id;

  let html = "";

  if (stepId === "project") {
    html = renderStepProject();
  } else if (stepId === "cameras") {
    html = renderStepCameras();
  } else if (stepId === "mounts") {
    html = renderStepMounts();
  } else if (stepId === "nvr_network") {
    html = renderStepNvrNetwork();
  } else if (stepId === "storage") {
    html = renderStepStorage();
  } else if (stepId === "summary") {
    html = renderStepSummary();
  } else {
  html = `<div class="recoCard" style="padding:12px"><div class="muted">Étape inconnue : ${safeHtml(stepId || "—")}</div></div>`;
  }


  DOM.stepsEl.innerHTML = html;

  // ✅ Important: les boutons "Summary" sont recréés à chaque render()
  bindSummaryButtons();

  syncResultsUI?.();
}

// ==========================================================
// PDF BLOB (PRO) — même rendu que exportProjectPdfPro()
// ==========================================================
async function buildPdfBlobProFromProject(proj) {
  // SÉCURITÉ : si proj est undefined, on le récupère
  if (!proj) {
    proj = (typeof LAST_PROJECT !== "undefined" && LAST_PROJECT)
      ? LAST_PROJECT
      : (typeof computeProject === "function" ? computeProject() : null);
  }
  
  if (!proj) {
    throw new Error("Projet non disponible. Veuillez d'abord compléter la configuration.");
  }

  // 1) Créer le container offscreen
  const host = document.createElement("div");
  host.id = "pdfHost";
  Object.assign(host.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "210mm",
    minHeight: "297mm",
    background: "#ffffff",
    color: "#000",
    zIndex: "-9999",
    opacity: "0.001",
    pointerEvents: "none",
    overflow: "visible",
  });

  // 2) Injecter le HTML
  try {
    host.innerHTML = buildPdfHtml(proj);
  } catch (e) {
    console.error("[PDF] buildPdfHtml failed:", e);
    throw new Error("Impossible de générer le HTML du PDF: " + e.message);
  }
  
  document.body.appendChild(host);
  const root = host.querySelector("#pdfReportRoot") || host;

  // 3) Helpers pour les images
  const blobToDataURL = (blob) =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => resolve("");
      r.readAsDataURL(blob);
    });

  const inlineLocalImage = async (url) => {
    const u = String(url || "").trim();
    if (!u || /^data:/i.test(u)) return u;
    if (/^https?:\/\//i.test(u) && !u.includes(window.location.host)) return null;
    try {
      const res = await fetch(u, { mode: "cors", cache: "force-cache" });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await blobToDataURL(blob);
    } catch {
      return null;
    }
  };

  const inlineAllImages = async () => {
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute("src") || "";
        if (!src || /^data:/i.test(src)) return;
        const dataUrl = await inlineLocalImage(src);
        if (dataUrl) img.setAttribute("src", dataUrl);
      })
    );
  };

  const waitForImages = () => {
    const imgs = Array.from(root.querySelectorAll("img"));
    return Promise.all(
      imgs.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalHeight > 0) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            setTimeout(resolve, 3000);
          })
      )
    );
  };

  // 4) Rendu canvas
  const renderToCanvas = async (element, widthPx, heightPx = null) => {
    if (typeof window.html2canvas !== "function") {
      throw new Error("html2canvas manquant");
    }

    const prevWidth = element.style.width;
    const prevHeight = element.style.height;
    const prevOverflow = element.style.overflow;
    
    element.style.width = `${widthPx}px`;
    if (heightPx) element.style.height = `${heightPx}px`;
    element.style.overflow = "hidden";

    element.offsetHeight;
    await new Promise(r => setTimeout(r, 50));

    const canvas = await window.html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      width: widthPx,
      height: heightPx || element.scrollHeight,
      windowWidth: widthPx,
      windowHeight: heightPx || element.scrollHeight,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
    });

    element.style.width = prevWidth;
    element.style.height = prevHeight;
    element.style.overflow = prevOverflow;

    return canvas;
  };

  // 5) Ajouter canvas au PDF (centré)
  const addCanvasToPdf = (pdf, canvas) => {
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    
    const imgW = canvas.width / 2;
    const imgH = canvas.height / 2;
    
    const ratioW = pageW / imgW;
    const ratioH = pageH / imgH;
    const ratio = Math.min(ratioW, ratioH);
    
    const drawW = imgW * ratio;
    const drawH = imgH * ratio;
    
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    
    pdf.addImage(imgData, "JPEG", x, y, drawW, drawH, undefined, "FAST");
  };

  // 6) Vérifier dépendances
  const JsPDF = window?.jspdf?.jsPDF || window?.jsPDF;
  if (typeof JsPDF !== "function") {
    host.remove();
    throw new Error("jsPDF manquant");
  }
  if (typeof window.html2canvas !== "function") {
    host.remove();
    throw new Error("html2canvas manquant");
  }

  try {
    if (document.fonts?.ready) await document.fonts.ready;

    await inlineAllImages();
    await waitForImages();
    await new Promise(r => setTimeout(r, 100));

    const allPages = Array.from(root.querySelectorAll(".pdfPage"));
    if (!allPages.length) throw new Error("Aucune page .pdfPage trouvée");

    const portraitPages = allPages.filter(p => !p.classList.contains("pdfPageLandscape"));
    const landscapePages = allPages.filter(p => p.classList.contains("pdfPageLandscape"));

    const pdf = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    const A4_W_PX = 794;
    const A4_H_PX = 1123;
    const A4_LAND_W_PX = 1123;
    const A4_LAND_H_PX = 794;

    // Pages portrait
    for (let i = 0; i < portraitPages.length; i++) {
      const page = portraitPages[i];
      page.style.width = "210mm";
      page.style.height = "297mm";
      page.style.boxSizing = "border-box";
      
      await new Promise(r => setTimeout(r, 30));
      const canvas = await renderToCanvas(page, A4_W_PX, A4_H_PX);
      
      if (i > 0) pdf.addPage("a4", "portrait");
      addCanvasToPdf(pdf, canvas);
    }

    // Pages paysage (synoptique)
    for (let i = 0; i < landscapePages.length; i++) {
      const page = landscapePages[i];
      page.style.width = "297mm";
      page.style.height = "210mm";
      page.style.boxSizing = "border-box";
      host.style.width = "297mm";
      
      await new Promise(r => setTimeout(r, 80));
      const canvas = await renderToCanvas(page, A4_LAND_W_PX, A4_LAND_H_PX);
      
      pdf.addPage("a4", "landscape");
      addCanvasToPdf(pdf, canvas);
    }

    return pdf.output("blob");

  } finally {
    host.remove();
  }
}

// Alias
async function buildPdfBlobFromProject(proj) {
  return await buildPdfBlobProFromProject(proj);
}

function renderCameraPickCard(cam, blk, sc, mainReason) {
  if (!cam) return "";

  const interp = interpretScoreForBlock(blk, cam);
  const isValidated = !!(blk?.validated && blk?.selectedCameraId === cam.id);

  // Icône et couleur selon le niveau
  const levelConfig = {
    ok: { icon: "✅", label: "Recommandée", color: "var(--comelit-green)" },
    warn: { icon: "⚠️", label: "Acceptable", color: "#F59E0B" },
    bad: { icon: "❌", label: "Non adaptée", color: "#DC2626" }
  };
  const level = levelConfig[interp.level] || levelConfig.warn;

  // Caractéristiques clés
  const mp = cam.resolution_mp || cam.megapixels || "—";
  const ir = cam.ir_range_m || cam.ir_distance_m || "—";
  const lens = cam.lens_type || cam.varifocal ? "Varifocale" : "Fixe";

  return `
    <div class="cameraPickCard lvl-${safeHtml(interp.level)}" style="border-left:4px solid ${level.color}">
      <div class="cameraPickTop">
        ${cam.image_url 
          ? `<img class="cameraPickImg" src="${cam.image_url}" alt="${safeHtml(cam.name)}">`
          : `<div class="cameraPickImg" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">📷</div>`
        }

        <div class="cameraPickMeta">
          <!-- En-tête avec score -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div>
              <strong class="cameraPickTitle">${safeHtml(cam.id)}</strong>
              <div class="cameraPickName">${safeHtml(cam.name || "")}</div>
            </div>
            <div class="score" style="min-width:60px;font-size:14px">
              ${interp.score ?? "—"}/100
            </div>
          </div>

          <!-- Statut clair -->
          <div style="margin-top:10px;padding:8px 12px;border-radius:10px;background:${level.color}15;border:1px solid ${level.color}40">
            <span style="font-weight:900;color:${level.color}">${level.icon} ${level.label}</span>
            <span class="muted" style="margin-left:8px">${safeHtml(interp.message || mainReason)}</span>
          </div>

          <!-- Caractéristiques principales -->
          <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
            <span class="badgePill">${mp} MP</span>
            <span class="badgePill">IR ${ir}m</span>
            <span class="badgePill">${lens}</span>
            ${cam.ai_features ? `<span class="badgePill ok">IA</span>` : ""}
            ${isValidated ? `<span class="badgePill ok">✅ Sélectionnée</span>` : ""}
          </div>

          <!-- Actions -->
          <div class="cameraPickActions" style="margin-top:12px">
            <button
              data-action="validateCamera"
              data-camid="${safeHtml(cam.id)}"
              class="btnPrimary"
              style="flex:1"
            >
              ${isValidated ? "✓ Caméra validée" : interp.level === "ok" ? "Sélectionner cette caméra" : "Sélectionner quand même"}
            </button>

            ${cam.datasheet_url ? `
              <a class="btnGhost btnDatasheet" href="${cam.datasheet_url}" target="_blank" rel="noreferrer">
                📄 Fiche
              </a>
            ` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}


function onStepsClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  // KPI safe helper (ne casse jamais l'app si KPI absent)
  const kpi = (event, payload = {}) => {
    try {
      const fn = (window.KPI && (KPI.send || KPI.sendNowait)) ? (KPI.send || KPI.sendNowait) : null;
      if (typeof fn === "function") fn(event, payload);
    } catch {}
  };

  if (action === "screenSize") {
    const sz = Number(el.dataset.size);
    if (Number.isFinite(sz)) MODEL.complements.screen.sizeInch = sz;
    render();
    kpi("complements_screen_size", { sizeInch: MODEL.complements.screen.sizeInch });
    return;
  }

  if (action === "addBlock") {
    const nb = createEmptyCameraBlock();
    MODEL.cameraBlocks.push(nb);
    MODEL.ui.activeBlockId = nb.id;
    render();
    kpi("camera_block_add", { blockId: nb.id, blocksCount: MODEL.cameraBlocks.length });
    return;
  }

  if (action === "removeBlock") {
    const bid = el.getAttribute("data-bid");
    const idx = MODEL.cameraBlocks.findIndex((b) => b.id === bid);
    if (idx >= 0) {
      const blk = MODEL.cameraBlocks[idx];
      if (blk.validated) unvalidateBlock(blk);
      MODEL.cameraBlocks.splice(idx, 1);
      sanity();
      render();
      kpi("camera_block_remove", { blockId: bid, blocksCount: MODEL.cameraBlocks.length });
    }
    return;
  }

  if (action === "unvalidateBlock") {
    const bid = el.getAttribute("data-bid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (blk) {
      unvalidateBlock(blk);
      render();
      kpi("camera_block_unvalidate", { blockId: bid });
    }
    return;
  }

  if (action === "validateCamera") {
    const camId = el.getAttribute("data-camid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === MODEL.ui.activeBlockId);
    if (!blk) return;

    const cam = getCameraById(camId);
    if (!cam) return;

    validateBlock(blk, null, cam.id);
    render();

    kpi("camera_add_to_project", {
      blockId: blk.id,
      blockLabel: blk.label || "",
      cameraId: cam.id,
      cameraName: cam.name || "",
      qty: Number(blk.qty || 0) || 0,
    });

    return;
  }

  if (action === "recalcAccessories") {
    suggestAccessories();
    render();
    kpi("accessories_recalc", {});
    return;
  }

  if (action === "accDelete") {
    const bid = el.getAttribute("data-bid");
    const li = parseInt(el.getAttribute("data-li"), 10);
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk || !blk.accessories) return;
    blk.accessories.splice(li, 1);
    rebuildAccessoryLinesFromBlocks();
    render();
    kpi("accessory_remove", { blockId: bid, index: li });
    return;
  }

  if (action === "screenToggle") {
    MODEL.complements.screen.enabled = el.dataset.value === "1";
    render();
    kpi("complements_screen_toggle", { enabled: !!MODEL.complements.screen.enabled });
    return;
  }

  if (action === "enclosureToggle") {
    MODEL.complements.enclosure.enabled = el.dataset.value === "1";
    render();
    kpi("complements_enclosure_toggle", { enabled: !!MODEL.complements.enclosure.enabled });
    return;
  }

  if (action === "signageToggle") {
    MODEL.complements.signage =
      MODEL.complements.signage || { enabled: false, scope: "Public", qty: 1 };
    MODEL.complements.signage.enabled = el.dataset.value === "1";
    render();
    kpi("complements_signage_toggle", { enabled: !!MODEL.complements.signage.enabled });
    return;
  }

if (action === "projUseCase") {
  MODEL.projectUseCase = String(el.value || "").trim();
  
  // Propager aux blocs caméra existants qui n'ont pas de use_case
  (MODEL.cameraBlocks || []).forEach(blk => {
    if (blk.answers && !blk.answers.use_case) {
      blk.answers.use_case = MODEL.projectUseCase;
    }
  });
  
  // Mettre à jour l'UI sans re-render complet
  updateNavButtons();
  
  // Mettre à jour le message de statut
  const isComplete = MODEL.projectName?.trim() && MODEL.projectUseCase?.trim();
  const alertEl = document.querySelector(".stepSplit .alert");
  if (alertEl) {
    if (isComplete) {
      alertEl.className = "alert ok";
      alertEl.style.marginTop = "14px";
      alertEl.innerHTML = "✅ Informations complètes. Vous pouvez passer à l'étape suivante.";
    } else {
      alertEl.className = "alert warn";
      alertEl.style.marginTop = "14px";
      alertEl.innerHTML = "⚠️ Veuillez remplir tous les champs obligatoires (*) pour continuer.";
    }
  }
  
  // Mettre à jour la bordure du select
  el.style.borderColor = MODEL.projectUseCase?.trim() ? "var(--line)" : "rgba(220,38,38,.5)";
  
  return;
}

}


  function onStepsChange(e) {
  // ✅ Toujours viser l’élément qui porte data-action (select/input)
  const el = e.target?.closest?.("[data-action]");
  if (!el) return;

  const action = el.getAttribute("data-action");
  if (!action) return;

  // 1) Champs SELECT des blocs caméra

  if (action === "inputBlockLabel") {
  const bid = el.getAttribute("data-bid");
  const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
  if (!blk) return;

  blk.label = String(el.value ?? "").slice(0, 60);
  MODEL.ui.activeBlockId = bid;
  render(); // ✅ met à jour le titre du bloc
  return;
}
  if (action === "changeBlockField") {
    const bid = el.getAttribute("data-bid");
    const field = el.getAttribute("data-field");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk) return;

    invalidateIfNeeded(blk);
    blk.answers[field] = el.value;
    MODEL.ui.activeBlockId = bid;
    render();
    return;
  }

  if (action === "changeBlockQuality") {
    const bid = el.getAttribute("data-bid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk) return;

    invalidateIfNeeded(blk);
    blk.quality = el.value;
    MODEL.ui.activeBlockId = bid;
    render();
    return;
  }

  // 2) COMMIT des inputs blocs caméra (fin de saisie)
  if (action === "inputBlockQty") {
  const bid = el.getAttribute("data-bid");
  const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
  if (!blk) return;

  invalidateIfNeeded(blk);

  // stock brut pendant saisie (digits uniquement)
  blk.qty = String(el.value ?? "").replace(/[^\d]/g, "");

  MODEL.ui.activeBlockId = bid;
  return; // pas de render pendant frappe
}


  if (action === "inputBlockField") {
    const bid = el.getAttribute("data-bid");
    const field = el.getAttribute("data-field");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk) return;

    invalidateIfNeeded(blk);

    if (field === "distance_m") {
      const v = String(el.value ?? "").trim();
      blk.answers[field] = v ? String(clampInt(v, 1, 999)) : "";
    } else {
      blk.answers[field] = el.value;
    }

    MODEL.ui.activeBlockId = bid;
    render();
    return;
  }

  // 3) Paramètres d’enregistrement (avec KPI)
  const isRecAction = [
    "recDays", "recHours", "recOver", "recReserve", "recFps", "recCodec", "recMode"
  ].includes(action);

  if (isRecAction) {
    MODEL.recording = MODEL.recording || {};

    if (action === "recDays")    MODEL.recording.daysRetention   = clampInt(el.value, 1, 365);
    if (action === "recHours")   MODEL.recording.hoursPerDay     = clampInt(el.value, 1, 24);
    if (action === "recOver")    MODEL.recording.overheadPct     = clampInt(el.value, 0, 100);
    if (action === "recReserve") MODEL.recording.reservePortsPct = clampInt(el.value, 0, 50);
    if (action === "recFps")     MODEL.recording.fps             = clampInt(el.value, 1, 60);
    if (action === "recCodec")   MODEL.recording.codec           = String(el.value || "");
    if (action === "recMode")    MODEL.recording.mode            = String(el.value || "");

    // ✅ KPI : 1 seul event propre (pas à chaque return)
    if (window.KPI?.sendNowait) {
      window.KPI.sendNowait("recording_change", {
        daysRetention: MODEL.recording.daysRetention,
        hoursPerDay: MODEL.recording.hoursPerDay,
        overheadPct: MODEL.recording.overheadPct,
        reservePortsPct: MODEL.recording.reservePortsPct,
        codec: MODEL.recording.codec,
        fps: MODEL.recording.fps,
        mode: MODEL.recording.mode
      });
    } else if (typeof window.kpi === "function") {
      window.kpi("recording_change", {
        daysRetention: MODEL.recording.daysRetention,
        hoursPerDay: MODEL.recording.hoursPerDay,
        overheadPct: MODEL.recording.overheadPct,
        reservePortsPct: MODEL.recording.reservePortsPct,
        codec: MODEL.recording.codec,
        fps: MODEL.recording.fps,
        mode: MODEL.recording.mode
      });
    }

    render();
    return;
  }

  // 4) Accessoires (qty)
  if (action === "accQty") {
    const aid = el.getAttribute("data-aid");
    const qty = clampInt(el.value, 0, 99);
    if (aid) updateAccessoryQty(aid, qty);
    render();
    return;
  }

      if (action === "screenQty") {
    MODEL.complements.screen.qty = clampInt(el.value, 1, 99);
    render();
    return;
  }
  if (action === "enclosureQty") {
    MODEL.complements.enclosure.qty = clampInt(el.value, 1, 99);
    render();
    return;
  }

  if (action === "signageScope") {
    MODEL.complements.signage = MODEL.complements.signage || { enabled: true, scope: "Public", qty: 1 };
    MODEL.complements.signage.scope = el.value || "Public";
    render();
    return;
  }

  if (action === "signageQty") {
    MODEL.complements.signage = MODEL.complements.signage || { enabled: true, scope: "Public", qty: 1 };
    MODEL.complements.signage.qty = clampInt(el.value, 1, 99);
    render();
    return;
  }

  // 6) Compléments (select)
  if (action === "compScreenSelect") {
    MODEL.complements.screen.selectedId = el.value || null;
    render();
    return;
  }
  if (action === "compEnclosureSelect") {
    MODEL.complements.enclosure.selectedId = el.value || null;
    render();
    return;
  }
    if (action === "compScreenQty") {
    MODEL.complements.screen.qty = clampInt(el.value, 1, 99);
    render();
    return;
  }
  if (action === "compEnclosureQty") {
    MODEL.complements.enclosure.qty = clampInt(el.value, 1, 99);
    render();
    return;
  }
}


  function onStepsInput(e) {
  // ✅ Toujours viser l’élément qui porte data-action
  const el = e.target?.closest?.("[data-action]");
  if (!el) return;

  const action = el.getAttribute("data-action");
  if (!action) return;

  // ======================================================
  // 1) Label (nom du bloc) : PAS d'invalidation + pas render
  // ======================================================
  if (action === "inputBlockLabel") {
    const bid = el.getAttribute("data-bid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk) return;

    blk.label = String(el.value ?? "").slice(0, 60);
    MODEL.ui.activeBlockId = bid;
    return; // pas de render pendant frappe
  }

  // ======================================================
  // 2) Champs du bloc caméra (distance / etc.) : invalide + brut
  // ======================================================
  if (action === "inputBlockField") {
  const bid = el.getAttribute("data-bid");
  const field = el.getAttribute("data-field");
  const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
  if (!blk) return;

  const raw = el.value;

  // on invalide si on modifie un bloc déjà validé
  invalidateIfNeeded(blk);

  if (field === "distance_m") {
    blk.answers[field] = String(raw ?? "").replace(/[^\d]/g, "");
  } else {
    blk.answers[field] = raw;
  }

  MODEL.ui.activeBlockId = bid;
  return; // pas de render pendant frappe
}


  // ======================================================
  // 3) Quantité bloc : invalide + brut (digits)
  // ======================================================
  if (action === "inputBlockQty") {
  const bid = el.getAttribute("data-bid");
  const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
  if (!blk) return;

  invalidateIfNeeded(blk);

  // stock brut pendant saisie
  blk.qty = String(el.value ?? "").replace(/[^\d]/g, "");

  MODEL.ui.activeBlockId = bid;
  return; // pas de render pendant frappe
}


  // ======================================================
  // 4) Accessoires : qty live + rebuild
  // ======================================================
  if (action === "accQty") {
    const bid = el.getAttribute("data-bid");
    const li = parseInt(el.getAttribute("data-li"), 10);
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk || !blk.accessories || !blk.accessories[li]) return;

    blk.accessories[li].qty = clampInt(el.value, 1, 999);
    rebuildAccessoryLinesFromBlocks();
    return;
  }

  // ======================================================
  // 5) Paramètres enregistrement : stock brut pendant saisie
  // ======================================================
  if (action === "recDays")    { MODEL.recording.daysRetention   = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
  if (action === "recHours")   { MODEL.recording.hoursPerDay     = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
  if (action === "recOver")    { MODEL.recording.overheadPct     = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
  if (action === "recReserve") { MODEL.recording.reservePortsPct = String(el.value ?? "").replace(/[^\d]/g, ""); return; }

    // 6) Compléments (qty live)
  if (action === "compScreenQty") {
    MODEL.complements.screen.qty = String(el.value ?? "").replace(/[^\d]/g, "");
    return;
  }
  if (action === "compEnclosureQty") {
    MODEL.complements.enclosure.qty = String(el.value ?? "").replace(/[^\d]/g, "");
    return;
  }

  if (action === "projName") {
  // ⚠️ On stocke au fil de l'eau, mais on NE re-render pas l'écran
  // sinon l'input est recréé => perte de focus.
  MODEL.projectName = String(el.value || "").slice(0, 80);
  return;
}


}


// ==========================================================
// EXPORT PDF (PRO) — version robuste + logs
// Remplace intégralement ta fonction exportProjectPdfPro()
// ==========================================================
async function exportProjectPdfPro(proj) {
  if (!proj) {
    proj = (typeof LAST_PROJECT !== "undefined" && LAST_PROJECT)
      ? LAST_PROJECT
      : null;
  }
  
  if (!proj && typeof computeProject === "function") {
    try {
      proj = computeProject();
      if (typeof LAST_PROJECT !== "undefined") {
        LAST_PROJECT = proj;
      }
    } catch (e) {
      console.error("[PDF] computeProject failed:", e);
    }
  }
  
  if (!proj) {
    alert("Projet non disponible. Veuillez d'abord compléter la configuration et cliquer sur 'Suivant' ou 'Finaliser'.");
    return;
  }

  // KPI
  try {
    const payload = typeof kpiConfigSnapshot === "function" ? kpiConfigSnapshot(proj) : {};
    if (typeof KPI !== "undefined" && KPI?.sendNowait) {
      KPI.sendNowait("export_pdf_click", payload);
    }
  } catch {}

  // Vérifier les libs
  if (typeof window.html2canvas !== "function") {
    alert("Export PDF impossible : html2canvas non chargé.");
    return;
  }

  try {
    const blob = await buildPdfBlobProFromProject(proj);
    
    if (!blob || blob.size < 1000) {
      throw new Error("PDF blob invalide");
    }

    const projectSlug = (MODEL?.projectName || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëïîôùûüç]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "projet";
    const filename = `${projectSlug}_${new Date().toISOString().slice(0, 10)}.pdf`;    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    console.log("[PDF] Export OK:", filename);
    
  } catch (e) {
    console.error("[PDF] Export failed:", e);
    alert("Export PDF échoué: " + e.message);
  }
}

// ==========================================================
// EXPORT PACK (PDF + FICHES TECHNIQUES) -> ZIP
// ==========================================================

// Petit helper: download blob
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFilename(name) {
  return String(name || "file")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

// Dédup par URL
function dedupByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const u = String(it?.url || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }
  return out;
}

// Collecte les datasheet_url depuis le projet (tu peux enrichir ensuite)
function collectDatasheetUrlsFromProject(proj) {
  const items = [];

  // Caméras
  for (const l of (MODEL.cameraLines || [])) {
    const cam = getCameraById(l.cameraId);
    if (cam?.datasheet_url) {
      items.push({
        url: cam.datasheet_url,
        path: `fiches_techniques/cameras/${sanitizeFilename(cam.id)}.pdf`,
      });
    }
  }

  // NVR
  const nvr = proj?.nvrPick?.nvr;
  if (nvr?.datasheet_url) {
    items.push({
      url: nvr.datasheet_url,
      path: `fiches_techniques/nvr/${sanitizeFilename(nvr.id)}.pdf`,
    });
  }

  // HDD (selon ton modèle: proj.disks.hddRef ou proj.disks.disk)
  const hdd = proj?.disks?.hddRef || proj?.disks?.disk || null;
  if (hdd?.datasheet_url) {
    items.push({
      url: hdd.datasheet_url,
      path: `fiches_techniques/hdd/${sanitizeFilename(hdd.id)}.pdf`,
    });
  }

  // Switches
  for (const p of (proj?.switches?.plan || [])) {
    const sw = p?.item;
    if (sw?.datasheet_url) {
      items.push({
        url: sw.datasheet_url,
        path: `fiches_techniques/switches/${sanitizeFilename(sw.id)}.pdf`,
      });
    }
  }

  // Accessoires (si tu as datasheet_url dans la ligne)
  for (const a of (MODEL.accessoryLines || [])) {
    if (a?.datasheet_url) {
      const id = a.accessoryId || a.id || "accessoire";
      items.push({
        url: a.datasheet_url,
        path: `fiches_techniques/accessoires/${sanitizeFilename(id)}.pdf`,
      });
    }
  }

  // Produits complémentaires (écran / boîtier / panneau si ton projet les expose)
  try {
    const scr = getSelectedOrRecommendedScreen(proj)?.selected || null;
    if (scr?.datasheet_url) {
      items.push({
        url: scr.datasheet_url,
        path: `fiches_techniques/ecrans/${sanitizeFilename(scr.id)}.pdf`,
      });
    }
  } catch {}

  try {
    const enc = getSelectedOrRecommendedEnclosure(proj)?.selected || null;
    if (enc?.datasheet_url) {
      items.push({
        url: enc.datasheet_url,
        path: `fiches_techniques/boitiers/${sanitizeFilename(enc.id)}.pdf`,
      });
    }
  } catch {}

  try {
    if (typeof getSelectedOrRecommendedSign === "function") {
      const sign = getSelectedOrRecommendedSign()?.sign || null;
      if (sign?.datasheet_url && MODEL?.complements?.signage?.enabled) {
        items.push({
          url: sign.datasheet_url,
          path: `fiches_techniques/panneaux/${sanitizeFilename(sign.id)}.pdf`,
        });
      }
    }
  } catch {}

  return dedupByUrl(items);
}

// Helper pour collecter les IDs produits
function collectProductIdsForPack(proj) {
  const ids = new Set();

  for (const l of (MODEL?.cameraLines || [])) {
    if (l?.cameraId) ids.add(l.cameraId);
  }

  const nvr = proj?.nvrPick?.nvr;
  if (nvr?.id) ids.add(nvr.id);

  const hdd = proj?.disks?.hddRef || proj?.disks?.disk;
  if (hdd?.id) ids.add(hdd.id);

  for (const p of (proj?.switches?.plan || [])) {
    if (p?.item?.id) ids.add(p.item.id);
  }

  for (const a of (MODEL?.accessoryLines || [])) {
    if (a?.accessoryId) ids.add(a.accessoryId);
  }

  try {
    if (typeof getSelectedOrRecommendedScreen === "function") {
      const scr = getSelectedOrRecommendedScreen(proj)?.selected;
      if (scr?.id) ids.add(scr.id);
    }
  } catch {}

  try {
    if (typeof getSelectedOrRecommendedEnclosure === "function") {
      const enc = getSelectedOrRecommendedEnclosure(proj)?.selected;
      if (enc?.id) ids.add(enc.id);
    }
  } catch {}

  try {
    if (typeof getSelectedOrRecommendedSign === "function" && MODEL?.complements?.signage?.enabled) {
      const sign = getSelectedOrRecommendedSign()?.sign;
      if (sign?.id) ids.add(sign.id);
    }
  } catch {}

  return Array.from(ids).filter(Boolean);
}

async function exportProjectPdfWithLocalDatasheetsZip() {
  // Récupérer le projet
  let proj = (typeof LAST_PROJECT !== "undefined" && LAST_PROJECT)
    ? LAST_PROJECT
    : null;
    
  if (!proj && typeof computeProject === "function") {
    try {
      proj = computeProject();
      if (typeof LAST_PROJECT !== "undefined") {
        LAST_PROJECT = proj;
      }
    } catch (e) {
      console.error("[ZIP] computeProject failed:", e);
    }
  }

  if (!proj) {
    alert("Projet non disponible. Complétez d'abord la configuration.");
    return;
  }

  const day = new Date().toISOString().slice(0, 10);

  // Générer le PDF
  let pdfBlob;
  try {
    pdfBlob = await buildPdfBlobProFromProject(proj);
    if (!pdfBlob || pdfBlob.size < 5000) {
      throw new Error("PDF invalide");
    }
  } catch (e) {
    console.error("[ZIP] PDF error:", e);
    alert("Impossible de générer le PDF: " + e.message);
    return;
  }

  // Convertir PDF en base64
  const pdf_base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(pdfBlob);
  });

  // Collecter les IDs produits
  const product_ids = collectProductIdsForPack(proj);

  // ✅ Générer le nom du fichier ZIP basé sur le nom du projet
  const projectSlugZip = (MODEL?.projectName || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Retire les accents
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "projet";

  // ✅ Construire le payload (APRÈS avoir déclaré projectSlugZip)
  const payload = {
    pdf_base64,
    product_ids,
    zip_name: `${projectSlugZip}_${day}.zip`,
  };

  // Endpoints à essayer
  const endpoints = [
    "/export/localzip",
    "http://127.0.0.1:8000/export/localzip",
    "http://localhost:8000/export/localzip",
  ];

  let response = null;
  let lastError = "";

  for (const endpoint of endpoints) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) break;
      lastError = await response.text().catch(() => `HTTP ${response.status}`);
      response = null;
    } catch (e) {
      lastError = e.message;
      response = null;
    }
  }

  if (!response) {
    alert("Export pack indisponible.\nDétail : " + lastError);
    return;
  }

  // Télécharger le ZIP
  try {
    const zipBlob = await response.blob();
    if (!zipBlob || zipBlob.size < 200) {
      throw new Error("ZIP vide");
    }

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = payload.zip_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    console.log("[ZIP] Export OK:", payload.zip_name);
  } catch (e) {
    console.error("[ZIP] Download error:", e);
    alert("Erreur téléchargement ZIP.");
  }
}

// Alias pour compatibilité
async function exportProjectPdfPackPro() {
  return await exportProjectPdfWithLocalDatasheetsZip();
}

// Alias pour compatibilité avec l'ancien nom
async function exportProjectPdfPackPro() {
  return await exportProjectPdfWithLocalDatasheetsZip();
}


function ensurePdfPackButton() {
  const pdfBtn = document.querySelector("#btnExportPdf");
  if (!pdfBtn) return false;
  if (document.querySelector("#btnExportPdfPack")) return true;

  const packBtn = document.createElement("button");
  packBtn.id = "btnExportPdfPack";
  packBtn.type = "button";
  packBtn.className = (pdfBtn.className || "btn").replace("primary", "secondary");
  packBtn.textContent = "PDF + Fiches techniques";
  packBtn.style.marginLeft = "8px";

  pdfBtn.insertAdjacentElement("afterend", packBtn);

  packBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    packBtn.disabled = true;
    packBtn.textContent = "Génération...";
    try {
      await exportProjectPdfWithLocalDatasheetsZip();
    } finally {
      packBtn.disabled = false;
      packBtn.textContent = "PDF + Fiches techniques";
    }
  });

  return true;
}


async function fetchAsBlob(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return await res.blob();
}




function ensurePdfPackButton() {
  const pdfBtn = document.querySelector("#btnExportPdf");
  if (!pdfBtn) return false; // pas encore rendu

  // 1) Bind PDF normal (IMPORTANT: le bind "DOM.btnExportPdf" ne marche pas car le bouton est injecté plus tard)
  if (!pdfBtn.dataset.boundPdf) {
    pdfBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        exportProjectPdfPro();
      } catch (err) {
        console.error(err);
        alert("Erreur export PDF (voir console).");
      }
    });
    pdfBtn.dataset.boundPdf = "1";
  }

  // 2) Pack button : chez toi c'est btnExportPdfPackSummary (tu as aussi un ancien btnExportPdfPack)
  let packBtn =
    document.querySelector("#btnExportPdfPackSummary") ||
    document.querySelector("#btnExportPdfPack");

  // Si pas trouvé, on le crée à côté du bouton PDF
  if (!packBtn) {
    packBtn = document.createElement("button");
    packBtn.id = "btnExportPdfPackSummary"; // ✅ ton id actuel
    packBtn.type = "button";
    packBtn.textContent = "PDF + Fiches techniques";

    // copie du style du bouton PDF
    packBtn.className = pdfBtn.className || "";
    pdfBtn.insertAdjacentElement("afterend", packBtn);
  }

  // Bind du pack
  if (!packBtn.dataset.boundPack) {
    packBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        if (typeof exportProjectPdfWithLocalDatasheetsZip !== "function") {
          console.warn("exportProjectPdfWithLocalDatasheetsZip non trouvée, tentative fallback...");
          // Essayer un fallback
          if (typeof exportProjectPdfPackPro === "function") {
            await exportProjectPdfPackPro();
            return;
          }
          alert("Export pack indisponible.");
          return;
        }
        await exportProjectPdfWithLocalDatasheetsZip();
      } catch (err) {
        console.error(err);
        alert("Erreur export pack (voir console).");
      }
    });
    packBtn.dataset.boundPack = "1";
  }

  return true;
}


  // ==========================================================
// 13) NAV / BUTTONS (safe bindings)
// ==========================================================
function bind(el, evt, fn) {
  if (!el) return;
  el.addEventListener(evt, fn);
}

bind(DOM.btnCompute, "click", () => {
  const stepId = STEPS[MODEL.stepIndex]?.id;

  const summaryIdx = STEPS.findIndex(s => s.id === "summary");
  const storageIdx = STEPS.findIndex(s => s.id === "storage");

  // 1) Projet => suivant direct
  if (stepId === "project") {
    MODEL.stepIndex++;
    MODEL.ui.resultsShown = false;
    syncResultsUI();
    render();
    return;
  }

  // 2) Caméras => exige au moins 1 caméra validée
  if (stepId === "cameras") {
    if (!canGoNext()) {
      alert("Valide au moins 1 caméra (bouton 'Je valide cette caméra').");
      return;
    }
    suggestAccessories();
    MODEL.stepIndex++;
    MODEL.ui.resultsShown = false;
    syncResultsUI();
    render();
    return;
  }

  // 3) Supports
  if (stepId === "mounts") {
    MODEL.stepIndex++;
    MODEL.ui.resultsShown = false;
    syncResultsUI();
    render();
    return;
  }

  // 4) NVR + Réseau
  if (stepId === "nvr_network") {
    MODEL.stepIndex++;
    MODEL.ui.resultsShown = false;
    syncResultsUI();
    render();
    return;
  }

  // 5) Stockage => on FINALISE + on va sur la page Résumé
  if (stepId === "storage") {
    let proj = null;
    try {
      proj = computeProject();
    } catch (e) {
      console.error(e);
      alert("Impossible de finaliser : vérifie les paramètres (caméras/NVR/stockage).");
      return;
    }

    LAST_PROJECT = proj;

    // On passe en mode résumé
    MODEL.ui.resultsShown = true;

    const summaryIdx = STEPS.findIndex(s => s.id === "summary");
    MODEL.stepIndex = summaryIdx >= 0 ? summaryIdx : MODEL.stepIndex;

    syncResultsUI();
    render();
    return;
  }

  // 6) Résumé => ne “reboucle” pas sur stockage via Suivant
  if (stepId === "summary") {
    // No-op : c’est la dernière page.
    // (Le bouton "Modifier la configuration" gère le retour en arrière)
    return;
  }
});

// ✅ Bouton Précédent
const btnPrevEl = document.getElementById("btnPrev");
if (btnPrevEl) {
  btnPrevEl.addEventListener("click", () => {
    if (MODEL.stepIndex > 0) {
      MODEL.stepIndex--;
      render();
      updateNavButtons();
      try { KPI?.sendNowait?.("nav_prev", { step: STEPS[MODEL.stepIndex]?.id }); } catch {}
    }
  });
}

bind(DOM.btnReset, "click", () => {
  MODEL.cameraBlocks = [createEmptyCameraBlock()];
  MODEL.cameraLines = [];
  MODEL.accessoryLines = [];

  MODEL.complements = {
    screen: { enabled: false, sizeInch: 18, qty: 1, selectedId: null },
    enclosure: { enabled: false, qty: 1, selectedId: null }
  };

  MODEL.recording = {
    daysRetention: 14,
    hoursPerDay: 24,
    fps: 15,
    codec: "h265",
    mode: "continuous",
    overheadPct: 20,
    reservePortsPct: 10,
  };

  MODEL.ui.resultsShown = false;
  MODEL.stepIndex = 0;
  LAST_PROJECT = null;

  sanity();
  _renderProjectCache = null;
  syncResultsUI();
  render();
  updateNavButtons();
});


bind(DOM.btnDemo, "click", () => {
  MODEL.cameraLines = [];
  MODEL.accessoryLines = [];

  // ✅ Démo : nom de projet ET type de site
  MODEL.project = MODEL.project || {};
  MODEL.project.name = "Résidence Les Music-Hall";
  MODEL.projectName = "Résidence Les Music-Hall";
  
  const useCases = getAllUseCases();
  const demoUseCase = useCases.find(u => u.toLowerCase().includes("résidentiel") || u.toLowerCase().includes("residential")) 
    || useCases.find(u => u.toLowerCase().includes("hlm"))
    || useCases[0] 
    || "Résidentiel";
  
  MODEL.projectUseCase = demoUseCase;  // ✅ NOUVEAU

  const b1 = createEmptyCameraBlock();
  b1.label = "Parking sous-sol";
  b1.qty = 4;
  b1.quality = "high";
  b1.answers.use_case = demoUseCase;
  b1.answers.emplacement = "interieur";
  b1.answers.objective = "identification";
  b1.answers.distance_m = 15;
  b1.answers.mounting = "ceiling";

  const b2 = createEmptyCameraBlock();
  b2.label = "Hall d'entrée";
  b2.qty = 2;
  b2.quality = "standard";
  b2.answers.use_case = demoUseCase;
  b2.answers.emplacement = "interieur";
  b2.answers.objective = "identification";
  b2.answers.distance_m = 8;
  b2.answers.mounting = "ceiling";

  const b3 = createEmptyCameraBlock();
  b3.label = "Extérieur façade";
  b3.qty = 6;
  b3.quality = "high";
  b3.answers.use_case = demoUseCase;
  b3.answers.emplacement = "exterieur";
  b3.answers.objective = "detection";
  b3.answers.distance_m = 30;
  b3.answers.mounting = "wall";

  MODEL.cameraBlocks = [b1, b2, b3];
  MODEL.ui.activeBlockId = b1.id;

  // Valider automatiquement les blocs avec les meilleures caméras
  const r1 = recommendCameraForAnswers(b1.answers);
  const r2 = recommendCameraForAnswers(b2.answers);
  const r3 = recommendCameraForAnswers(b3.answers);
  validateBlock(b1, r1);
  validateBlock(b2, r2);
  validateBlock(b3, r3);

  suggestAccessories();
  
  // ✅ Rester sur l'étape 1 (projet) pour montrer que tout est rempli
  MODEL.stepIndex = 0;
  LAST_PROJECT = null;
  MODEL.ui.resultsShown = false;

  syncResultsUI();
  render();
  updateNavButtons();
  
  // ✅ Message de confirmation
  console.log("[DEMO] Configuration de démonstration chargée:", {
    projet: MODEL.projectName,
    typeSite: MODEL.projectUseCase,
    blocs: MODEL.cameraBlocks.length,
    cameras: MODEL.cameraBlocks.reduce((sum, b) => sum + (b.qty || 1), 0)
  });
});

function collectProductIdsForPack(proj) {
  const ids = new Set();

  // Caméras
  (MODEL.cameraLines || []).forEach((l) => {
    const cam = getCameraById(l.cameraId);
    if (cam?.id) ids.add(String(cam.id).trim());
  });

  // Accessoires
  (MODEL.accessoryLines || []).forEach((a) => {
    if (a?.accessoryId) ids.add(String(a.accessoryId).trim());
  });

  // NVR
  const nvr = proj?.nvrPick?.nvr;
  if (nvr?.id) ids.add(String(nvr.id).trim());

  // Switches
  (proj?.switches?.plan || []).forEach((p) => {
    const sw = p?.item;
    if (sw?.id) ids.add(String(sw.id).trim());
  });

  // HDD
  const hdd = proj?.disks?.hddRef;
  if (hdd?.id) ids.add(String(hdd.id).trim());

  // Complements
  const scr = typeof getSelectedOrRecommendedScreen === "function"
    ? getSelectedOrRecommendedScreen(proj)?.selected
    : null;
  if (scr?.id) ids.add(String(scr.id).trim());

  const enc = typeof getSelectedOrRecommendedEnclosure === "function"
    ? getSelectedOrRecommendedEnclosure(proj)?.selected
    : null;
  if (enc?.id) ids.add(String(enc.id).trim());

  const signObj = (typeof getSelectedOrRecommendedSign === "function")
    ? getSelectedOrRecommendedSign()
    : null;
  const sign = signObj?.sign || null;
  if (sign?.id) ids.add(String(sign.id).trim());

  return Array.from(ids);
}

// EXPORT (PDF)
bind(DOM.btnExportPdf, "click", exportProjectPdfPro);

// Delegation sur #steps (1 seul set de listeners)
bind(DOM.stepsEl, "click", onStepsClick);
bind(DOM.stepsEl, "change", onStepsChange);
bind(DOM.stepsEl, "input", onStepsInput);

  // ==========================================================
  // 14) INIT (load CSV)
  // ==========================================================
  async function init() {
    try {
      if (DOM.dataStatusEl) DOM.dataStatusEl.textContent = "Chargement des données…";
      KPI.sendNowait('page_view', { app: 'configurateur', v: (window.APP_VERSION || null) });

      
       const [
        camsRaw,
        nvrsRaw,
        hddsRaw,
        swRaw,
        accRaw,
        screensRaw,
        enclosuresRaw,
        signageRaw
      ] = await Promise.all([
        loadCsv("/data/cameras.csv"),
        loadCsv("/data/nvrs.csv"),
        loadCsv("/data/hdds.csv"),
        loadCsv("/data/switches.csv"),
        loadCsv("/data/accessories.csv"),

        // ✅ Fallback: si le fichier n'existe pas, on met []
        loadCsv("/data/screens.csv").catch(() => []),
        loadCsv("/data/enclosures.csv").catch(() => []),

        // ✅ panneaux de signalisation (optionnel)
        loadCsv("/data/signage.csv").catch(() => []),
      ]);



      CATALOG.CAMERAS = camsRaw.map(normalizeCamera).filter((c) => c.id);
      CATALOG.NVRS = nvrsRaw.map(normalizeNvr).filter((n) => n.id);
      CATALOG.HDDS = hddsRaw.map(normalizeHdd).filter((h) => h.id);
      CATALOG.SWITCHES = swRaw.map(normalizeSwitch).filter((s) => s.id);
      CATALOG.SCREENS = screensRaw.map(normalizeScreen).filter(s => s.id);
      CATALOG.ENCLOSURES = enclosuresRaw.map(normalizeEnclosure).filter(e => e.id);

      // ✅ panneaux de signalisation
      CATALOG.SIGNAGE = (signageRaw || []).map(normalizeSignageRow).filter(Boolean);

  // ✅ Médias locaux uniquement (images + fiches)
  applyLocalMediaToCatalog();


      // ✅ accessories.csv = MAPPING (camera_id => junction/wall/ceiling)
      const mappings = accRaw.map(normalizeAccessoryMapping).filter(Boolean);
      CATALOG.ACCESSORIES_MAP = new Map(mappings.map((m) => [m.cameraId, m]));

      if (DOM.dataStatusEl) {
        const parts = [
          `Données chargées ✅`,
          `Caméras: ${CATALOG.CAMERAS.length}`,
          `NVR: ${CATALOG.NVRS.length}`,
          `HDD: ${CATALOG.HDDS.length}`,
          `Switch: ${CATALOG.SWITCHES.length}`,
          `Écrans: ${CATALOG.SCREENS.length}`,
          `Boîtiers: ${CATALOG.ENCLOSURES.length}`,
          `Panneaux: ${CATALOG.SIGNAGE.length}`,
          `Mappings accessoires: ${CATALOG.ACCESSORIES_MAP.size}`,
        ];
        DOM.dataStatusEl.textContent = parts.join(" • ");
      }

      sanity();

      LAST_PROJECT = null;
      MODEL.ui.resultsShown = false;

      syncResultsUI();
      render();
      updateNavButtons();
    } catch (e) {
      console.error(e);
      if (DOM.dataStatusEl) DOM.dataStatusEl.textContent = "Erreur chargement données ❌";
      alert(
        `Erreur chargement data: ${e.message}\n\nVérifie:\n- dossier /data\n- fichiers cameras.csv / nvrs.csv / hdds.csv / switches.csv / accessories.csv\n- serveur local (http://localhost:8000)`
      );
    }
  }
// ==========================================================
// ADMIN PANEL (UI) - utilise /api/login + /api/csv/{name}
// ==========================================================
let ADMIN_TOKEN = null;

// Schémas attendus (minimum) — aide à éviter de casser le configurateur
const ADMIN_SCHEMAS = {
  cameras: ["id","name","type","resolution_mp","image_url","datasheet_url"],
  nvrs: ["id","name","channels","nvr_output","image_url","datasheet_url"],
  hdds: ["id","name","capacity_tb"],
  switches: ["id","name"],
  accessories: ["camera_id"],
  screens: ["id","name","size_inch","format","vesa","Resolution","image_url","datasheet_url"],
  enclosures: ["id","name","screen_compatible_with","compatible_with","image_url","datasheet_url"],
  signage: ["id","name","image_url","datasheet_url"],
};

function adminSchemaWarnings(name, headers, rows){
  try{
    const need = ADMIN_SCHEMAS[name];
    if (!need) return null;

    const set = new Set((headers || []).map(h => String(h).trim()));
    const missing = need.filter(h => !set.has(h));
    const warns = [];

    if (missing.length) warns.push(`colonnes manquantes: ${missing.join(", ")}`);

    // Duplicats ID (si colonne id présente)
    if (set.has("id")){
      const seen = new Set();
      const dups = new Set();
      for (const r of (rows || [])){
        const id = String(r?.id || "").trim();
        if (!id) continue;
        if (seen.has(id)) dups.add(id);
        seen.add(id);
      }
      if (dups.size) warns.push(`IDs en double: ${Array.from(dups).slice(0,6).join(", ")}${dups.size>6?"…":""}`);
    }

    return warns.length ? warns.join(" • ") : null;
  } catch {
    return "validation impossible (format inattendu)";
  }
}

function admin$(id){ return document.getElementById(id); }

function adminShow(open){
  const m = admin$("adminModal");
  if (!m) return;
  m.classList.toggle("hidden", !open);
}

function setAdminMode(isAuthed){
  const loginBox = admin$("adminLoginBox");
  const editorBox = admin$("adminEditorBox");
  if (!loginBox || !editorBox) return;
  loginBox.classList.toggle("hidden", isAuthed);
  editorBox.classList.toggle("hidden", !isAuthed);
}

async function adminLogin(password){
  const msg = admin$("adminLoginMsg");
  if (msg) msg.textContent = "Connexion…";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({password})
  });

if (!res.ok) {
  const t = await res.text().catch(()=> "");
  throw new Error(`Erreur chargement CSV (${res.status}) ${t}`);
}


  const data = await res.json();
  ADMIN_TOKEN = data.token;
  if (msg) msg.textContent = "✅ Connecté";
  setAdminMode(true);
}

async function adminLoadCsv(name){
  const ta = admin$("adminCsvText");
  const msg = admin$("adminMsg");
  if (msg) msg.textContent = `Chargement ${name}.csv…`;

  const res = await fetch(`/api/csv/${encodeURIComponent(name)}`, {
    cache: "no-store",
    headers: ADMIN_TOKEN ? { "Authorization": `Bearer ${ADMIN_TOKEN}` } : {},
  });

  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`Load CSV failed (${res.status}) ${t}`);
  }

  // ✅ variable unique : txt
  const txt = await res.text();

  // ✅ Remplit le textarea (mode expert) + la grille
  if (ta) ta.value = txt;

  const parsed = parseCSVGrid(txt);
  ADMIN_GRID.csvName = name;
  ADMIN_GRID.headers = parsed.headers;
  ADMIN_GRID.rows = parsed.rows;
  ADMIN_GRID.selectedIndex = ADMIN_GRID.rows.length ? 0 : -1;

renderAdminGrid();

const warn = adminSchemaWarnings(name, ADMIN_GRID.headers, ADMIN_GRID.rows);
if (msg) msg.textContent = warn ? `⚠️ Chargé avec alertes — ${warn}` : "✅ Chargé";

}



async function adminSaveCsv(name, content){
  const msg = admin$("adminMsg");
  if (msg) msg.textContent = `Sauvegarde ${name}.csv…`;

  const expertBox = document.getElementById("adminExpertBox");
  const ta = admin$("adminCsvText");

  let csvToSave = "";

  // ✅ Si mode expert ouvert => on sauve le textarea brut
  if (expertBox && !expertBox.classList.contains("hidden")) {
    csvToSave = (ta?.value || "");
  } else {
    // ✅ Sinon on sauve depuis la grille
    csvToSave = toCSVGrid(ADMIN_GRID.headers, ADMIN_GRID.rows);
    if (ta) ta.value = csvToSave; // sync au cas où
  }

  const res = await fetch(`/api/csv/${encodeURIComponent(name)}`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization": `Bearer ${ADMIN_TOKEN}`
    },
    body: JSON.stringify({content: csvToSave})
  });

  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`Save CSV failed (${res.status}) ${t}`);
  }

  if (msg) msg.textContent = "✅ Sauvegardé (backup .bak créé côté serveur)";
  const warn = adminSchemaWarnings(name, ADMIN_GRID.headers, ADMIN_GRID.rows);
if (warn && msg) msg.textContent += ` • ⚠️ ${warn}`;

  // ✅ Recharger les données dans le configurateur après save
  try {
    await init();
    if (msg) msg.textContent += " • Données rechargées dans le configurateur";
  } catch(e) {
    if (msg) msg.textContent += " • ⚠️ Données sauvegardées, mais reload a échoué (voir console)";
  }
}


function bindAdminPanel(){
  // ✅ IMPORTANT : sur la page configurateur, l'UI Admin n'existe pas.
  // Si on lance initAdminGridUI() quand les éléments n'existent pas => crash JS => configurateur KO.
  const modal = document.getElementById("adminModal");
  const root  = document.getElementById("adminRoot");
  const btnAdmin = document.getElementById("btnAdmin");

  // Si aucun élément admin n'est présent sur la page, on ne fait rien.
  if (!modal && !root && !btnAdmin) return;

  // ✅ Maintenant seulement on peut initialiser la grille admin
  initAdminGridUI();

  const btnClose  = admin$("btnAdminClose");
  const btnLogin  = admin$("btnAdminLogin");
  const btnLoad   = admin$("btnAdminLoad");
  const btnSave   = admin$("btnAdminSave");
  const btnLogout = admin$("btnAdminLogout");
  const sel = admin$("adminCsvSelect");
  const ta  = admin$("adminCsvText");
  const pwd = admin$("adminPassword");

  if (btnAdmin) btnAdmin.addEventListener("click", () => {
    adminShow(true);
    setAdminMode(!!ADMIN_TOKEN);
  });

  if (btnClose) btnClose.addEventListener("click", () => adminShow(false));

  // fermer si clic backdrop
  if (modal) modal.addEventListener("click", (e) => {
    if (e.target === modal) adminShow(false);
  });

  if (btnLogin) btnLogin.addEventListener("click", async () => {
    try {
      await adminLogin((pwd?.value || "").trim());
      const name = sel?.value || "cameras";
      await adminLoadCsv(name);
    } catch(e) {
      const msg = admin$("adminLoginMsg");
      if (msg) msg.textContent = "❌ Login failed";
    }
  });

  if (btnLoad) btnLoad.addEventListener("click", async () => {
    try {
      const name = sel?.value || "cameras";
      await adminLoadCsv(name);
    } catch(e) {
      const msg = admin$("adminMsg");
      if (msg) msg.textContent = "❌ Load failed";
    }
  });

  if (btnSave) btnSave.addEventListener("click", async () => {
    try {
      const name = sel?.value || "cameras";
      await adminSaveCsv(name, (ta?.value || ""));
    } catch(e) {
      const msg = admin$("adminMsg");
      if (msg) msg.textContent = "❌ Save failed";
    }
  });

  if (btnLogout) btnLogout.addEventListener("click", () => {
    ADMIN_TOKEN = "";
    setAdminMode(false);
    const msg = admin$("adminMsg");
    if (msg) msg.textContent = "Déconnecté";
  });
}


// ⚠️ bind admin une fois que le DOM est prêt
// (si ton script est defer, ça passe direct)
bindAdminPanel();

// ==========================================================
// ADMIN TABLE EDITOR (Grille type Excel)
// Branche sur ton admin existant (ADMIN_TOKEN + /api/csv)
// ==========================================================

const ADMIN_GRID = {
  csvName: "cameras",
  headers: [],
  rows: [],           // array d'objets
  selectedIndex: -1,
};

// ---- helpers DOM
function q(id){ return document.getElementById(id); }

function escapeAttr(v){
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// ---- CSV parse simple (quotes + virgules)
function parseCSVGrid(csvText){
  const s = String(csvText ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++){
    const ch = s[i];
    const next = s[i+1];

    if (ch === '"' && inQuotes && next === '"'){
      cur += '"'; i++; continue;
    }
    if (ch === '"'){
      inQuotes = !inQuotes; 
      continue;
    }

    if (ch === "," && !inQuotes){
      row.push(cur);
      cur = "";
      continue;
    }

    if (ch === "\n" && !inQuotes){
      row.push(cur);
      cur = "";
      // évite de pousser une ligne vide “à cause” d'un \n final
      if (row.some(c => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  // dernière cellule
  row.push(cur);
  if (row.some(c => String(c).trim() !== "")) rows.push(row);

  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map(h => String(h ?? "").trim());
  const dataRows = [];

  for (let i = 1; i < rows.length; i++){
    const cols = rows[i];
    const obj = {};
    headers.forEach((h, idx) => obj[h] = String(cols[idx] ?? ""));
    dataRows.push(obj);
  }

  return { headers, rows: dataRows };
}


function toCSVGrid(headers, rows){
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const head = headers.map(esc).join(",");
  const body = rows.map(r => headers.map(h => esc(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

function syncGridMeta(){
  const el = q("adminGridMeta");
  if (!el) return;
  const sel = ADMIN_GRID.selectedIndex >= 0 ? `Ligne : #${ADMIN_GRID.selectedIndex+1}` : "Aucune ligne";
  el.textContent = `${sel} • ${ADMIN_GRID.rows.length} lignes • ${ADMIN_GRID.headers.length} colonnes`;
}

function syncExpertTextareaIfOpen(){
  const expertBox = q("adminExpertBox");
  const ta = q("adminCsvText");
  if (!expertBox || !ta) return;
  if (!expertBox.classList.contains("hidden")){
    ta.value = toCSVGrid(ADMIN_GRID.headers, ADMIN_GRID.rows);
  }
}

function renderAdminGrid(){
  const mount = q("adminTableMount");
  if (!mount) return;

  if (!ADMIN_GRID.headers.length){
    mount.innerHTML = `<div class="muted" style="padding:12px">Aucune donnée.</div>`;
    syncGridMeta();
    return;
  }
function scrollSelectedIntoView(){
  const mount = q("adminTableMount");
  const tr = mount?.querySelector(`.adminRow.selected`);
  tr?.scrollIntoView({ block: "nearest" });
}

  const ths = ADMIN_GRID.headers.map(h => `<th title="${escapeAttr(h)}">${escapeAttr(h)}</th>`).join("");

  const trs = ADMIN_GRID.rows.map((row, idx) => {
    const selected = idx === ADMIN_GRID.selectedIndex ? "selected" : "";
    const tds = ADMIN_GRID.headers.map(h => {
      const val = row[h] ?? "";
      return `<td><input class="adminCell" data-row="${idx}" data-col="${escapeAttr(h)}" value="${escapeAttr(val)}" /></td>`;
    }).join("");

    return `
      <tr class="adminRow ${selected}" data-row="${idx}">
        <td class="rowSel">#${idx+1}</td>
        ${tds}
      </tr>
    `;
  }).join("");

  mount.innerHTML = `
    <table class="adminTable">
      <thead>
        <tr>
          <th class="rowSel">—</th>
          ${ths}
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
  `;

  syncGridMeta();
}

function bindAdminGridEventsOnce(){
  const mount = q("adminTableMount");
  if (!mount) return;
  if (mount.dataset.bound === "1") return;
  mount.dataset.bound = "1";

  mount.addEventListener("click", (e) => {
    const cell = e.target.closest(".adminCell");
    if (cell) return; // click dans input => ne pas sélectionner via row click ici

    const tr = e.target.closest(".adminRow");
    if (!tr) return;
    ADMIN_GRID.selectedIndex = Number(tr.dataset.row);
    renderAdminGrid(); // ok
  });

  mount.addEventListener("input", (e) => {
    const inp = e.target.closest(".adminCell");
    if (!inp) return;
    const r = Number(inp.dataset.row);
    const c = inp.dataset.col;
    if (!ADMIN_GRID.rows[r]) return;
    ADMIN_GRID.rows[r][c] = inp.value;
    syncExpertTextareaIfOpen();
    // Option: refresh meta sans rerender complet
    // syncGridMeta();
  });
}


function adminGridAddRow(){
  if (!ADMIN_GRID.headers.length) return;
  const obj = {};
  ADMIN_GRID.headers.forEach(h => obj[h] = "");
  ADMIN_GRID.rows.push(obj);
  ADMIN_GRID.selectedIndex = ADMIN_GRID.rows.length - 1;
  renderAdminGrid();
  syncExpertTextareaIfOpen();
}

function adminGridDupRow(){
  const i = ADMIN_GRID.selectedIndex;
  if (i < 0 || !ADMIN_GRID.rows[i]) return;
  const copy = { ...ADMIN_GRID.rows[i] };
  ADMIN_GRID.rows.splice(i+1, 0, copy);
  ADMIN_GRID.selectedIndex = i+1;
  renderAdminGrid();
  syncExpertTextareaIfOpen();
}

function adminGridDelRow(){
  const i = ADMIN_GRID.selectedIndex;
  if (i < 0 || !ADMIN_GRID.rows[i]) return;
  ADMIN_GRID.rows.splice(i, 1);
  ADMIN_GRID.selectedIndex = ADMIN_GRID.rows.length ? Math.min(i, ADMIN_GRID.rows.length-1) : -1;
  renderAdminGrid();
  syncExpertTextareaIfOpen();
}

function initAdminGridUI(){
  const btnAdd = q("btnAdminAddRow");
  const btnDup = q("btnAdminDupRow");
  const btnDel = q("btnAdminDelRow");
  const btnToggle = q("btnAdminToggleExpert");
  const expertBox = q("adminExpertBox");
  const ta = q("adminCsvText");

  if (btnAdd) btnAdd.addEventListener("click", adminGridAddRow);
  if (btnDup) btnDup.addEventListener("click", adminGridDupRow);
  if (btnDel) btnDel.addEventListener("click", adminGridDelRow);

  if (btnToggle && expertBox){
    btnToggle.addEventListener("click", () => {
      expertBox.classList.toggle("hidden");
      if (!expertBox.classList.contains("hidden") && ta){
        ta.value = toCSVGrid(ADMIN_GRID.headers, ADMIN_GRID.rows);
      }
    });
  }
}

  init();
  function ensurePdfPackButton() {
  const pdfBtn = document.querySelector("#btnExportPdf");
  if (!pdfBtn) return false;
  if (document.querySelector("#btnExportPdfPack")) return true;
  
  const packBtn = document.createElement("button");
  packBtn.id = "btnExportPdfPack";
  packBtn.type = "button";
  packBtn.className = (pdfBtn.className || "btn").replace("primary", "secondary");
  packBtn.textContent = "PDF + Fiches techniques";
  packBtn.style.marginLeft = "8px";

  pdfBtn.insertAdjacentElement("afterend", packBtn);

  packBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    packBtn.disabled = true;
    packBtn.textContent = "Génération...";
    try {
      await exportProjectPdfWithLocalDatasheetsZip();
    } finally {
      packBtn.disabled = false;
      packBtn.textContent = "PDF + Fiches techniques";
    }
  });

  return true;
}

// Auto-init
if (typeof document !== "undefined") {
  const initPdfButtons = () => setTimeout(ensurePdfPackButton, 500);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPdfButtons);
  } else {
    initPdfButtons();
  }
}

console.log("[PDF-FIX v2] Corrections chargées avec récupération automatique du projet.");

})();