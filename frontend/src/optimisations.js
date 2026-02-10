/* ============================================================
   OPTIMISATIONS CONFIGURATEUR — COMELIT
   Module unique (évite les conflits de hook render)
   
   ✅ Récap flottant (barre sticky bottom)
   ✅ Sauvegarde / Chargement config (localStorage)
   ✅ Lien partageable
   ✅ Animations slide entre étapes
   ✅ Undo/Redo clavier (Ctrl+Z / Ctrl+Y)
   ✅ Swipe tactile navigation étapes
   ✅ Compare : fix handler manquant + bouton sur cartes
   ✅ Compare enrichi (grille specs avec highlights)
   ✅ Cartes caméra scroll horizontal mobile
   ✅ Validation par étape + bannière
   ✅ Navigation guard (beforeunload)
   ✅ Export catalogue JSON
   
   📌 INTÉGRATION (main.js) :
     import "./optimisations.css";
     import("./app.js").then(() => import("./optimisations.js"));
   
   📌 DANS app.js, ajouter 4 lignes :
     window._MODEL = MODEL;       // après définition MODEL
     window._STEPS = STEPS;       // après définition STEPS
     window._CATALOG = CATALOG;   // après définition CATALOG
     window._getCameraById = getCameraById; // après définition
   ============================================================ */

