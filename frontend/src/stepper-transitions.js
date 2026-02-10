/* ============================================================
   STEPPER ANIMATIONS + UNDO / REDO
   Configurateur Vidéosurveillance — COMELIT
   
   📌 INTÉGRATION :
   Dans main.js, ajouter :
     import "./stepper-transitions.css";
     // Après app.js :
     import("./stepper-transitions.js");
   
   📌 PRÉREQUIS :
   - window._MODEL et window._STEPS exposés (cf. guide récap)
   ============================================================ */

(() => {
  "use strict";

  // ==========================================================
  // 1. UNDO / REDO — Pile d'historique du MODEL
  // ==========================================================

  const HISTORY_MAX = 30;
  let _undoStack = [];
  let _redoStack = [];
  let _lastSnap = null;

  /** Deep clone léger du MODEL (sans fonctions) */
  function cloneModel() {
    if (!window._MODEL) return null;
    const m = window._MODEL;
    try {
      return JSON.parse(JSON.stringify({
        projectName: m.projectName,
        projectUseCase: m.projectUseCase,
        cameraBlocks: m.cameraBlocks,
        cameraLines: m.cameraLines,
        accessoryLines: m.accessoryLines,
        recording: m.recording,
        complements: m.complements,
        stepIndex: m.stepIndex,
        ui: {
          activeBlockId: m.ui?.activeBlockId,
          resultsShown: m.ui?.resultsShown,
          mode: m.ui?.mode,
          onlyFavs: m.ui?.onlyFavs,
          favorites: m.ui?.favorites,
          compare: m.ui?.compare,
          previewByBlock: m.ui?.previewByBlock,
        },
      }));
    } catch { return null; }
  }

  /** Restaure un snapshot dans MODEL */
  function applySnapshot(snap) {
    if (!window._MODEL || !snap) return;
    const m = window._MODEL;
    m.projectName = snap.projectName ?? m.projectName;
    m.projectUseCase = snap.projectUseCase ?? m.projectUseCase;
    m.cameraBlocks = snap.cameraBlocks ?? m.cameraBlocks;
    m.cameraLines = snap.cameraLines ?? m.cameraLines;
    m.accessoryLines = snap.accessoryLines ?? m.accessoryLines;
    m.recording = snap.recording ?? m.recording;
    m.complements = snap.complements ?? m.complements;
    m.stepIndex = snap.stepIndex ?? m.stepIndex;
    if (snap.ui) {
      m.ui.activeBlockId = snap.ui.activeBlockId ?? m.ui.activeBlockId;
      m.ui.resultsShown = snap.ui.resultsShown ?? m.ui.resultsShown;
      m.ui.mode = snap.ui.mode ?? m.ui.mode;
      m.ui.onlyFavs = snap.ui.onlyFavs ?? m.ui.onlyFavs;
      m.ui.favorites = snap.ui.favorites ?? m.ui.favorites;
      m.ui.compare = snap.ui.compare ?? m.ui.compare;
      m.ui.previewByBlock = snap.ui.previewByBlock ?? m.ui.previewByBlock;
    }
  }

  /** Pousse l'état courant sur la pile undo (appelé AVANT chaque action) */
  function pushUndo() {
    const snap = cloneModel();
    if (!snap) return;

    // Éviter les doublons consécutifs
    if (_lastSnap && JSON.stringify(snap) === JSON.stringify(_lastSnap)) return;

    _undoStack.push(snap);
    if (_undoStack.length > HISTORY_MAX) _undoStack.shift();
    _redoStack = []; // On efface le redo à chaque nouvelle action
    _lastSnap = snap;

    updateUndoRedoButtons();
  }

  /** Undo : restaure l'état précédent */
  function doUndo() {
    if (!_undoStack.length) return;
    const current = cloneModel();
    if (current) _redoStack.push(current);
    
    const prev = _undoStack.pop();
    applySnapshot(prev);
    _lastSnap = prev;

    triggerRender();
    updateUndoRedoButtons();
    showMiniToast("↩ Annulé");
  }

  /** Redo : restaure l'état suivant */
  function doRedo() {
    if (!_redoStack.length) return;
    const current = cloneModel();
    if (current) _undoStack.push(current);

    const next = _redoStack.pop();
    applySnapshot(next);
    _lastSnap = next;

    triggerRender();
    updateUndoRedoButtons();
    showMiniToast("↪ Rétabli");
  }

  function triggerRender() {
    // Invalider le cache
    if (typeof window._renderProjectCache !== "undefined") window._renderProjectCache = null;
    if (typeof render === "function") render();
    else if (typeof window.render === "function") window.render();
  }


  // ==========================================================
  // 2. UNDO/REDO UI — Boutons dans le navActions
  // ==========================================================

  function injectUndoRedoButtons() {
    const nav = document.querySelector(".navActions");
    if (!nav || document.getElementById("btnUndo")) return;

    // Créer le groupe de boutons
    const group = document.createElement("div");
    group.className = "undoRedoGroup";
    group.innerHTML = `
      <button id="btnUndo" class="btn btnGhost undoRedoBtn" type="button" title="Annuler (Ctrl+Z)" disabled>
        <span class="undoRedoIcon">↩</span>
      </button>
      <button id="btnRedo" class="btn btnGhost undoRedoBtn" type="button" title="Rétablir (Ctrl+Y)" disabled>
        <span class="undoRedoIcon">↪</span>
      </button>
    `;

    // Insérer avant le bouton Reset
    const btnReset = document.getElementById("btnReset");
    if (btnReset) {
      nav.insertBefore(group, btnReset);
    } else {
      nav.appendChild(group);
    }

    // Bind
    document.getElementById("btnUndo").addEventListener("click", doUndo);
    document.getElementById("btnRedo").addEventListener("click", doRedo);
  }

  function updateUndoRedoButtons() {
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    if (btnUndo) btnUndo.disabled = _undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = _redoStack.length === 0;
  }


  // ==========================================================
  // 3. KEYBOARD SHORTCUTS — Ctrl+Z / Ctrl+Y
  // ==========================================================

  document.addEventListener("keydown", (e) => {
    // Ignore si dans un input/textarea/select
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;

    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      doRedo();
    }
  });


  // ==========================================================
  // 4. STEP TRANSITIONS — Animation slide/fade entre étapes
  // ==========================================================

  let _prevStepIndex = -1;

  function animateStepTransition() {
    const stepsEl = document.getElementById("steps");
    if (!stepsEl) return;

    const currentIndex = window._MODEL?.stepIndex ?? 0;
    
    // Déterminer la direction
    const direction = currentIndex > _prevStepIndex ? "next" : "prev";
    _prevStepIndex = currentIndex;

    // Appliquer l'animation
    stepsEl.classList.remove("stepSlideInNext", "stepSlideInPrev", "stepFadeIn");
    void stepsEl.offsetWidth; // force reflow

    if (direction === "next") {
      stepsEl.classList.add("stepSlideInNext");
    } else {
      stepsEl.classList.add("stepSlideInPrev");
    }

    // Cleanup après animation
    const onEnd = () => {
      stepsEl.classList.remove("stepSlideInNext", "stepSlideInPrev", "stepFadeIn");
      stepsEl.removeEventListener("animationend", onEnd);
    };
    stepsEl.addEventListener("animationend", onEnd, { once: true });
  }


  // ==========================================================
  // 5. HOOK INTO RENDER — Capturer les changements
  // ==========================================================

  function hookRender() {
    if (typeof window.render !== "function" || window._transitionHooked) return;

    const originalRender = window.render;
    window.render = function () {
      // Push undo AVANT le render (capture l'état avant modification)
      pushUndo();

      originalRender.apply(this, arguments);

      // Animation après le render
      animateStepTransition();

      // S'assurer que les boutons undo/redo existent
      injectUndoRedoButtons();
      updateUndoRedoButtons();
    };

    window._transitionHooked = true;
  }

  // Si render() est déjà wrappé par le récap flottant, on le re-wrappe par-dessus
  function hookRenderSafe() {
    if (window._transitionHooked) return;

    const tryHook = () => {
      if (typeof window.render === "function") {
        hookRender();
      } else {
        setTimeout(tryHook, 200);
      }
    };
    tryHook();
  }


  // ==========================================================
  // 6. SWIPE NAVIGATION — Geste tactile entre étapes
  // ==========================================================

  function setupSwipeNavigation() {
    const stepsEl = document.getElementById("steps");
    if (!stepsEl) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    stepsEl.addEventListener("touchstart", (e) => {
      // Ignorer si on touche un input, bouton, slider, etc.
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select", "button", "a"].includes(tag)) return;
      if (e.target.closest("button, a, input, select, textarea, .cameraPickCard details")) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    stepsEl.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - startX;
      const dy = endY - startY;

      // Seuil minimum et priorité horizontale
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return;

      const m = window._MODEL;
      const steps = window._STEPS;
      if (!m || !steps) return;

      if (dx < -60 && m.stepIndex < steps.length - 1) {
        // Swipe gauche → étape suivante
        // Vérifier si on peut avancer (simuler le clic sur btnCompute)
        const btnCompute = document.getElementById("btnCompute");
        if (btnCompute && !btnCompute.disabled) {
          btnCompute.click();
        }
      } else if (dx > 60 && m.stepIndex > 0) {
        // Swipe droite → étape précédente
        const btnPrev = document.getElementById("btnPrev");
        if (btnPrev) btnPrev.click();
      }
    }, { passive: true });
  }


  // ==========================================================
  // 7. MINI TOAST — Feedback léger pour undo/redo
  // ==========================================================

  function showMiniToast(msg) {
    let toast = document.getElementById("undoToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "undoToast";
      toast.className = "undoToast";
      document.body.appendChild(toast);
    }

    toast.textContent = msg;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove("show"), 1500);
  }


  // ==========================================================
  // 8. INIT
  // ==========================================================

  function init() {
    hookRenderSafe();
    setupSwipeNavigation();
    injectUndoRedoButtons();

    // Initialiser l'index précédent
    _prevStepIndex = window._MODEL?.stepIndex ?? 0;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 600));
  } else {
    setTimeout(init, 600);
  }

})();
