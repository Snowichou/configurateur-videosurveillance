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

(() => {
  "use strict";

  // ==========================================================
  // GLOBALS (doivent exister AVANT toute utilisation)
  // ==========================================================
  let LAST_PROJECT = null;
  let btnToggleResults = null;
  let _renderProjectCache = null;


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

  const objectiveLabel = (obj) =>
    obj === "dissuasion" ? "Dissuasion" : obj === "detection" ? "Détection" : "Identification";

  const mountingLabel = (m) => ({ wall: "Mur", ceiling: "Plafond" }[m] || "Mur");

  const accessoryTypeLabel = (t) =>
    ({
      junction_box: "Boîtier de connexion",
      wall_mount: "Support mural",
      ceiling_mount: "Support plafond",
    }[t] || t);

  const badgeHtml = (text) => {
    const t = safeHtml(text || "");
    if (!t) return "";
    return `<span class="badgePill">${t}</span>`;
  };

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

    ui: {
      activeBlockId: null,
      resultsShown: false,
    },

    stepIndex: 0,
  };

  const STEPS = [
    {
      id: "cameras",
      title: "1) Choix des caméras",
      badge: "1/4",
      help: "Complète les choix à gauche. À droite tu choisis la caméra (reco + alternatives) et tu valides en 1 clic.",
    },
    {
      id: "mounts",
      title: "2) Supports & accessoires caméras",
      badge: "2/4",
      help: "Suggestions automatiques par bloc (pose + emplacement). Tu peux ajuster.",
    },
    {
      id: "nvr_network",
      title: "3) Enregistreur + réseau PoE",
      badge: "3/4",
      help: "NVR choisi automatiquement + switches PoE dimensionnés.",
    },
    {
      id: "storage",
      title: "4) Stockage (HDD)",
      badge: "4/4",
      help: "Calcul stockage selon jours/heures/fps/codec/mode. Proposition de disques.",
    },
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
  btnExportXlsx: $("#btnExportXlsx"),
};

  // ==========================================================
  // 4) NORMALIZATION
  // ==========================================================
  function normalizeCamera(raw) {
    const useCases = extractUseCasesFromRow(raw);
    const emplInt = toBool(raw.Emplacement_Interieur ?? raw.emplacement_interieur ?? raw.interieur);
    const emplExt = toBool(raw.Emplacement_Exterieur ?? raw.emplacement_exterieur ?? raw.exterieur);

    return {
      id: String(raw.id ?? "").trim(),
      name: raw.name,
      brand_range: raw.brand_range || "",
      family: raw.family || "standard",
      type: raw.form_factor || raw.type || "",

      emplacement_interieur: emplInt,
      emplacement_exterieur: emplExt,

      resolution_mp: toNum(raw.resolution_mp),
      sensor_count: toNum(raw.sensor_count),
      lens_type: raw.lens_type || "",

      focal_min_mm: toNum(raw.focal_min_mm),
      focal_max_mm: toNum(raw.focal_max_mm),

      dori_detection_m: toNum(raw.dori_detection_m) ?? 0,
      dori_observation_m: toNum(raw.dori_observation_m) ?? 0,
      dori_recognition_m: toNum(raw.dori_recognition_m) ?? 0,
      dori_identification_m: toNum(raw.dori_identification_m) ?? 0,

      ir_range_m: toNum(raw.ir_range_m) ?? 0,
      white_led_range_m: toNum(raw.white_led_range_m) ?? 0,

      low_light_raw: raw.low_light_mode || raw.low_light || "",
      low_light: !!String(raw.low_light_mode ?? raw.low_light ?? "").trim(),

      ip: toNum(raw.ip),
      ik: toNum(raw.ik),

      microphone: toBool(raw.Microphone || raw.microphone),

      poe_w: toNum(raw.poe_w) ?? 0,
      bitrate_mbps_typical: toNum(raw.bitrate_mbps_typical),
      streams_max: toNum(raw.streams_max),
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
      qty: 1,
      quality: "standard",
      answers: {
        use_case: "",
        emplacement: "interieur",
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

    const qty = clampInt(block.qty, 1, 999);
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
      block.validatedLineId = lineId;
    }

    block.validated = true;
    block.selectedCameraId = cam.id;

    suggestAccessoriesForBlock(block);
    rebuildAccessoryLinesFromBlocks();
  }

  // ==========================================================
  // 8) ENGINE - PROJET (NVR / SWITCH / HDD)
  // ==========================================================
  function getTotalCameras() {
    return sum(MODEL.cameraLines, (l) => (l.qty || 0));
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

  function computeProject() {
    const totalCameras = getTotalCameras();
    const { totalInMbps, totalPoeW } = computeTotals();

    const nvrPick = pickNvr(totalCameras, totalInMbps);
    const switches = planPoESwitches(totalCameras, MODEL.recording.reservePortsPct);

    const requiredTB = mbpsToTB(
      totalInMbps,
      MODEL.recording.hoursPerDay,
      MODEL.recording.daysRetention,
      MODEL.recording.overheadPct
    );
  
    const disks = nvrPick.nvr ? pickDisks(requiredTB, nvrPick.nvr) : null;

    const alerts = [];
    if (totalCameras <= 0) {
      alerts.push({
        level: "danger",
        text: "Valide au moins 1 caméra (bouton 'Je valide cette caméra') pour ajouter des caméras au panier.",
      });
    }
    if (!nvrPick.nvr) {
      alerts.push({ level: "danger", text: "Aucun NVR compatible. Vérifie nvrs.csv (channels / max_in_mbps)." });
    }
    if (nvrPick.nvr && totalInMbps > nvrPick.nvr.max_in_mbps) {
      alerts.push({
        level: "danger",
        text: `Débit total ${totalInMbps.toFixed(1)} Mbps > limite NVR (${nvrPick.nvr.max_in_mbps} Mbps).`,
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

    return { totalCameras, totalInMbps, totalPoeW, nvrPick, switches, requiredTB, disks, alerts };
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
    DOM.resultsEmpty.classList.add("hidden");
    DOM.results.classList.remove("hidden");
  }

  function hideResultsUI() {
  DOM.resultsEmpty.classList.remove("hidden");
  DOM.results.classList.add("hidden");
}

  function renderAlerts(alerts) {
    DOM.alertsEl.innerHTML = "";
    for (const al of alerts) {
      const li = document.createElement("li");
      if (al.level === "danger") li.classList.add("danger");
      li.textContent = al.text;
      DOM.alertsEl.appendChild(li);
    }
  }

  function renderFinalSummary(proj) {
  const line = (qty, ref, name) => `• ${qty} × ${safeHtml(ref || "—")} — ${safeHtml(name || "")}`;

  const cams = MODEL.cameraLines
    .map((l) => {
      const cam = getCameraById(l.cameraId);
      if (!cam) return null;
      return line(l.qty || 0, cam.id, cam.name);
    })
    .filter(Boolean)
    .join("<br>");

  const accs = (MODEL.accessoryLines || [])
    .map((a) => line(a.qty || 0, a.accessoryId, a.name || a.accessoryId))
    .filter(Boolean)
    .join("<br>");

  const nvr = proj.nvrPick?.nvr || null;
  const nvrHtml = nvr ? line(1, nvr.id, nvr.name) : "—";

  const sw = proj.switches.required
    ? proj.switches.plan
        .map((p) => line(p.qty || 0, p.item.id || "", p.item.name || ""))
        .join("<br>")
    : "• (non obligatoire)";

  const disk = proj.disks;
  const hdd = disk?.hddRef || null;
  const hddHtml = disk
    ? line(disk.count, hdd?.id || `${disk.sizeTB}TB`, hdd?.name || `Disques ${disk.sizeTB} TB`)
    : "—";

  return `
    <div class="recoCard">
      <div class="recoHeader">
        <div>
          <div class="recoName">Résumé de la solution</div>
          <div class="muted">Format devis (Qté × Réf — Désignation)</div>
        </div>
        <div class="score">✅</div>
      </div>

      <div class="reasons">
        <strong>Caméras</strong><br>${cams || "—"}<br><br>
        <strong>Supports / accessoires</strong><br>${accs || "—"}<br><br>
        <strong>NVR</strong><br>${nvrHtml}<br><br>
        <strong>Switch PoE</strong><br>${sw}<br><br>
        <strong>Stockage</strong><br>${hddHtml}<br><br>
        <strong>Calcul</strong><br>
        • Débit total estimé : ${proj.totalInMbps.toFixed(1)} Mbps<br>
        • Stockage requis : ~${proj.requiredTB.toFixed(1)} TB
      </div>
    </div>
  `;
}


  function setFinalContent(proj) {
  DOM.primaryRecoEl.innerHTML = renderFinalSummary(proj);
  renderAlerts(proj.alerts);
}


  function buildPdfHtml(proj) {
  const now = new Date();
  const dateStr = now.toLocaleString("fr-FR");

  // Tables : caméras
  const camsRows = MODEL.cameraLines.map((l) => {
    const cam = getCameraById(l.cameraId);
    if (!cam) return "";
    return `
      <tr>
        <td>${safeHtml(cam.id)}</td>
        <td>${safeHtml(cam.name)}</td>
        <td style="text-align:center">${safeHtml(String(l.quality || "standard"))}</td>
        <td style="text-align:right">${safeHtml(String(l.qty || 0))}</td>
        <td style="text-align:right">${(cam.poe_w ?? 0).toFixed(1)} W</td>
      </tr>
    `;
  }).join("");

  // Tables : accessoires
  const accRows = (MODEL.accessoryLines || []).map((a) => `
    <tr>
      <td>${safeHtml(a.accessoryId)}</td>
      <td>${safeHtml(a.name || "")}</td>
      <td>${safeHtml(accessoryTypeLabel(a.type))}</td>
      <td style="text-align:right">${safeHtml(String(a.qty || 0))}</td>
    </tr>
  `).join("");

  // Switch plan
  const sw = proj.switches;
  const swRows = (sw.plan || []).map((p) => `
    <tr>
      <td>${safeHtml(p.item.id || "")}</td>
      <td>${safeHtml(p.item.name || "")}</td>
      <td style="text-align:right">${safeHtml(String(p.item.poe_ports ?? ""))}</td>
      <td style="text-align:right">${safeHtml(String(p.qty || 0))}</td>
    </tr>
  `).join("");

  const nvr = proj.nvrPick?.nvr || null;
  const disk = proj.disks || null;

  // Petite logique d’affichage
  const nvrLine = nvr
    ? `${safeHtml(nvr.id)} — ${safeHtml(nvr.name)} (${nvr.channels} canaux, ${nvr.max_in_mbps} Mbps)`
    : "Aucun NVR compatible";

  const storageLine = disk
    ? `${disk.count} × ${disk.sizeTB} TB (Total ${disk.totalTB} TB) — Max NVR ${disk.maxTotalTB} TB`
    : "Aucun stockage proposé";

  // ✅ HTML rapport (mise en page simple mais clean)
  return `
  <div id="pdfReportRoot" style="font-family: Arial, sans-serif; color:#111;">

    <style>
      .pdfPage{
        padding: 22px 22px 18px 22px;
      }
      .pdfHeader{
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:16px;
        border-bottom: 2px solid #111;
        padding-bottom: 10px;
        margin-bottom: 14px;
      }
      .pdfTitle{
        font-size: 18px;
        font-weight: 800;
        margin: 0;
      }
      .pdfMeta{
        font-size: 11px;
        color:#444;
        margin-top: 4px;
        line-height: 1.25;
      }
      .pill{
        display:inline-block;
        padding: 4px 8px;
        border: 1px solid #999;
        border-radius: 999px;
        font-size: 11px;
        margin-left: 6px;
      }
      .section{
        margin-top: 12px;
        padding: 12px;
        border: 1px solid #ddd;
        border-radius: 10px;
      }
      .sectionTitle{
        font-size: 13px;
        font-weight: 800;
        margin: 0 0 8px 0;
      }
      .grid2{
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .kpi{
        padding: 10px;
        border: 1px solid #eee;
        border-radius: 10px;
        background: #fafafa;
      }
      .kpiLabel{
        font-size: 11px;
        color:#555;
      }
      .kpiValue{
        margin-top: 4px;
        font-size: 14px;
        font-weight: 800;
      }
      table{
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
        font-size: 11px;
      }
      th, td{
        border: 1px solid #e5e5e5;
        padding: 7px 8px;
        vertical-align: top;
      }
      th{
        background: #f2f2f2;
        text-align: left;
        font-weight: 800;
      }
      .muted{
        color:#666;
        font-size: 11px;
        line-height: 1.35;
      }
      .alerts{
        margin: 6px 0 0 0;
        padding-left: 16px;
      }
      .alerts li{
        margin-bottom: 4px;
      }
      .danger{ color: #c1121f; font-weight: 700; }
      .warn{ color: #b45309; font-weight: 700; }

      /* ✅ sauts de pages */
      .pageBreak{
        page-break-before: always;
      }
    </style>

    <div class="pdfPage">
      <div class="pdfHeader">
        <div>
          <h1 class="pdfTitle">Rapport de configuration Vidéosurveillance</h1>
          <div class="pdfMeta">
            Généré le ${safeHtml(dateStr)}<br>
            Configurateur Comelit (MVP) <span class="pill">PDF v1</span>
          </div>
        </div>

        <div style="text-align:right">
          <div class="pdfMeta">Total caméras</div>
          <div style="font-size:22px;font-weight:900">${proj.totalCameras}</div>
        </div>
      </div>

      <div class="grid2">
        <div class="kpi">
          <div class="kpiLabel">Débit total estimé</div>
          <div class="kpiValue">${proj.totalInMbps.toFixed(1)} Mbps</div>
          <div class="muted">Selon fps / codec / mode / qualité.</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Stockage requis</div>
          <div class="kpiValue">~${proj.requiredTB.toFixed(1)} TB</div>
          <div class="muted">Inclut marge ${MODEL.recording.overheadPct}%.</div>
        </div>
      </div>

      <div class="section">
        <div class="sectionTitle">NVR + Stockage</div>
        <div class="muted"><strong>NVR :</strong> ${nvrLine}</div>
        <div class="muted" style="margin-top:6px"><strong>Stockage :</strong> ${safeHtml(storageLine)}</div>
      </div>

      <div class="section">
        <div class="sectionTitle">Alertes & points d’attention</div>
        ${
          (proj.alerts || []).length
            ? `<ul class="alerts">
                ${(proj.alerts || []).map(a => `<li class="${safeHtml(a.level)}">${safeHtml(a.text)}</li>`).join("")}
              </ul>`
            : `<div class="muted">Aucune alerte.</div>`
        }
      </div>

      <div class="section">
        <div class="sectionTitle">Caméras (panier)</div>
        <table>
          <thead>
            <tr>
              <th>Réf</th>
              <th>Modèle</th>
              <th style="text-align:center">Qualité</th>
              <th style="text-align:right">Qté</th>
              <th style="text-align:right">PoE/cam</th>
            </tr>
          </thead>
          <tbody>
            ${camsRows || `<tr><td colspan="5" class="muted">Aucune caméra validée.</td></tr>`}
          </tbody>
        </table>
        <div class="muted" style="margin-top:8px">
          PoE total estimé : <strong>${proj.totalPoeW.toFixed(0)} W</strong>
        </div>
      </div>

      <div class="pageBreak"></div>

      <div class="section">
        <div class="sectionTitle">Accessoires & supports</div>
        <table>
          <thead>
            <tr>
              <th>Réf</th>
              <th>Nom</th>
              <th>Type</th>
              <th style="text-align:right">Qté</th>
            </tr>
          </thead>
          <tbody>
            ${accRows || `<tr><td colspan="4" class="muted">Aucun accessoire.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="sectionTitle">Réseau PoE (plan switches)</div>
        ${
          sw.required
            ? `
              <div class="muted">
                Ports requis : <strong>${sw.portsNeeded}</strong> •
                Ports proposés : <strong>${sw.totalPorts}</strong> •
                Surplus : <strong>${sw.surplusPorts}</strong>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Réf</th>
                    <th>Nom</th>
                    <th style="text-align:right">Ports PoE</th>
                    <th style="text-align:right">Qté</th>
                  </tr>
                </thead>
                <tbody>
                  ${swRows || `<tr><td colspan="4" class="muted">Aucun switch proposé.</td></tr>`}
                </tbody>
              </table>
            `
            : `<div class="muted">Switch non obligatoire (règle actuelle : obligatoire à partir de 16 caméras).</div>`
        }
      </div>

      <div class="section">
        <div class="sectionTitle">Paramètres d’enregistrement</div>
        <div class="muted">
          Jours : <strong>${safeHtml(String(MODEL.recording.daysRetention))}</strong> •
          Heures/jour : <strong>${safeHtml(String(MODEL.recording.hoursPerDay))}</strong> •
          FPS : <strong>${safeHtml(String(MODEL.recording.fps))}</strong> •
          Codec : <strong>${safeHtml(String(MODEL.recording.codec))}</strong> •
          Mode : <strong>${safeHtml(String(MODEL.recording.mode))}</strong> •
          Overhead : <strong>${safeHtml(String(MODEL.recording.overheadPct))}%</strong> •
          Réserve PoE : <strong>${safeHtml(String(MODEL.recording.reservePortsPct))}%</strong>
        </div>
      </div>

      <div class="muted" style="margin-top:14px;text-align:center">
        Document généré par le configurateur • © Comelit • (MVP) • Page 1+
      </div>
    </div>
  </div>
  `;
}

  function syncResultsUI() {
  const isLastStep = MODEL.stepIndex >= (STEPS.length - 1);
  const hasFinal = !!LAST_PROJECT;
  const allowed = isLastStep || hasFinal;

  // ✅ FORÇAGE : hors dernière étape => on cache toujours les résultats
  if (!isLastStep) MODEL.ui.resultsShown = false;

  ensureToggleButton();
  btnToggleResults.disabled = !allowed;
  btnToggleResults.title = allowed ? "" : "Les résultats sont disponibles à la dernière étape ou après finalisation.";
  setToggleLabel();

  const gridEl = $("#mainGrid");
  const resultCard = $("#resultCard");

  // ✅ showCol UNIQUEMENT sur la dernière étape
  const showCol = isLastStep && MODEL.ui.resultsShown;

  if (gridEl) gridEl.classList.toggle("singleCol", !showCol);
  if (resultCard) resultCard.classList.toggle("hiddenCard", !showCol);

  if (!showCol) {
    hideResultsUI();
  } else {
    if (LAST_PROJECT) {
      showResultsUI();
      setFinalContent(LAST_PROJECT);
    } else {
      DOM.resultsEmpty.classList.remove("hidden");
      DOM.results.classList.add("hidden");
    }
  }
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
    return !!ans.use_case && !!ans.emplacement && !!ans.objective && Number.isFinite(d) && d > 0;
  }

  function buildRecoForBlock(blk) {
    if (!canRecommendBlock(blk)) return null;
    const ans = blk.answers;
    return recommendCameraForAnswers({
      use_case: ans.use_case,
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

  function camPickCardHTML(blk, cam, label) {
    const isValidated = blk.validated && blk.selectedCameraId === cam.id;

    const code = cam.id || "—";
    const range = cam.brand_range || "—";
    const lowLight = cam.low_light_raw || (cam.low_light ? "Oui" : "Non");
    const ai = cam.analytics_level || "—";
    const focal = `Focale ${cam.focal_min_mm ?? "—"}${cam.focal_max_mm ? `-${cam.focal_max_mm}` : ""}mm`;

    return `
      <div class="cameraPickCard">
        <div class="cameraPickTop">
          ${cam.image_url ? `<img class="cameraPickImg" src="${cam.image_url}" alt="">` : `<div class="cameraPickImg"></div>`}

          <div class="cameraPickMeta">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <strong>${safeHtml(code)} — ${safeHtml(cam.name)}</strong>
            </div>

            <div class="badgeRow" style="margin-top:8px">
              ${badgeHtml(label)}
              ${badgeHtml(range)}
              ${badgeHtml(`Low light: ${lowLight}`)}
              ${badgeHtml(`IA: ${ai}`)}
              ${isValidated ? badgeHtml("✅ Validé") : ""}
            </div>

            <div class="badgeRow" style="margin-top:10px">
              ${badgeHtml(`${safeHtml(cam.type)} • ${cam.resolution_mp ?? "—"}MP`)}
              ${badgeHtml(focal)}
              ${cam.microphone ? badgeHtml("Micro: Oui") : ""}
              ${cam.ip ? badgeHtml(`IP${cam.ip}`) : ""}
              ${cam.ik ? badgeHtml(`IK${cam.ik}`) : ""}
            </div>

            <div style="margin-top:10px">
              ${doriBadgesHTML(cam)}
            </div>

            <div class="cameraPickActions" style="margin-top:10px">
              <button data-action="validateCamera" data-camid="${safeHtml(cam.id)}" class="btnPrimary btnSmall">Je valide cette caméra</button>
              ${cam.datasheet_url ? `<a class="btnGhost btnSmall" style="text-decoration:none" href="${cam.datasheet_url}" target="_blank" rel="noreferrer">📄 Fiche Technique</a>` : ``}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderStepCameras() {
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
              <div class="recoName">Bloc caméra ${idx + 1} • ${blk.validated ? "✅ Validé" : "⏳ En cours"} ${isActive ? `<span style="margin-left:8px" class="badgePill">Actif</span>` : ""}</div>
              <div class="muted">Remplis ici → puis choisis/valides la caméra à droite</div>
            </div>
            <div class="score">${blk.qty || 1}x</div>
          </div>

          <div class="kv" style="margin-top:10px">
            <div>
              <strong>Use case</strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="use_case"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
                <option value="">— choisir —</option>
                ${useCases
                  .map(
                    (u) =>
                      `<option value="${safeHtml(u)}" ${ans.use_case === u ? "selected" : ""}>${safeHtml(u)}</option>`
                  )
                  .join("")}
              </select>
            </div>

            <div>
              <strong>Emplacement de la caméra</strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="emplacement"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
                <option value="interieur" ${normalizeEmplacement(ans.emplacement) === "interieur" ? "selected" : ""}>Intérieur</option>
                <option value="exterieur" ${normalizeEmplacement(ans.emplacement) === "exterieur" ? "selected" : ""}>Extérieur</option>
              </select>
            </div>

            <div>
              <strong>Objectif de la caméra</strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="objective"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
                <option value="">— choisir —</option>
                <option value="dissuasion" ${ans.objective === "dissuasion" ? "selected" : ""}>Dissuasion</option>
                <option value="detection" ${ans.objective === "detection" ? "selected" : ""}>Détection</option>
                <option value="identification" ${ans.objective === "identification" ? "selected" : ""}>Identification</option>
              </select>
            </div>

            <div>
              <strong>Distance max (m)</strong>
              <input data-action="inputBlockField" data-bid="${safeHtml(blk.id)}" data-field="distance_m" type="number" min="1" max="999"
                value="${safeHtml(ans.distance_m ?? "")}" placeholder="ex: 23"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)" />
              <div class="muted" style="margin-top:6px">
                DORI utilisé : ${safeHtml(ans.objective ? objectiveLabel(ans.objective) : "—")} (${safeHtml(ans.objective ? objectiveToDoriKey(ans.objective) : "…")}).
              </div>
            </div>

            <div>
              <strong>Type de pose</strong>
              <select data-action="changeBlockField" data-bid="${safeHtml(blk.id)}" data-field="mounting"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
                <option value="wall" ${ans.mounting === "wall" ? "selected" : ""}>Mur</option>
                <option value="ceiling" ${ans.mounting === "ceiling" ? "selected" : ""}>Plafond</option>
              </select>
            </div>

            <div>
              <strong>Quantité</strong>
              <input data-action="inputBlockQty" data-bid="${safeHtml(blk.id)}" type="number" min="1" max="999"
                value="${safeHtml(blk.qty ?? 1)}"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)" />
            </div>

            <div>
              <strong>Qualité (impact débit/stockage)</strong>
              <select data-action="changeBlockQuality" data-bid="${safeHtml(blk.id)}"
                style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
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
                : `Remplis : <strong>Use case</strong> + <strong>Emplacement</strong> + <strong>Objectif</strong> + <strong>Distance</strong> pour afficher les propositions.`
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
      rightHtml += `<div class="recoCard" style="padding:12px"><div class="muted">Remplis les critères du bloc actif (use case / emplacement / objectif / distance) pour afficher les caméras.</div></div>`;
    } else {
      const primary = reco?.primary?.camera || null;
      const alternatives = (reco?.alternatives || []).map((x) => x.camera);

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
        rightHtml += `
          <div>
            ${camPickCardHTML(activeBlock, primary, "Recommandée")}
            ${alternatives.map((c) => camPickCardHTML(activeBlock, c, "Alternative")).join("")}
          </div>
        `;
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
                        style="width:160px;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)" />
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
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
        </div>
        <div>
          <strong>Heures/jour</strong>
          <input data-action="recHours" type="number" min="1" max="24" value="${rec.hoursPerDay}"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
        </div>
        <div>
          <strong>FPS</strong>
          <select data-action="recFps"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
            ${[10, 12, 15, 20, 25].map((v) => `<option value="${v}" ${rec.fps === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div>
          <strong>Codec</strong>
          <select data-action="recCodec"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
            <option value="h265" ${rec.codec === "h265" ? "selected" : ""}>H.265</option>
            <option value="h264" ${rec.codec === "h264" ? "selected" : ""}>H.264</option>
          </select>
        </div>
        <div>
          <strong>Mode</strong>
          <select data-action="recMode"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
            <option value="continuous" ${rec.mode === "continuous" ? "selected" : ""}>Continu</option>
            <option value="motion" ${rec.mode === "motion" ? "selected" : ""}>Détection (approx.)</option>
          </select>
        </div>
        <div>
          <strong>Marge (%)</strong>
          <input data-action="recOver" type="number" min="0" max="100" value="${rec.overheadPct}"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
        </div>
        <div>
          <strong>Réserve ports PoE (%)</strong>
          <input data-action="recReserve" type="number" min="0" max="50" value="${rec.reservePortsPct}"
            style="width:100%;margin-top:6px;padding:8px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);color:var(--text)">
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

function render() {
  _renderProjectCache = null; // reset cache pour ce render
  ensureToggleButton();

  if (!DOM.stepsEl) {
    console.error("DOM.stepsEl (#steps) introuvable dans le HTML");
    return;
  }

  // ✅ IMPORTANT : on vide avant de re-rendre
  DOM.stepsEl.innerHTML = "";

  const step = STEPS[MODEL.stepIndex];

  const wrapper = document.createElement("div");
  wrapper.className = "step";
  wrapper.innerHTML = `
    <div class="stepTitle">
      <strong>${safeHtml(step.title)}</strong>
      <span class="badge">${safeHtml(step.badge)}</span>
    </div>
    <div class="help">${safeHtml(step.help)}</div>
    <div id="stepBody"></div>
  `;

  const body = $("#stepBody", wrapper);

  if (step.id === "cameras") body.innerHTML = renderStepCameras();
  else if (step.id === "mounts") body.innerHTML = renderStepAccessories();
  else if (step.id === "nvr_network") body.innerHTML = renderStepNvrNetwork();
  else if (step.id === "storage") body.innerHTML = renderStepStorage();

  DOM.stepsEl.appendChild(wrapper);

  if (DOM.btnCompute) {
    DOM.btnCompute.textContent = (MODEL.stepIndex < STEPS.length - 1) ? "Suivant" : "Finaliser";
  }

  updateProgress();
  syncResultsUI();
}


  // ==========================================================
  // 11) EVENTS (delegation)
  // ==========================================================
  function invalidateIfNeeded(blk) {
    if (blk?.validated) unvalidateBlock(blk);
  }

 function onStepsClick(e) {
  const el = e.target?.closest?.("[data-action]");
  if (!el) return;

  const action = el.getAttribute("data-action");

  if (action === "setActiveBlock") {
    const bid = el.getAttribute("data-bid");
    if (bid) MODEL.ui.activeBlockId = bid;
    render();
    return;
  }

  if (action === "addBlock") {
    const nb = createEmptyCameraBlock();
    MODEL.cameraBlocks.push(nb);
    MODEL.ui.activeBlockId = nb.id;
    render();
    return;
  }

  if (action === "removeBlock") {
    const bid = el.getAttribute("data-bid");
    const idx = MODEL.cameraBlocks.findIndex((b) => b.id === bid);
    if (idx >= 0) {
      const blk = MODEL.cameraBlocks[idx];
      if (blk.validated) unvalidateBlock(blk);
      MODEL.cameraBlocks.splice(idx, 1);
      if (!MODEL.cameraBlocks.length) MODEL.cameraBlocks = [createEmptyCameraBlock()];
      MODEL.ui.activeBlockId = MODEL.cameraBlocks[0].id;
      render();
    }
    return;
  }

  if (action === "unvalidateBlock") {
    const bid = el.getAttribute("data-bid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (blk) {
      unvalidateBlock(blk);
      render();
    }
    return;
  }

  if (action === "validateCamera") {
    const camId = el.getAttribute("data-camid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === MODEL.ui.activeBlockId);
    if (!blk) return;
    const reco = buildRecoForBlock(blk);
    validateBlock(blk, reco, camId);
    render();
    return;
  }

  if (action === "recalcAccessories") {
    suggestAccessories();
    render();
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
    blk.qty = clampInt(el.value, 1, 999);
    MODEL.ui.activeBlockId = bid;
    render();
    return;
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

  // 3) Paramètres d’enregistrement
  if (action === "recDays")    { MODEL.recording.daysRetention   = clampInt(el.value, 1, 365); render(); return; }
  if (action === "recHours")   { MODEL.recording.hoursPerDay     = clampInt(el.value, 1, 24);  render(); return; }
  if (action === "recOver")    { MODEL.recording.overheadPct     = clampInt(el.value, 0, 100); render(); return; }
  if (action === "recReserve") { MODEL.recording.reservePortsPct = clampInt(el.value, 0, 50);  render(); return; }
  if (action === "recFps")     { MODEL.recording.fps             = parseInt(el.value, 10);     render(); return; }
  if (action === "recCodec")   { MODEL.recording.codec           = el.value;                   render(); return; }
  if (action === "recMode")    { MODEL.recording.mode            = el.value;                   render(); return; }
}


  function onStepsInput(e) {
  // ✅ Toujours viser l’élément qui porte data-action
  const el = e.target?.closest?.("[data-action]");
  if (!el) return;

  const action = el.getAttribute("data-action");
  if (!action) return;

  // 1) Champs du bloc caméra
  if (action === "inputBlockField") {
    const bid = el.getAttribute("data-bid");
    const field = el.getAttribute("data-field");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk) return;

    invalidateIfNeeded(blk);

    const v = el.value;

    if (field === "distance_m") {
      blk.answers[field] = String(v ?? "").replace(/[^\d]/g, "");
    } else {
      blk.answers[field] = v;
    }

    MODEL.ui.activeBlockId = bid;
    return; // pas de render pendant frappe
  }

  if (action === "inputBlockQty") {
    const bid = el.getAttribute("data-bid");
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk) return;

    invalidateIfNeeded(blk);

    blk.qty = String(el.value ?? "").replace(/[^\d]/g, "");
    MODEL.ui.activeBlockId = bid;
    return;
  }

  // 2) Accessoires
  if (action === "accQty") {
    const bid = el.getAttribute("data-bid");
    const li = parseInt(el.getAttribute("data-li"), 10);
    const blk = MODEL.cameraBlocks.find((b) => b.id === bid);
    if (!blk || !blk.accessories || !blk.accessories[li]) return;

    blk.accessories[li].qty = clampInt(el.value, 1, 999);
    rebuildAccessoryLinesFromBlocks();
    return;
  }

  // 3) Paramètres d’enregistrement (stock brut pendant saisie)
  if (action === "recDays")    { MODEL.recording.daysRetention   = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
  if (action === "recHours")   { MODEL.recording.hoursPerDay     = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
  if (action === "recOver")    { MODEL.recording.overheadPct     = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
  if (action === "recReserve") { MODEL.recording.reservePortsPct = String(el.value ?? "").replace(/[^\d]/g, ""); return; }
}

  // ==========================================================
  // 12) EXPORT
  // ==========================================================

  function toCsv(exportObj) {
    const rows = [];
    rows.push("field,value");

    const proj = exportObj.output;
    rows.push(`totalCameras,${proj.totalCameras}`);
    rows.push(`totalInMbps,${proj.totalInMbps.toFixed(2)}`);
    rows.push(`requiredTB,${proj.requiredTB.toFixed(2)}`);
    rows.push(`nvr_id,${proj.nvrPick.nvr?.id ?? ""}`);
    rows.push(`nvr_name,"${String(proj.nvrPick.nvr?.name ?? "").replace(/"/g, '""')}"`);
    rows.push(`switch_required,${proj.switches.required}`);
    rows.push(`switch_portsNeeded,${proj.switches.portsNeeded ?? ""}`);
    rows.push(`switch_totalPorts,${proj.switches.totalPorts ?? ""}`);

    return rows.join("\n");
  }
  async function exportProjectPdfPro() {
  const proj = LAST_PROJECT || computeProject();
  LAST_PROJECT = proj;

  // container offscreen (pas display:none)
  const host = document.createElement("div");
  host.id = "pdfHost";
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "794px";
  host.style.background = "#fff";
  host.innerHTML = buildPdfHtml(proj);
  document.body.appendChild(host);

  // ✅ cible le vrai root (plus fiable)
  const root = host.querySelector("#pdfReportRoot") || host;

  // attendre fonts/images
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {}

  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );

  if (typeof window.html2pdf !== "function") {
    host.remove();
    alert("html2pdf n'est pas chargé. Vérifie le script CDN dans ton HTML.");
    return;
  }

  const now = new Date();
  const filename = `rapport_configurateur_${now.toISOString().slice(0, 10)}.pdf`;

  try {
    await window.html2pdf()
      .set({
        margin: 10,
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,          // ✅ évite des rendus pourris
          backgroundColor: "#ffffff",
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(root)
      .save();
  } finally {
    host.remove();
  }
}

  // ==========================================================
// 13) NAV / BUTTONS (safe bindings)
// ==========================================================
function bind(el, evt, fn) {
  if (!el) return;
  el.addEventListener(evt, fn);
}

bind(DOM.btnCompute, "click", () => {
  const step = STEPS[MODEL.stepIndex].id;

  if (step === "cameras") {
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

  if (step === "mounts") {
    MODEL.stepIndex++;
    MODEL.ui.resultsShown = false;
    syncResultsUI();
    render();
    return;
  }

  if (step === "nvr_network") {
    MODEL.stepIndex++;
    MODEL.ui.resultsShown = false;
    syncResultsUI();
    render();
    return;
  }

  // Finaliser
  const proj = computeProject();
  LAST_PROJECT = proj;

  setFinalContent(proj);
  MODEL.ui.resultsShown = true;
  syncResultsUI();
});

bind(DOM.btnReset, "click", () => {
  MODEL.cameraBlocks = [createEmptyCameraBlock()];
  MODEL.cameraLines = [];
  MODEL.accessoryLines = [];
  MODEL.recording = {
    daysRetention: 14,
    hoursPerDay: 24,
    fps: 15,
    codec: "h265",
    mode: "continuous",
    overheadPct: 20,
    reservePortsPct: 10,
  };
  MODEL.ui.activeBlockId = MODEL.cameraBlocks[0].id;
  MODEL.ui.resultsShown = false;
  MODEL.stepIndex = 0;
  LAST_PROJECT = null;

  syncResultsUI();
  render();
});

bind(DOM.btnDemo, "click", () => {
  MODEL.cameraLines = [];
  MODEL.accessoryLines = [];

  const useCases = getAllUseCases();
  const demoUseCase = useCases[0] || "";

  const b1 = createEmptyCameraBlock();
  b1.qty = 8;
  b1.quality = "high";
  b1.answers.use_case = demoUseCase;
  b1.answers.emplacement = "exterieur";
  b1.answers.objective = "identification";
  b1.answers.distance_m = 18;
  b1.answers.mounting = "wall";

  const b2 = createEmptyCameraBlock();
  b2.qty = 16;
  b2.quality = "standard";
  b2.answers.use_case = demoUseCase;
  b2.answers.emplacement = "interieur";
  b2.answers.objective = "dissuasion";
  b2.answers.distance_m = 8;
  b2.answers.mounting = "ceiling";

  MODEL.cameraBlocks = [b1, b2];
  MODEL.ui.activeBlockId = b1.id;

  const r1 = recommendCameraForAnswers(b1.answers);
  const r2 = recommendCameraForAnswers(b2.answers);
  validateBlock(b1, r1);
  validateBlock(b2, r2);

  suggestAccessories();
  MODEL.stepIndex = 0;
  LAST_PROJECT = null;
  MODEL.ui.resultsShown = false;

  syncResultsUI();
  render();
});

// EXPORT (PDF + EXCEL)
bind(DOM.btnExportPdf, "click", exportProjectPdfPro);
bind(DOM.btnExportXlsx, "click", () => {
  alert("Export Excel pas encore branché (XLSX). Dis-moi et je te donne le bloc complet avec images en liens.");
});

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

      const [camsRaw, nvrsRaw, hddsRaw, swRaw, accRaw] = await Promise.all([
        loadCsv("/data/cameras.csv"),
        loadCsv("/data/nvrs.csv"),
        loadCsv("/data/hdds.csv"),
        loadCsv("/data/switches.csv"),
        loadCsv("/data/accessories.csv"),
      ]);

      CATALOG.CAMERAS = camsRaw.map(normalizeCamera).filter((c) => c.id);
      CATALOG.NVRS = nvrsRaw.map(normalizeNvr).filter((n) => n.id);
      CATALOG.HDDS = hddsRaw.map(normalizeHdd).filter((h) => h.id);
      CATALOG.SWITCHES = swRaw.map(normalizeSwitch).filter((s) => s.id);

      // ✅ accessories.csv = MAPPING (camera_id => junction/wall/ceiling)
      const mappings = accRaw.map(normalizeAccessoryMapping).filter(Boolean);
      CATALOG.ACCESSORIES_MAP = new Map(mappings.map((m) => [m.cameraId, m]));

      if (DOM.dataStatusEl) {
        DOM.dataStatusEl.textContent =
          `Données chargées ✅ Caméras: ${CATALOG.CAMERAS.length} • NVR: ${CATALOG.NVRS.length} • HDD: ${CATALOG.HDDS.length} • Switch: ${CATALOG.SWITCHES.length} • Mappings accessoires: ${CATALOG.ACCESSORIES_MAP.size}`;
      }

      if (!MODEL.cameraBlocks.length) MODEL.cameraBlocks = [createEmptyCameraBlock()];
      MODEL.ui.activeBlockId = MODEL.cameraBlocks[0].id;

      LAST_PROJECT = null;
      MODEL.ui.resultsShown = false;

      syncResultsUI();
      render();
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
    throw new Error(`Login refusé (${res.status}) ${t}`);
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

  if (msg) msg.textContent = "✅ Chargé";
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

  // ✅ Recharger les données dans le configurateur après save
  try {
    await init();
    if (msg) msg.textContent += " • Données rechargées dans le configurateur";
  } catch(e) {
    if (msg) msg.textContent += " • ⚠️ Données sauvegardées, mais reload a échoué (voir console)";
  }
}


function bindAdminPanel(){
  initAdminGridUI();
  const btnAdmin = document.getElementById("btnAdmin");
  const btnClose = admin$("btnAdminClose");
  const btnLogin = admin$("btnAdminLogin");
  const btnLoad = admin$("btnAdminLoad");
  const btnSave = admin$("btnAdminSave");
  const btnLogout = admin$("btnAdminLogout");
  const sel = admin$("adminCsvSelect");
  const ta = admin$("adminCsvText");
  const pwd = admin$("adminPassword");

  if (btnAdmin) btnAdmin.addEventListener("click", () => {
    adminShow(true);
    setAdminMode(!!ADMIN_TOKEN);
  });

  if (btnClose) btnClose.addEventListener("click", () => adminShow(false));

  // fermer si clic backdrop
  const modal = admin$("adminModal");
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
      if (msg) msg.textContent = `❌ ${e.message}`;
    }
  });

  if (btnLoad) btnLoad.addEventListener("click", async () => {
    try {
      const name = sel?.value || "cameras";
      await adminLoadCsv(name);
    } catch(e) {
      const msg = admin$("adminMsg");
      if (msg) msg.textContent = `❌ ${e.message}`;
    }
  });

  if (btnSave) btnSave.addEventListener("click", async () => {
    try {
      const name = sel?.value || "cameras";
      await adminSaveCsv(name, ta?.value || "");
    } catch(e) {
      const msg = admin$("adminMsg");
      if (msg) msg.textContent = `❌ ${e.message}`;
    }
  });

  if (btnLogout) btnLogout.addEventListener("click", () => {
    ADMIN_TOKEN = null;
    setAdminMode(false);
    const msg = admin$("adminMsg"); if (msg) msg.textContent = "Déconnecté.";
    const lmsg = admin$("adminLoginMsg"); if (lmsg) lmsg.textContent = "";
    if (pwd) pwd.value = "";
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
function escapeAttr(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---- CSV parse simple (quotes + virgules)
function parseCSVGrid(csvText){
  const text = String(csvText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i=0; i<line.length; i++){
      const ch = line[i];
      const next = line[i+1];

      if (ch === '"' && inQuotes && next === '"'){
        cur += '"'; i++; continue;
      }
      if (ch === '"'){ inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes){
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out;
  };

  const headers = parseLine(lines[0]).map(h => String(h ?? "").trim());
  const rows = [];

  for (let i=1; i<lines.length; i++){
    const cols = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = String(cols[idx] ?? ""));
    rows.push(obj);
  }

  return { headers, rows };
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

  // select row
  mount.querySelectorAll(".adminRow").forEach(tr => {
    tr.addEventListener("click", () => {
      ADMIN_GRID.selectedIndex = Number(tr.dataset.row);
      renderAdminGrid();
    });
  });

  // edit cell
  mount.querySelectorAll(".adminCell").forEach(inp => {
    inp.addEventListener("input", () => {
      const r = Number(inp.dataset.row);
      const c = inp.dataset.col;
      if (!ADMIN_GRID.rows[r]) return;
      ADMIN_GRID.rows[r][c] = inp.value;
      syncExpertTextareaIfOpen();
    });
  });

  syncGridMeta();
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
})();