(() => {
  "use strict";

  // ==========================================================
  // CONFIG
  // ==========================================================
  const SAVE_KEY = "comelit_saved_configs";
  const MAX_SAVES = 10;
  const HISTORY_MAX = 30;

  // ==========================================================
  // 0. SINGLE RENDER HOOK — Un seul wrap pour tout
  // ==========================================================

  const _afterRenderCallbacks = [];

  function registerAfterRender(fn) {
    _afterRenderCallbacks.push(fn);
  }

  function hookRenderOnce() {
    if (typeof window.render !== "function" || window.__optimHooked) return false;

    const originalRender = window.render;
    window.render = function () {
      // Undo push AVANT le render
      undoPush();

      // Render original
      originalRender.apply(this, arguments);

      // Tous les callbacks APRÈS le render
      requestAnimationFrame(() => {
        for (const fn of _afterRenderCallbacks) {
          try { fn(); } catch (e) { console.warn("[optim]", e); }
        }
      });
    };

    window.__optimHooked = true;
    return true;
  }

  // Helper : appeler render sans boucle infinie
  function callOriginalRender() {
    if (typeof window.render === "function") window.render();
  }


  // ==========================================================
  // A. UNDO / REDO (clavier uniquement, invisible)
  // ==========================================================

  let _undoStack = [];
  let _redoStack = [];
  let _lastSnapJSON = "";

  function cloneModel() {
    const m = window._MODEL;
    if (!m) return null;
    try {
      return JSON.parse(JSON.stringify({
        projectName: m.projectName, projectUseCase: m.projectUseCase,
        cameraBlocks: m.cameraBlocks, cameraLines: m.cameraLines,
        accessoryLines: m.accessoryLines, recording: m.recording,
        complements: m.complements, stepIndex: m.stepIndex,
        ui: { activeBlockId: m.ui?.activeBlockId, resultsShown: m.ui?.resultsShown,
              mode: m.ui?.mode, onlyFavs: m.ui?.onlyFavs,
              favorites: m.ui?.favorites, compare: m.ui?.compare,
              previewByBlock: m.ui?.previewByBlock },
      }));
    } catch { return null; }
  }

  function applySnapshot(snap) {
    const m = window._MODEL;
    if (!m || !snap) return;
    Object.assign(m, {
      projectName: snap.projectName ?? m.projectName,
      projectUseCase: snap.projectUseCase ?? m.projectUseCase,
      cameraBlocks: snap.cameraBlocks ?? m.cameraBlocks,
      cameraLines: snap.cameraLines ?? m.cameraLines,
      accessoryLines: snap.accessoryLines ?? m.accessoryLines,
      recording: snap.recording ?? m.recording,
      complements: snap.complements ?? m.complements,
      stepIndex: snap.stepIndex ?? m.stepIndex,
    });
    if (snap.ui) Object.assign(m.ui, snap.ui);
  }

  function undoPush() {
    const snap = cloneModel();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === _lastSnapJSON) return;
    _undoStack.push(JSON.parse(json));
    if (_undoStack.length > HISTORY_MAX) _undoStack.shift();
    _redoStack = [];
    _lastSnapJSON = json;
  }

  function doUndo() {
    if (!_undoStack.length) return;
    const cur = cloneModel();
    if (cur) _redoStack.push(cur);
    applySnapshot(_undoStack.pop());
    _lastSnapJSON = JSON.stringify(cloneModel());
    callOriginalRender();
    showToast("↩ Annulé", "info");
  }

  function doRedo() {
    if (!_redoStack.length) return;
    const cur = cloneModel();
    if (cur) _undoStack.push(cur);
    applySnapshot(_redoStack.pop());
    _lastSnapJSON = JSON.stringify(cloneModel());
    callOriginalRender();
    showToast("↪ Rétabli", "info");
  }

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); doRedo(); }
  });


  // ==========================================================
  // B. STEP TRANSITIONS — Animations slide
  // ==========================================================

  let _prevStepIndex = -1;

  function animateStepTransition() {
    const el = document.getElementById("steps");
    if (!el) return;
    const idx = window._MODEL?.stepIndex ?? 0;
    if (_prevStepIndex === -1) { _prevStepIndex = idx; return; }
    if (idx === _prevStepIndex) return;
    const dir = idx > _prevStepIndex ? "stepSlideInNext" : "stepSlideInPrev";
    _prevStepIndex = idx;
    el.classList.remove("stepSlideInNext", "stepSlideInPrev");
    void el.offsetWidth;
    el.classList.add(dir);
    el.addEventListener("animationend", () => el.classList.remove(dir), { once: true });
  }

  registerAfterRender(animateStepTransition);


  // ==========================================================
  // C. SWIPE NAVIGATION — Entre étapes (pas sur les cartes)
  // ==========================================================

  function setupSwipeNavigation() {
    const main = document.querySelector(".appMain");
    if (!main || main._swipeSetup) return;
    main._swipeSetup = true;

    let sx = 0, sy = 0, tracking = false;

    main.addEventListener("touchstart", (e) => {
      if (e.target.closest("button, a, input, select, textarea, details, .cameraCards--swipeable")) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });

    main.addEventListener("touchend", (e) => {
      if (!tracking) return; tracking = false;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      if (dx < -80) { const b = document.getElementById("btnCompute"); if (b && !b.disabled) b.click(); }
      else if (dx > 80) { const b = document.getElementById("btnPrev"); if (b?.style.display !== "none") b.click(); }
    }, { passive: true });
  }


  // ==========================================================
  // D. COMPARE FIX — Handler manquant + bouton sur cartes
  // ==========================================================

  function fixCompareHandlers() {
    const el = document.getElementById("steps");
    if (!el || el._cmpFixed) return;
    el._cmpFixed = true;

    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const m = window._MODEL;
      if (!m) return;

      if (action === "uiClearCompare") {
        e.stopPropagation();
        m.ui.compare = [];
        callOriginalRender();
        return;
      }

      if (action === "uiToggleCompare") {
        e.stopPropagation();
        const camId = btn.dataset.camid;
        if (!camId) return;
        if (!Array.isArray(m.ui.compare)) m.ui.compare = [];
        const idx = m.ui.compare.indexOf(camId);
        if (idx >= 0) { m.ui.compare.splice(idx, 1); }
        else { if (m.ui.compare.length >= 2) m.ui.compare.shift(); m.ui.compare.push(camId); }
        callOriginalRender();
        return;
      }
    });
  }

  /** Injecte le bouton ⚔️ Comparer sur chaque carte caméra */
  function injectCompareButtons() {
    document.querySelectorAll(".cameraPickCard").forEach(card => {
      if (card.dataset.cmpDone) return;
      card.dataset.cmpDone = "1";
      const vBtn = card.querySelector("[data-action='validateCamera']");
      if (!vBtn) return;
      const camId = vBtn.dataset.camid;
      const actions = card.querySelector(".cameraPickActions");
      if (!actions || !camId) return;

      const isIn = (window._MODEL?.ui?.compare || []).includes(camId);
      const b = document.createElement("button");
      b.className = `btnGhost btnCompare${isIn ? " active" : ""}`;
      b.type = "button";
      b.setAttribute("data-action", "uiToggleCompare");
      b.setAttribute("data-camid", camId);
      b.innerHTML = isIn ? "⚔️ Comparé" : "⚔️ Comparer";
      actions.appendChild(b);
    });
  }

  registerAfterRender(injectCompareButtons);

  /** Remplace le compareCard basique par la version enrichie */
  function enhanceCompareCard() {
    const old = document.querySelector(".compareCard");
    if (!old || old.dataset.enhanced) return;
    
    const cmp = window._MODEL?.ui?.compare || [];
    if (cmp.length < 2) return;
    const getCam = window._getCameraById || ((id) => (window._CATALOG?.CAMERAS || []).find(c => c.id === id));
    const a = getCam(cmp[0]), b = getCam(cmp[1]);
    if (!a || !b) return;

    const esc = (v) => v == null ? "—" : String(v).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    const specs = [
      { l:"Résolution", k:"resolution_mp", u:"MP", i:"📐" },
      { l:"IR", k:"ir_range_m", u:"m", i:"🔦" },
      { l:"DORI Détect.", k:"dori_detection_m", u:"m", i:"👁️" },
      { l:"DORI Identif.", k:"dori_identification_m", u:"m", i:"🔍" },
      { l:"Focale min", k:"focal_min_mm", u:"mm", i:"🔭" },
      { l:"IP", k:"ip", u:"", i:"💧", p:"IP" },
      { l:"IK", k:"ik", u:"", i:"🛡️", p:"IK" },
      { l:"PoE", k:"poe_w", u:"W", i:"⚡" },
      { l:"Analytics", k:"analytics_level", u:"", i:"🤖" },
    ];

    const rows = specs.map(s => {
      const va = a[s.k], vb = b[s.k];
      const fmt = v => (v == null || v === "" || v === 0) ? "—" : `${s.p||""}${v}${s.u?" "+s.u:""}`;
      let ca = "", cb = "";
      if (typeof va === "number" && typeof vb === "number" && va !== vb) {
        const inv = s.k === "poe_w";
        ca = (inv ? va < vb : va > vb) ? "cmpBetter" : "cmpWorse";
        cb = (inv ? vb < va : vb > va) ? "cmpBetter" : "cmpWorse";
      }
      return `<div class="cmpRowLabel">${s.i} ${esc(s.l)}</div><div class="cmpRowVal ${ca}">${fmt(va)}</div><div class="cmpRowVal ${cb}">${fmt(vb)}</div>`;
    }).join("");

    old.dataset.enhanced = "1";
    old.outerHTML = `
      <div class="enhancedCompare">
        <div class="cmpHeader">
          <div class="cmpTitle">⚔️ Comparatif détaillé</div>
          <button class="btnGhost btnSmall" data-action="uiClearCompare" type="button">✕ Fermer</button>
        </div>
        <div class="cmpGrid">
          <div class="cmpCorner"></div>
          <div class="cmpCamHead">
            ${a.image_url ? `<img src="${esc(a.image_url)}" class="cmpCamImg" loading="lazy">` : ""}
            <div class="cmpCamName">${esc(a.id)}</div>
            <div class="cmpCamSub">${esc(a.name)}</div>
          </div>
          <div class="cmpCamHead">
            ${b.image_url ? `<img src="${esc(b.image_url)}" class="cmpCamImg" loading="lazy">` : ""}
            <div class="cmpCamName">${esc(b.id)}</div>
            <div class="cmpCamSub">${esc(b.name)}</div>
          </div>
          ${rows}
        </div>
        <div class="cmpLegend">
          <span class="cmpLegendItem"><span class="cmpDotBetter"></span> Meilleur</span>
          <span class="cmpLegendItem"><span class="cmpDotWorse"></span> Inférieur</span>
        </div>
      </div>`;
  }

  registerAfterRender(enhanceCompareCard);


  // ==========================================================
  // E. CARTES CAMÉRA — Scroll horizontal mobile
  // ==========================================================

  function applySwipeToCards() {
    if (window.innerWidth > 768) return;
    document.querySelectorAll(".cameraCards").forEach(c => {
      // Toujours re-appliquer (le DOM est recréé à chaque render)
      c.classList.add("cameraCards--swipeable");

      // Ajouter l'indicateur s'il n'existe pas déjà juste après
      const next = c.nextElementSibling;
      if (next?.classList.contains("scrollIndicator")) next.remove();

      const cards = c.querySelectorAll(".cameraPickCard");
      if (cards.length <= 1) return;

      const ind = document.createElement("div");
      ind.className = "scrollIndicator";
      ind.innerHTML = Array.from(cards).map((_, i) =>
        `<span class="scrollDot${i === 0 ? " active" : ""}" data-idx="${i}"></span>`
      ).join("");
      c.after(ind);

      ind.addEventListener("click", e => {
        const d = e.target.closest(".scrollDot");
        if (d) cards[+d.dataset.idx]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });

      c.addEventListener("scroll", () => {
        const rect = c.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        let ci = 0, cd = Infinity;
        cards.forEach((card, i) => {
          const r = card.getBoundingClientRect();
          const dist = Math.abs(r.left + r.width / 2 - center);
          if (dist < cd) { cd = dist; ci = i; }
        });
        ind.querySelectorAll(".scrollDot").forEach((d, i) => d.classList.toggle("active", i === ci));
      }, { passive: true });
    });
  }

  registerAfterRender(applySwipeToCards);


  // ==========================================================
  // F. FLOATING RECAP BAR
  // ==========================================================

  function createFloatingRecap() {
    if (document.getElementById("floatingRecap")) return;
    const bar = document.createElement("div");
    bar.id = "floatingRecap";
    bar.className = "floatingRecap";
    bar.innerHTML = `
      <div class="floatingRecap__inner">
        <div class="floatingRecap__stats">
          <div class="floatingRecap__step" id="recapStep"></div>
          <div class="floatingRecap__pill" id="recapCameras" title="Caméras">
            <span class="pillIcon">📷</span><span class="pillValue" id="recapCamCount">0</span><span class="pillLabel">cam.</span>
          </div>
          <div class="floatingRecap__pill" id="recapBlocks" title="Blocs validés">
            <span class="pillIcon">📍</span><span class="pillValue" id="recapBlockCount">0</span><span class="pillLabel">blocs</span>
          </div>
          <div class="floatingRecap__pill" id="recapAccessories" title="Accessoires" style="display:none">
            <span class="pillIcon">🔧</span><span class="pillValue" id="recapAccCount">0</span><span class="pillLabel">acc.</span>
          </div>
        </div>
        <div class="floatingRecap__divider"></div>
        <div class="floatingRecap__actions">
          <button class="floatingRecap__btn floatingRecap__btn--save" id="recapBtnSave" title="Sauvegarder">💾 <span class="btnText">Sauvegarder</span></button>
          <button class="floatingRecap__btn floatingRecap__btn--load" id="recapBtnLoad" title="Charger">📂 <span class="btnText">Charger</span>
            <span class="floatingRecap__saveBadge" id="recapSaveBadge" style="display:none">0</span>
          </button>
          <button class="floatingRecap__btn floatingRecap__btn--share" id="recapBtnShare" title="Partager">🔗 <span class="btnText">Partager</span></button>
        </div>
      </div>`;
    document.body.appendChild(bar);
    document.body.classList.add("hasFloatingRecap");
    document.getElementById("recapBtnSave").addEventListener("click", handleSave);
    document.getElementById("recapBtnLoad").addEventListener("click", handleLoadModal);
    document.getElementById("recapBtnShare").addEventListener("click", handleShare);
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add("visible")));
  }

  let _prevCam = -1, _prevBlk = -1;

  function updateRecap() {
    const m = window._MODEL;
    const steps = window._STEPS;
    if (!m || !steps) return;

    const cam = (m.cameraLines || []).reduce((s, l) => s + (+l.qty || 0), 0);
    const blk = (m.cameraBlocks || []).filter(b => b.validated).length;
    const acc = (m.accessoryLines || []).reduce((s, a) => s + (+a.qty || 0), 0);
    const si = m.stepIndex || 0;

    const stepEl = document.getElementById("recapStep");
    if (stepEl) stepEl.textContent = `${steps[si]?.title || "Étape"} (${si + 1}/${steps.length})`;

    const camEl = document.getElementById("recapCamCount");
    if (camEl) { camEl.textContent = cam; if (cam !== _prevCam && _prevCam >= 0) pulse(camEl.closest(".floatingRecap__pill")); _prevCam = cam; }

    const blkEl = document.getElementById("recapBlockCount");
    if (blkEl) { blkEl.textContent = blk; if (blk !== _prevBlk && _prevBlk >= 0) pulse(blkEl.closest(".floatingRecap__pill")); _prevBlk = blk; }

    const accPill = document.getElementById("recapAccessories");
    const accEl = document.getElementById("recapAccCount");
    if (accPill && accEl) { if (acc > 0) { accPill.style.display = ""; accEl.textContent = acc; } else { accPill.style.display = "none"; } }

    updateSaveBadge();
  }

  function pulse(el) { if (!el) return; el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); setTimeout(() => el.classList.remove("pulse"), 500); }

  registerAfterRender(updateRecap);


  // ==========================================================
  // G. SAVE / LOAD / SHARE
  // ==========================================================

  function getSaves() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); } catch { return []; } }
  function setSaves(c) { localStorage.setItem(SAVE_KEY, JSON.stringify(c)); }
  function updateSaveBadge() {
    const b = document.getElementById("recapSaveBadge"); if (!b) return;
    const s = getSaves(); b.style.display = s.length > 0 ? "" : "none"; b.textContent = s.length;
  }

  function snapshotForSave() { return cloneModel(); }

  function handleSave() {
    const snap = snapshotForSave();
    if (!snap) { showToast("⚠️ Impossible de sauvegarder", "warn"); return; }
    const name = snap.projectName?.trim() || `Config du ${new Date().toLocaleDateString("fr-FR")}`;
    const cam = (snap.cameraLines || []).reduce((s, l) => s + (+l.qty || 0), 0);
    const blk = (snap.cameraBlocks || []).filter(b => b.validated).length;
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, savedAt: new Date().toISOString(), camCount: cam, blockCount: blk, useCase: snap.projectUseCase || "", snapshot: snap };
    const configs = getSaves();
    const existing = configs.findIndex(c => c.name === name);
    if (existing >= 0) { if (!confirm(`"${name}" existe déjà. Écraser ?`)) return; configs[existing] = entry; }
    else configs.unshift(entry);
    while (configs.length > MAX_SAVES) configs.pop();
    setSaves(configs);
    updateSaveBadge();
    showToast(`✅ "${name}" sauvegardé`, "success");
  }

  function handleLoadModal() { showLoadModal(getSaves()); }

  function loadConfig(entry) {
    if (!entry?.snapshot) return;
    applySnapshot(entry.snapshot);
    callOriginalRender();
    showToast(`📂 "${entry.name}" chargé`, "success");
    closeLoadModal();
  }

  function deleteConfig(id) {
    setSaves(getSaves().filter(c => c.id !== id));
    updateSaveBadge();
    const ov = document.getElementById("cfgModalOverlay");
    if (ov?.classList.contains("open")) showLoadModal(getSaves());
  }

  function handleShare() {
    const snap = snapshotForSave();
    if (!snap) { showToast("⚠️ Rien à partager", "warn"); return; }
    try {
      const light = { pn: snap.projectName, uc: snap.projectUseCase,
        bl: (snap.cameraBlocks||[]).map(b=>({id:b.id,lb:b.label,v:b.validated,sc:b.selectedCameraId,q:b.qty,a:b.answers})),
        cl: (snap.cameraLines||[]).map(l=>({ci:l.cameraId,fb:l.fromBlockId,q:l.qty})),
        al: (snap.accessoryLines||[]).map(a=>({ai:a.accessoryId,fb:a.fromBlockId,q:a.qty,t:a.type,n:a.name})),
        rc: snap.recording, cm: snap.complements, si: snap.stepIndex };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(light))));
      if (encoded.length > 4000) { showToast("⚠️ Config trop volumineuse pour un lien", "warn"); return; }
      const url = new URL(window.location.href); url.searchParams.set("cfg", encoded);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url.toString()).then(() => showToast("🔗 Lien copié !", "success")).catch(() => prompt("Copiez :", url.toString()));
      } else prompt("Copiez :", url.toString());
    } catch (e) { showToast("⚠️ Erreur partage", "warn"); }
  }

  function restoreFromURL() {
    try {
      const url = new URL(window.location.href); const enc = url.searchParams.get("cfg"); if (!enc) return;
      const light = JSON.parse(decodeURIComponent(escape(atob(enc))));
      const snap = { projectName: light.pn||"", projectUseCase: light.uc||"",
        cameraBlocks: (light.bl||[]).map(b=>({id:b.id,label:b.lb,validated:b.v,selectedCameraId:b.sc,qty:b.q,answers:b.a||{}})),
        cameraLines: (light.cl||[]).map(l=>({cameraId:l.ci,fromBlockId:l.fb,qty:l.q})),
        accessoryLines: (light.al||[]).map(a=>({accessoryId:a.ai,fromBlockId:a.fb,qty:a.q,type:a.t,name:a.n})),
        recording: light.rc||{}, complements: light.cm||{}, stepIndex: light.si||0 };
      const tryR = () => { if (window._MODEL) { applySnapshot(snap); callOriginalRender(); showToast("📂 Config restaurée depuis le lien", "success"); url.searchParams.delete("cfg"); window.history.replaceState({}, "", url.toString()); } else setTimeout(tryR, 200); };
      tryR();
    } catch {}
  }


  // ==========================================================
  // H. LOAD MODAL
  // ==========================================================

  function showLoadModal(configs) {
    let ov = document.getElementById("cfgModalOverlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "cfgModalOverlay"; ov.className = "cfgModal__overlay"; document.body.appendChild(ov);
      ov.addEventListener("click", e => { if (e.target === ov) closeLoadModal(); }); }
    const esc = s => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
    const listHtml = configs.length ? configs.map(c => {
      const dt = new Date(c.savedAt).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
      return `<div class="cfgModal__item"><div class="cfgModal__itemInfo" data-cfg-load="${c.id}"><div class="cfgModal__itemName">${esc(c.name)}</div><div class="cfgModal__itemMeta">${dt} · ${c.camCount||0} cam. · ${c.blockCount||0} blocs</div></div><button class="cfgModal__itemDelete" data-cfg-delete="${c.id}">🗑️</button></div>`;
    }).join("") : `<div class="cfgModal__empty">Aucune configuration sauvegardée.</div>`;
    ov.innerHTML = `<div class="cfgModal"><div class="cfgModal__title">📂 Configurations sauvegardées</div><div class="cfgModal__subtitle">Clique sur une configuration pour la charger.</div><div class="cfgModal__list">${listHtml}</div><div class="cfgModal__footer"><button class="cfgModal__btnClose" id="cfgModalClose">Fermer</button></div></div>`;
    ov.querySelector("#cfgModalClose")?.addEventListener("click", closeLoadModal);
    ov.querySelectorAll("[data-cfg-load]").forEach(el => el.addEventListener("click", () => { const e = configs.find(c => c.id === el.dataset.cfgLoad); if (e) loadConfig(e); }));
    ov.querySelectorAll("[data-cfg-delete]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); if (confirm("Supprimer ?")) deleteConfig(el.dataset.cfgDelete); }));
    requestAnimationFrame(() => ov.classList.add("open"));
  }

  function closeLoadModal() { document.getElementById("cfgModalOverlay")?.classList.remove("open"); }


  // ==========================================================
  // I. VALIDATION PAR ÉTAPE — Bannière
  // ==========================================================

  function validateCurrentStep() {
    const m = window._MODEL;
    if (!m) return { valid: true, msg: "" };
    const sid = (window._STEPS || [])[m.stepIndex]?.id;

    switch (sid) {
      case "project": {
        const d = [];
        if (!m.projectName?.trim()) d.push("Nom du projet requis");
        if (!m.projectUseCase?.trim()) d.push("Type de site requis");
        return { valid: d.length === 0, msg: d.length ? d.join(" · ") : "✅ Projet configuré" };
      }
      case "cameras": {
        const v = (m.cameraBlocks || []).filter(b => b.validated).length;
        const t = (m.cameraLines || []).reduce((s, l) => s + (+l.qty || 0), 0);
        if (v === 0 || t === 0) return { valid: false, msg: "Valide au moins 1 caméra" };
        return { valid: true, msg: `✅ ${t} caméra(s) · ${v} bloc(s) validé(s)` };
      }
      case "mounts": return { valid: true, msg: "⚡ Accessoires (optionnel)" };
      case "nvr_network": return { valid: true, msg: "✅ NVR calculé automatiquement" };
      case "storage": return { valid: true, msg: `✅ ${m.recording?.daysRetention || 14}j · ${m.recording?.codec?.toUpperCase() || "H265"}` };
      case "summary": return { valid: true, msg: "✅ Configuration terminée" };
      default: return { valid: true, msg: "" };
    }
  }

  function createValidationBanner() {
    if (document.getElementById("stepValidation")) return;
    const banner = document.createElement("div");
    banner.id = "stepValidation";
    banner.className = "stepValidation";
    banner.innerHTML = `<div class="stepValidation__inner"><span id="validIcon">✅</span><span id="validMsg">—</span></div>`;
    const nav = document.querySelector(".navActions");
    if (nav) nav.parentNode.insertBefore(banner, nav);
  }

  function updateValidation() {
    const r = validateCurrentStep();
    const banner = document.getElementById("stepValidation");
    const icon = document.getElementById("validIcon");
    const msg = document.getElementById("validMsg");
    if (!banner || !icon || !msg) return;
    banner.classList.remove("valid", "invalid");
    banner.classList.add(r.valid ? "valid" : "invalid");
    icon.textContent = r.valid ? "✅" : "⚠️";
    msg.textContent = r.msg;

    // NE PAS bloquer le bouton Suivant — on informe seulement
    // (le blocage est déjà géré par canGoNext dans app.js pour l'étape cameras)
  }

  registerAfterRender(updateValidation);

  // Aussi mettre à jour quand l'utilisateur tape dans un input (sans render)
  document.addEventListener("input", (e) => {
    if (e.target.closest("[data-action='projName'], [data-action='projUseCase'], [data-action='inputBlockLabel'], [data-action='inputBlockField']")) {
      // Mettre à jour la bannière après un petit délai
      setTimeout(updateValidation, 100);
    }
  });


  // ==========================================================
  // J. NAVIGATION GUARD
  // ==========================================================

  window.addEventListener("beforeunload", (e) => {
    const m = window._MODEL;
    if (!m) return;
    if ((m.cameraLines || []).length > 0 || m.projectName?.trim()) {
      e.preventDefault(); e.returnValue = "";
    }
  });


  // ==========================================================
  // K. EXPORT CATALOGUE JSON (console)
  // ==========================================================

  window.exportCatalogJSON = function () {
    const c = window._CATALOG;
    if (!c) { console.warn("Ajoute window._CATALOG = CATALOG dans app.js"); return; }
    const json = { _meta: { exportedAt: new Date().toISOString() },
      cameras: c.CAMERAS||[], nvrs: c.NVRS||[], hdds: c.HDDS||[], switches: c.SWITCHES||[],
      screens: c.SCREENS||[], enclosures: c.ENCLOSURES||[], signage: c.SIGNAGE||[],
      accessories_map: c.ACCESSORIES_MAP ? Object.fromEntries(c.ACCESSORIES_MAP) : {} };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `catalog_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    return json;
  };


  // ==========================================================
  // L. TOAST
  // ==========================================================

  let _toastTimer;
  function showToast(msg, type = "info") {
    let t = document.getElementById("cfgToast");
    if (!t) { t = document.createElement("div"); t.id = "cfgToast"; document.body.appendChild(t); }
    t.className = `cfgToast cfgToast--${type}`; t.textContent = msg;
    clearTimeout(_toastTimer);
    requestAnimationFrame(() => t.classList.add("show"));
    _toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
  }


  // ==========================================================
  // Z. INIT — Point d'entrée unique
  // ==========================================================

  function setupMutationFallback() {
    const el = document.getElementById("steps");
    if (!el || el._optimObs) return;
    el._optimObs = true;
    const obs = new MutationObserver(() => {
      requestAnimationFrame(() => {
        for (const fn of _afterRenderCallbacks) {
          try { fn(); } catch (e) { console.warn("[optim]", e); }
        }
      });
    });
    obs.observe(el, { childList: true });
  }

  function initUI() {
    _prevStepIndex = window._MODEL?.stepIndex ?? 0;
    createFloatingRecap();
    createValidationBanner();
    fixCompareHandlers();
    setupSwipeNavigation();
    restoreFromURL();
    updateRecap();
    updateValidation();
    // Premier run des callbacks
    for (const fn of _afterRenderCallbacks) {
      try { fn(); } catch (e) { console.warn("[optim]", e); }
    }
  }

  function init() {
    let attempts = 0;
    const tryHook = () => {
      attempts++;
      if (hookRenderOnce()) {
        // Hook réussi — window.render est wrappé
        initUI();
      } else if (attempts < 25) {
        setTimeout(tryHook, 200);
      } else {
        // Fallback : MutationObserver (si window.render n'existe jamais)
        console.info("[optim] Fallback MutationObserver (ajouter window.render = render; dans app.js)");
        setupMutationFallback();
        initUI();
      }
    };
    tryHook();

    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(applySwipeToCards, 300); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

})();
