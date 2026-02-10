/* ============================================================
   FLOATING RECAP BAR + SAVE/LOAD CONFIG
   Configurateur Vidéosurveillance — COMELIT
   
   📌 INTÉGRATION :
   Ce fichier doit être importé APRÈS app.js (ou collé à la fin de app.js)
   Il utilise les globales existantes : MODEL, STEPS, render(), etc.
   
   📌 DANS main.js, ajouter :
   import "./floating-recap.css";
   // Puis après import("./app.js") :
   import("./floating-recap.js");
   
   ============================================================ */

(() => {
  "use strict";

  // ==========================================================
  // 1. CONFIGURATION
  // ==========================================================
  const SAVE_KEY = "comelit_saved_configs";
  const MAX_SAVES = 10;

  // ==========================================================
  // 2. HELPERS — accès sécurisé aux globales de app.js
  // ==========================================================

  /** Attend que MODEL soit disponible (app.js chargé) */
  function waitForModel(cb, maxRetries = 50) {
    let tries = 0;
    const check = () => {
      // MODEL est dans une IIFE de app.js — on y accède via les fonctions exposées
      // On vérifie que render() est dispo (signe que app.js est initialisé)
      if (typeof render === "function" || document.querySelector(".stepperStep")) {
        cb();
      } else if (tries++ < maxRetries) {
        setTimeout(check, 100);
      }
    };
    check();
  }

  /** Compte total de caméras validées */
  function getTotalCameras() {
    try {
      const lines = window._MODEL?.cameraLines || [];
      return lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
    } catch { return 0; }
  }

  /** Compte de blocs validés */
  function getValidatedBlocks() {
    try {
      return (window._MODEL?.cameraBlocks || []).filter(b => b.validated).length;
    } catch { return 0; }
  }

  /** Compte d'accessoires */
  function getTotalAccessories() {
    try {
      return (window._MODEL?.accessoryLines || []).reduce((sum, a) => sum + (Number(a.qty) || 0), 0);
    } catch { return 0; }
  }

  /** Étape courante */
  function getCurrentStep() {
    try {
      const idx = window._MODEL?.stepIndex ?? 0;
      const steps = window._STEPS || [];
      return { index: idx, total: steps.length, data: steps[idx] || null };
    } catch { return { index: 0, total: 6, data: null }; }
  }

  /** Nom du projet */
  function getProjectName() {
    try {
      return window._MODEL?.projectName || "";
    } catch { return ""; }
  }

  // ==========================================================
  // 3. EXPOSE MODEL — hook dans app.js pour accéder au MODEL
  // ==========================================================
  // 
  // ⚠️  MODEL est dans une IIFE dans app.js, donc pas directement accessible.
  //     SOLUTION : on patch render() pour capturer MODEL à chaque render.
  //     Alternative (plus propre) : ajouter ces 2 lignes dans app.js :
  //
  //       window._MODEL = MODEL;
  //       window._STEPS = STEPS;
  //
  //     Si tu fais ça, supprime le bloc "MONKEY-PATCH" ci-dessous.

  // MONKEY-PATCH : on observe les changements du DOM pour détecter les renders
  // et on lit les infos depuis le DOM directement (approche robuste)

  function readStateFromDOM() {
    // Lire l'étape courante depuis le stepper
    const activeStep = document.querySelector(".stepperStep.active");
    const allSteps = document.querySelectorAll(".stepperStep");
    let stepIndex = 0;
    allSteps.forEach((el, i) => { if (el.classList.contains("active")) stepIndex = i; });

    // Lire le nombre de caméras validées depuis le contenu
    // On cherche les éléments qui indiquent les quantités
    const stepTitle = document.getElementById("stepperTitle")?.textContent || "";

    return { stepIndex, totalSteps: allSteps.length, stepTitle };
  }


  // ==========================================================
  // 4. INJECT HTML — Récap flottant
  // ==========================================================

  function createFloatingRecap() {
    // Vérifier qu'il n'existe pas déjà
    if (document.getElementById("floatingRecap")) return;

    const bar = document.createElement("div");
    bar.id = "floatingRecap";
    bar.className = "floatingRecap";
    bar.innerHTML = `
      <div class="floatingRecap__inner">
        
        <!-- Stats pills -->
        <div class="floatingRecap__stats">
          <div class="floatingRecap__step" id="recapStep">
            <span>Étape 1/6</span>
          </div>
          
          <div class="floatingRecap__pill" id="recapCameras" title="Caméras sélectionnées">
            <span class="pillIcon">📷</span>
            <span class="pillValue" id="recapCamCount">0</span>
            <span class="pillLabel">cam.</span>
          </div>
          
          <div class="floatingRecap__pill" id="recapBlocks" title="Blocs configurés">
            <span class="pillIcon">📍</span>
            <span class="pillValue" id="recapBlockCount">0</span>
            <span class="pillLabel">blocs</span>
          </div>

          <div class="floatingRecap__pill" id="recapAccessories" title="Accessoires" style="display:none">
            <span class="pillIcon">🔧</span>
            <span class="pillValue" id="recapAccCount">0</span>
            <span class="pillLabel">acc.</span>
          </div>
        </div>

        <div class="floatingRecap__divider"></div>

        <!-- Actions -->
        <div class="floatingRecap__actions">
          <button class="floatingRecap__btn floatingRecap__btn--save" id="recapBtnSave" title="Sauvegarder la configuration">
            <span>💾</span>
            <span class="btnText">Sauvegarder</span>
          </button>

          <button class="floatingRecap__btn floatingRecap__btn--load" id="recapBtnLoad" title="Charger une configuration">
            <span>📂</span>
            <span class="btnText">Charger</span>
            <span class="floatingRecap__saveBadge" id="recapSaveBadge" style="display:none">0</span>
          </button>

          <button class="floatingRecap__btn floatingRecap__btn--share" id="recapBtnShare" title="Partager le lien de configuration">
            <span>🔗</span>
            <span class="btnText">Partager</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(bar);
    document.body.classList.add("hasFloatingRecap");

    // Bind events
    document.getElementById("recapBtnSave").addEventListener("click", handleSave);
    document.getElementById("recapBtnLoad").addEventListener("click", handleLoadModal);
    document.getElementById("recapBtnShare").addEventListener("click", handleShare);

    // Show avec animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.classList.add("visible");
      });
    });
  }


  // ==========================================================
  // 5. UPDATE RECAP — appelé à chaque render
  // ==========================================================

  let _prevCamCount = -1;
  let _prevBlockCount = -1;
  let _prevAccCount = -1;

  function updateRecap() {
    const bar = document.getElementById("floatingRecap");
    if (!bar) return;

    // --- Lire les données depuis MODEL (si exposé) ou depuis le DOM ---
    let camCount = 0;
    let blockCount = 0;
    let accCount = 0;
    let stepIndex = 0;
    let totalSteps = 6;
    let stepData = null;

    if (window._MODEL) {
      // Accès direct au MODEL
      camCount = (window._MODEL.cameraLines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
      blockCount = (window._MODEL.cameraBlocks || []).filter(b => b.validated).length;
      accCount = (window._MODEL.accessoryLines || []).reduce((s, a) => s + (Number(a.qty) || 0), 0);
      stepIndex = window._MODEL.stepIndex || 0;
      totalSteps = (window._STEPS || []).length || 6;
      stepData = (window._STEPS || [])[stepIndex];
    } else {
      // Fallback : lire depuis le DOM
      const domState = readStateFromDOM();
      stepIndex = domState.stepIndex;
      totalSteps = domState.totalSteps || 6;

      // Compter les caméras via les lignes du résumé si disponible
      document.querySelectorAll("[data-cam-qty]").forEach(el => {
        camCount += Number(el.dataset.camQty) || 0;
      });
    }

    // --- Mettre à jour les pills ---
    const stepEl = document.getElementById("recapStep");
    if (stepEl) {
      const label = stepData?.title || `Étape ${stepIndex + 1}`;
      stepEl.innerHTML = `<span>${label} (${stepIndex + 1}/${totalSteps})</span>`;
    }

    // Caméras
    const camEl = document.getElementById("recapCamCount");
    if (camEl) {
      camEl.textContent = camCount;
      if (camCount !== _prevCamCount && _prevCamCount >= 0) {
        pulseElement(camEl.closest(".floatingRecap__pill"));
      }
      _prevCamCount = camCount;
    }

    // Blocs
    const blockEl = document.getElementById("recapBlockCount");
    if (blockEl) {
      blockEl.textContent = blockCount;
      if (blockCount !== _prevBlockCount && _prevBlockCount >= 0) {
        pulseElement(blockEl.closest(".floatingRecap__pill"));
      }
      _prevBlockCount = blockCount;
    }

    // Accessoires
    const accPill = document.getElementById("recapAccessories");
    const accEl = document.getElementById("recapAccCount");
    if (accPill && accEl) {
      if (accCount > 0) {
        accPill.style.display = "";
        accEl.textContent = accCount;
        if (accCount !== _prevAccCount && _prevAccCount >= 0) {
          pulseElement(accPill);
        }
      } else {
        accPill.style.display = "none";
      }
      _prevAccCount = accCount;
    }

    // Badge saves count
    updateSaveBadge();
  }

  function pulseElement(el) {
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth; // force reflow
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 500);
  }

  function updateSaveBadge() {
    const badge = document.getElementById("recapSaveBadge");
    if (!badge) return;
    const saves = getSavedConfigs();
    if (saves.length > 0) {
      badge.style.display = "";
      badge.textContent = saves.length;
    } else {
      badge.style.display = "none";
    }
  }


  // ==========================================================
  // 6. SAVE / LOAD CONFIG — localStorage
  // ==========================================================

  function getSavedConfigs() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
    } catch { return []; }
  }

  function setSavedConfigs(configs) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(configs));
  }

  /** Snapshot complet du MODEL pour sauvegarde */
  function snapshotModel() {
    if (!window._MODEL) return null;

    const m = window._MODEL;
    return {
      projectName: m.projectName || "",
      projectUseCase: m.projectUseCase || "",
      cameraBlocks: JSON.parse(JSON.stringify(m.cameraBlocks || [])),
      cameraLines: JSON.parse(JSON.stringify(m.cameraLines || [])),
      accessoryLines: JSON.parse(JSON.stringify(m.accessoryLines || [])),
      recording: JSON.parse(JSON.stringify(m.recording || {})),
      complements: JSON.parse(JSON.stringify(m.complements || {})),
      stepIndex: m.stepIndex || 0,
    };
  }

  /** Restaure un snapshot dans MODEL */
  function restoreSnapshot(snap) {
    if (!window._MODEL || !snap) return false;

    const m = window._MODEL;
    m.projectName = snap.projectName || "";
    m.projectUseCase = snap.projectUseCase || "";
    m.cameraBlocks = snap.cameraBlocks || [];
    m.cameraLines = snap.cameraLines || [];
    m.accessoryLines = snap.accessoryLines || [];
    m.recording = snap.recording || m.recording;
    m.complements = snap.complements || m.complements;
    m.stepIndex = snap.stepIndex || 0;
    m.ui.resultsShown = false;

    return true;
  }

  /** Sauvegarder la config courante */
  function handleSave() {
    const snap = snapshotModel();
    if (!snap) {
      showToast("⚠️ Impossible de sauvegarder (MODEL non accessible)", "warn");
      return;
    }

    const name = snap.projectName?.trim()
      || `Config du ${new Date().toLocaleDateString("fr-FR")}`;

    const camCount = (snap.cameraLines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const blockCount = (snap.cameraBlocks || []).filter(b => b.validated).length;

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      savedAt: new Date().toISOString(),
      camCount,
      blockCount,
      useCase: snap.projectUseCase || "",
      snapshot: snap,
    };

    const configs = getSavedConfigs();

    // Vérifier doublon par nom
    const existingIdx = configs.findIndex(c => c.name === name);
    if (existingIdx >= 0) {
      if (!confirm(`Une configuration "${name}" existe déjà. Écraser ?`)) return;
      configs[existingIdx] = entry;
    } else {
      configs.unshift(entry);
    }

    // Limiter le nombre de sauvegardes
    while (configs.length > MAX_SAVES) configs.pop();

    setSavedConfigs(configs);
    updateSaveBadge();
    showToast(`✅ "${name}" sauvegardé`, "success");

    // KPI
    if (window.KPI?.sendNowait) {
      window.KPI.sendNowait("config_saved", { name, camCount, blockCount });
    }
  }

  /** Charger — affiche le modal */
  function handleLoadModal() {
    const configs = getSavedConfigs();
    showLoadModal(configs);
  }

  /** Charger une config spécifique */
  function loadConfig(entry) {
    if (!entry?.snapshot) return;

    const ok = restoreSnapshot(entry.snapshot);
    if (!ok) {
      showToast("⚠️ Restauration échouée", "warn");
      return;
    }

    // Invalidate render cache
    if (typeof window._renderProjectCache !== "undefined") {
      window._renderProjectCache = null;
    }

    // Refresh complet
    if (typeof render === "function") {
      render();
    } else if (typeof window.render === "function") {
      window.render();
    }

    showToast(`📂 "${entry.name}" chargé`, "success");
    closeLoadModal();

    // KPI
    if (window.KPI?.sendNowait) {
      window.KPI.sendNowait("config_loaded", { name: entry.name });
    }
  }

  /** Supprimer une config sauvegardée */
  function deleteConfig(id) {
    let configs = getSavedConfigs();
    configs = configs.filter(c => c.id !== id);
    setSavedConfigs(configs);
    updateSaveBadge();

    // Refresh modal si ouvert
    const overlay = document.getElementById("cfgModalOverlay");
    if (overlay?.classList.contains("open")) {
      showLoadModal(configs);
    }
  }


  // ==========================================================
  // 7. SHARE — lien encodé
  // ==========================================================

  function handleShare() {
    const snap = snapshotModel();
    if (!snap) {
      showToast("⚠️ Rien à partager", "warn");
      return;
    }

    try {
      // Compresser le snapshot en base64 (version light sans images)
      const light = {
        pn: snap.projectName,
        uc: snap.projectUseCase,
        bl: (snap.cameraBlocks || []).map(b => ({
          id: b.id, lb: b.label, v: b.validated, sc: b.selectedCameraId, q: b.qty, a: b.answers,
        })),
        cl: (snap.cameraLines || []).map(l => ({
          ci: l.cameraId, fb: l.fromBlockId, q: l.qty,
        })),
        al: (snap.accessoryLines || []).map(a => ({
          ai: a.accessoryId, fb: a.fromBlockId, q: a.qty, t: a.type, n: a.name,
        })),
        rc: snap.recording,
        cm: snap.complements,
        si: snap.stepIndex,
      };

      const json = JSON.stringify(light);
      const encoded = btoa(unescape(encodeURIComponent(json)));

      // Si l'URL est trop longue (> 4000 chars), on prévient
      if (encoded.length > 4000) {
        showToast("⚠️ Config trop volumineuse pour un lien. Utilise la sauvegarde.", "warn");
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("cfg", encoded);
      const shareUrl = url.toString();

      // Copier dans le presse-papier
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast("🔗 Lien copié dans le presse-papier !", "success");
        }).catch(() => {
          prompt("Copiez ce lien :", shareUrl);
        });
      } else {
        prompt("Copiez ce lien :", shareUrl);
      }

      // KPI
      if (window.KPI?.sendNowait) {
        window.KPI.sendNowait("config_shared", { urlLength: shareUrl.length });
      }

    } catch (e) {
      console.error("[Share]", e);
      showToast("⚠️ Erreur lors du partage", "warn");
    }
  }

  /** Restaurer depuis un lien partagé (appelé au chargement) */
  function restoreFromURL() {
    try {
      const url = new URL(window.location.href);
      const encoded = url.searchParams.get("cfg");
      if (!encoded) return;

      const json = decodeURIComponent(escape(atob(encoded)));
      const light = JSON.parse(json);

      // Reconstruire le snapshot complet
      const snap = {
        projectName: light.pn || "",
        projectUseCase: light.uc || "",
        cameraBlocks: (light.bl || []).map(b => ({
          id: b.id, label: b.lb, validated: b.v, selectedCameraId: b.sc, qty: b.q, answers: b.a || {},
        })),
        cameraLines: (light.cl || []).map(l => ({
          cameraId: l.ci, fromBlockId: l.fb, qty: l.q,
        })),
        accessoryLines: (light.al || []).map(a => ({
          accessoryId: a.ai, fromBlockId: a.fb, qty: a.q, type: a.t, name: a.n,
        })),
        recording: light.rc || {},
        complements: light.cm || {},
        stepIndex: light.si || 0,
      };

      // Attendre que MODEL soit prêt, puis restaurer
      const tryRestore = () => {
        if (window._MODEL) {
          restoreSnapshot(snap);
          if (typeof render === "function") render();
          else if (typeof window.render === "function") window.render();
          showToast("📂 Configuration restaurée depuis le lien", "success");

          // Nettoyer l'URL
          url.searchParams.delete("cfg");
          window.history.replaceState({}, "", url.toString());
        } else {
          setTimeout(tryRestore, 200);
        }
      };
      tryRestore();

    } catch (e) {
      console.warn("[RestoreURL]", e);
    }
  }


  // ==========================================================
  // 8. MODAL — Charger une config
  // ==========================================================

  function showLoadModal(configs) {
    let overlay = document.getElementById("cfgModalOverlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "cfgModalOverlay";
      overlay.className = "cfgModal__overlay";
      document.body.appendChild(overlay);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeLoadModal();
      });
    }

    const listHtml = configs.length
      ? configs.map(c => {
          const date = new Date(c.savedAt).toLocaleDateString("fr-FR", {
            day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return `
            <div class="cfgModal__item" data-cfg-id="${c.id}">
              <div class="cfgModal__itemInfo" data-cfg-load="${c.id}">
                <div class="cfgModal__itemName">${escapeHtml(c.name)}</div>
                <div class="cfgModal__itemMeta">
                  ${date} · ${c.camCount || 0} cam. · ${c.blockCount || 0} blocs${c.useCase ? ` · ${escapeHtml(c.useCase)}` : ""}
                </div>
              </div>
              <button class="cfgModal__itemDelete" data-cfg-delete="${c.id}" title="Supprimer">🗑️</button>
            </div>
          `;
        }).join("")
      : `<div class="cfgModal__empty">Aucune configuration sauvegardée.<br>Clique sur 💾 Sauvegarder pour en créer une.</div>`;

    overlay.innerHTML = `
      <div class="cfgModal">
        <div class="cfgModal__title">📂 Configurations sauvegardées</div>
        <div class="cfgModal__subtitle">Clique sur une configuration pour la charger.</div>
        <div class="cfgModal__list">${listHtml}</div>
        <div class="cfgModal__footer">
          <button class="cfgModal__btnClose" id="cfgModalClose">Fermer</button>
        </div>
      </div>
    `;

    // Bind events
    overlay.querySelector("#cfgModalClose")?.addEventListener("click", closeLoadModal);

    overlay.querySelectorAll("[data-cfg-load]").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.dataset.cfgLoad;
        const entry = configs.find(c => c.id === id);
        if (entry) loadConfig(entry);
      });
    });

    overlay.querySelectorAll("[data-cfg-delete]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.dataset.cfgDelete;
        if (confirm("Supprimer cette configuration ?")) {
          deleteConfig(id);
        }
      });
    });

    // Show
    requestAnimationFrame(() => overlay.classList.add("open"));
  }

  function closeLoadModal() {
    const overlay = document.getElementById("cfgModalOverlay");
    if (overlay) {
      overlay.classList.remove("open");
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }


  // ==========================================================
  // 9. TOAST
  // ==========================================================

  let _toastTimeout = null;

  function showToast(msg, type = "info") {
    let toast = document.getElementById("cfgToast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "cfgToast";
      document.body.appendChild(toast);
    }

    toast.className = `cfgToast cfgToast--${type}`;
    toast.textContent = msg;

    clearTimeout(_toastTimeout);

    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    _toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 2500);
  }


  // ==========================================================
  // 10. HOOK INTO RENDER — Observer les changements
  // ==========================================================

  function hookIntoRender() {
    // Méthode 1 : Si render() est globale, on la wrappe
    if (typeof window.render === "function" && !window._recapHooked) {
      const originalRender = window.render;
      window.render = function () {
        originalRender.apply(this, arguments);
        updateRecap();
      };
      window._recapHooked = true;
      return;
    }

    // Méthode 2 : MutationObserver sur #steps (le container principal)
    const stepsEl = document.getElementById("steps");
    if (stepsEl) {
      const observer = new MutationObserver(() => {
        updateRecap();
      });
      observer.observe(stepsEl, { childList: true, subtree: true });
    }

    // Méthode 3 : Observer aussi les clics de navigation
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("#btnCompute, #btnPrev, #btnReset, #btnDemo, .stepperStep");
      if (btn) {
        setTimeout(updateRecap, 100);
      }
    });
  }


  // ==========================================================
  // 11. INIT
  // ==========================================================

  function init() {
    createFloatingRecap();
    hookIntoRender();
    updateRecap();

    // Restaurer depuis URL si lien partagé
    restoreFromURL();
  }

  // Lancer quand le DOM est prêt et que app.js a fini de s'initialiser
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

})();
