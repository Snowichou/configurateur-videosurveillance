/* ============================================================
   OPTIMISATIONS CONFIGURATEUR — COMELIT  (V6)
   
   ✅ MutationObserver (aucun hook render)
   ✅ Compare 100% DOM, responsive, instantané
   ✅ Cartes caméra scroll horizontal mobile
   ✅ Animations slide entre étapes
   ✅ Undo/Redo clavier (Ctrl+Z/Y)
   ✅ Swipe tactile navigation
   ✅ 💾 Sauvegarder + 🔗 Partager dans le Résumé
   ✅ 📂 Charger une config sur la page d'accueil
   ✅ Save/Load/Share localStorage + URL
   ❌ Plus de barre flottante
   ❌ Plus de bannière de validation
   
   📌 DANS app.js (déjà en place) :
     window._MODEL = MODEL;
     window._STEPS = STEPS;
     window._CATALOG = CATALOG;
     window._getCameraById = getCameraById;
   ============================================================ */

(() => {
  "use strict";

  const SAVE_KEY = "comelit_saved_configs";
  const MAX_SAVES = 10;
  const HISTORY_MAX = 30;

  // ==========================================================
  // 0. MutationObserver sur #steps
  // ==========================================================

  const _callbacks = [];
  function onAfterRender(fn) { _callbacks.push(fn); }
  function runCallbacks() {
    for (const fn of _callbacks) {
      try { fn(); } catch (e) { console.warn("[optim]", e); }
    }
  }
  function watchSteps() {
    const el = document.getElementById("steps");
    if (!el) return false;
    new MutationObserver(() => requestAnimationFrame(runCallbacks)).observe(el, { childList: true });
    return true;
  }


  // ==========================================================
  // A. UNDO / REDO (clavier)
  // ==========================================================

  let _undoStack = [], _redoStack = [], _lastSnapJSON = "";

  function cloneModel() {
    const m = window._MODEL; if (!m) return null;
    try { return JSON.parse(JSON.stringify({
      projectName: m.projectName, projectUseCase: m.projectUseCase,
      cameraBlocks: m.cameraBlocks, cameraLines: m.cameraLines,
      accessoryLines: m.accessoryLines, recording: m.recording,
      complements: m.complements, stepIndex: m.stepIndex,
      ui: { activeBlockId: m.ui?.activeBlockId, resultsShown: m.ui?.resultsShown,
            mode: m.ui?.mode, onlyFavs: m.ui?.onlyFavs, favorites: m.ui?.favorites,
            compare: m.ui?.compare, previewByBlock: m.ui?.previewByBlock },
    })); } catch { return null; }
  }
  function applySnapshot(snap) {
    const m = window._MODEL; if (!m || !snap) return;
    m.projectName = snap.projectName ?? m.projectName;
    m.projectUseCase = snap.projectUseCase ?? m.projectUseCase;
    m.cameraBlocks = snap.cameraBlocks ?? m.cameraBlocks;
    m.cameraLines = snap.cameraLines ?? m.cameraLines;
    m.accessoryLines = snap.accessoryLines ?? m.accessoryLines;
    m.recording = snap.recording ?? m.recording;
    m.complements = snap.complements ?? m.complements;
    m.stepIndex = snap.stepIndex ?? m.stepIndex;
    if (snap.ui) Object.assign(m.ui, snap.ui);
  }
  function undoCapture() {
    const snap = cloneModel(); if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === _lastSnapJSON) return;
    _undoStack.push(JSON.parse(json));
    if (_undoStack.length > HISTORY_MAX) _undoStack.shift();
    _redoStack = [];
    _lastSnapJSON = json;
  }
  onAfterRender(undoCapture);

  function forceRerender() {
    const si = window._MODEL?.stepIndex ?? 0;
    const dot = document.querySelector(`.stepperStep[data-step="${si}"] .stepperDot`);
    if (dot) dot.click();
  }
  function doUndo() {
    if (!_undoStack.length) return;
    const cur = cloneModel(); if (cur) _redoStack.push(cur);
    applySnapshot(_undoStack.pop());
    _lastSnapJSON = JSON.stringify(cloneModel());
    forceRerender(); showToast("↩ Annulé");
  }
  function doRedo() {
    if (!_redoStack.length) return;
    const cur = cloneModel(); if (cur) _undoStack.push(cur);
    applySnapshot(_redoStack.pop());
    _lastSnapJSON = JSON.stringify(cloneModel());
    forceRerender(); showToast("↪ Rétabli");
  }
  document.addEventListener("keydown", (e) => {
    const t = (e.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(t)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); doRedo(); }
  });


  // ==========================================================
  // B. STEP TRANSITIONS
  // ==========================================================

  let _prevStepIndex = -1;
  function animateStepTransition() {
    const el = document.getElementById("steps"); if (!el) return;
    const idx = window._MODEL?.stepIndex ?? 0;
    if (_prevStepIndex === -1) { _prevStepIndex = idx; return; }
    if (idx === _prevStepIndex) return;
    const cls = idx > _prevStepIndex ? "stepSlideInNext" : "stepSlideInPrev";
    _prevStepIndex = idx;
    el.classList.remove("stepSlideInNext", "stepSlideInPrev");
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  }
  onAfterRender(animateStepTransition);


  // ==========================================================
  // C. SWIPE NAVIGATION
  // ==========================================================

  function setupSwipeNavigation() {
    const main = document.querySelector(".appMain");
    if (!main || main._swipe) return; main._swipe = true;
    let sx = 0, sy = 0, tr = false;
    main.addEventListener("touchstart", (e) => {
      if (e.target.closest("button,a,input,select,textarea,details,.cameraCards--swipeable")) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tr = true;
    }, { passive: true });
    main.addEventListener("touchend", (e) => {
      if (!tr) return; tr = false;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      if (dx < -80) { const b = document.getElementById("btnCompute"); if (b && !b.disabled) b.click(); }
      else if (dx > 80) { const b = document.getElementById("btnPrev"); if (b?.style.display !== "none") b.click(); }
    }, { passive: true });
  }


  // ==========================================================
  // D. COMPARE — 100% DOM, responsive
  // ==========================================================

  const esc = (v) => v == null ? "—" : String(v).replace(/[<>&"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function getCam(id) {
    if (window._getCameraById) return window._getCameraById(String(id));
    return (window._CATALOG?.CAMERAS || []).find(c => String(c.id) === String(id)) || null;
  }

  function syncCompareButtonStates() {
    const cmpList = (window._MODEL?.ui?.compare || []).map(String);
    document.querySelectorAll("[data-action='uiToggleCompare']").forEach(btn => {
      const isIn = cmpList.includes(btn.dataset.camid);
      btn.classList.toggle("active", isIn);
      btn.textContent = isIn ? "⚔️ Comparé" : "⚔️ Comparer";
    });
  }

  function buildComparePanel() {
    const cmpList = (window._MODEL?.ui?.compare || []).map(String);
    document.getElementById("liveComparePanel")?.remove();
    if (cmpList.length < 2) return;
    const a = getCam(cmpList[0]), b = getCam(cmpList[1]);
    if (!a || !b) return;

    const target = document.querySelector(".proposalsCol .cameraCards") || document.querySelector(".proposalsCol");
    if (!target) return;

    const specs = [
      { l:"Résolution",k:"resolution_mp",u:"MP",i:"📐" },
      { l:"IR",k:"ir_range_m",u:"m",i:"🔦" },
      { l:"DORI Détect.",k:"dori_detection_m",u:"m",i:"👁️" },
      { l:"DORI Identif.",k:"dori_identification_m",u:"m",i:"🔍" },
      { l:"Focale",k:"focal_min_mm",u:"mm",i:"🔭" },
      { l:"IP",k:"ip",u:"",i:"💧",p:"IP" },
      { l:"IK",k:"ik",u:"",i:"🛡️",p:"IK" },
      { l:"PoE",k:"poe_w",u:"W",i:"⚡" },
      { l:"Analytics",k:"analytics_level",u:"",i:"🤖" },
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
      return `<div class="cmpCell cmpLabel">${s.i} ${esc(s.l)}</div><div class="cmpCell cmpVal ${ca}">${fmt(va)}</div><div class="cmpCell cmpVal ${cb}">${fmt(vb)}</div>`;
    }).join("");

    const panel = document.createElement("div");
    panel.id = "liveComparePanel";
    panel.className = "cmpPanel";
    panel.innerHTML = `
      <div class="cmpHead">
        <span class="cmpHeadTitle">⚔️ Comparatif</span>
        <button class="cmpHeadClose" type="button">✕</button>
      </div>
      <div class="cmpTable">
        <div class="cmpCell cmpCorner"></div>
        <div class="cmpCell cmpColHead">
          ${a.image_url ? `<img src="${esc(a.image_url)}" class="cmpImg">` : ""}
          <div class="cmpId">${esc(a.id)}</div>
          <div class="cmpName">${esc(a.name)}</div>
        </div>
        <div class="cmpCell cmpColHead">
          ${b.image_url ? `<img src="${esc(b.image_url)}" class="cmpImg">` : ""}
          <div class="cmpId">${esc(b.id)}</div>
          <div class="cmpName">${esc(b.name)}</div>
        </div>
        ${rows}
      </div>
      <div class="cmpFoot">
        <span class="cmpLeg"><span class="cmpDot cmpDotG"></span> Meilleur</span>
        <span class="cmpLeg"><span class="cmpDot cmpDotR"></span> Inférieur</span>
      </div>`;

    panel.querySelector(".cmpHeadClose").addEventListener("click", () => {
      window._MODEL.ui.compare = [];
      panel.remove();
      syncCompareButtonStates();
    });

    target.parentNode.insertBefore(panel, target);
  }

  function toggleCompare(camId) {
    const m = window._MODEL; if (!m) return;
    if (!Array.isArray(m.ui.compare)) m.ui.compare = [];
    const strId = String(camId), idx = m.ui.compare.indexOf(strId);
    if (idx >= 0) m.ui.compare.splice(idx, 1);
    else { if (m.ui.compare.length >= 2) m.ui.compare.shift(); m.ui.compare.push(strId); }
    syncCompareButtonStates();
    buildComparePanel();
  }

  function injectCompareButtons() {
    const sid = (window._STEPS || [])[window._MODEL?.stepIndex ?? -1]?.id;
    if (sid !== "cameras") return;
    document.querySelectorAll(".cameraPickCard").forEach(card => {
      if (card.querySelector("[data-action='uiToggleCompare']")) return;
      const vBtn = card.querySelector("[data-action='validateCamera']");
      if (!vBtn) return;
      const camId = vBtn.dataset.camid;
      const actions = card.querySelector(".cameraPickActions");
      if (!actions || !camId) return;
      const isIn = (window._MODEL?.ui?.compare || []).map(String).includes(String(camId));
      const b = document.createElement("button");
      b.className = `btnGhost btnCompare${isIn ? " active" : ""}`;
      b.type = "button";
      b.setAttribute("data-action", "uiToggleCompare");
      b.setAttribute("data-camid", camId);
      b.textContent = isIn ? "⚔️ Comparé" : "⚔️ Comparer";
      actions.appendChild(b);
    });
    if ((window._MODEL?.ui?.compare || []).length >= 2) buildComparePanel();
  }
  onAfterRender(injectCompareButtons);

  function setupCompareListeners() {
    const el = document.getElementById("steps");
    if (!el || el._cmpSetup) return; el._cmpSetup = true;
    el.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-action='uiToggleCompare']");
      if (toggle) { e.preventDefault(); e.stopPropagation(); toggleCompare(toggle.dataset.camid); return; }
      const clear = e.target.closest("[data-action='uiClearCompare']");
      if (clear) { e.stopPropagation(); window._MODEL.ui.compare = [];
        document.getElementById("liveComparePanel")?.remove(); syncCompareButtonStates(); return; }
    });
  }


  // ==========================================================
  // E. CARTES CAMÉRA — Scroll horizontal mobile
  // ==========================================================

  function applySwipeToCards() {
    if (window.innerWidth > 768) return;
    document.querySelectorAll(".cameraCards").forEach(c => {
      c.classList.add("cameraCards--swipeable");
      const next = c.nextElementSibling;
      if (next?.classList.contains("scrollIndicator")) next.remove();
      const cards = c.querySelectorAll(".cameraPickCard");
      if (cards.length <= 1) return;
      const ind = document.createElement("div"); ind.className = "scrollIndicator";
      ind.innerHTML = Array.from(cards).map((_, i) => `<span class="scrollDot${i===0?" active":""}" data-idx="${i}"></span>`).join("");
      c.after(ind);
      ind.addEventListener("click", e => { const d = e.target.closest(".scrollDot"); if (d) cards[+d.dataset.idx]?.scrollIntoView({behavior:"smooth",inline:"center",block:"nearest"}); });
      c.addEventListener("scroll", () => {
        const ci2 = c.nextElementSibling;
        if (!ci2?.classList.contains("scrollIndicator")) return;
        const rect = c.getBoundingClientRect(), ctr = rect.left + rect.width/2;
        let best = 0, bestD = Infinity;
        c.querySelectorAll(".cameraPickCard").forEach((card,i) => { const d = Math.abs(card.getBoundingClientRect().left + card.getBoundingClientRect().width/2 - ctr); if (d < bestD) { bestD = d; best = i; } });
        ci2.querySelectorAll(".scrollDot").forEach((d,i) => d.classList.toggle("active",i===best));
      }, { passive: true });
    });
  }
  onAfterRender(applySwipeToCards);


  // ==========================================================
  // F. BOUTON "📂 CHARGER" — Page d'accueil (projet)
  // ==========================================================

  function injectLoadButton() {
    const sid = (window._STEPS || [])[window._MODEL?.stepIndex ?? -1]?.id;
    if (sid !== "project") return;
    if (document.getElementById("btnLoadConfig")) return;

    // Chercher la colonne proposalsCol pour y ajouter le bouton
    const col = document.querySelector(".proposalsCol");
    if (!col) return;

    const saves = getSaves();
    if (!saves.length) return; // Pas de configs sauvegardées = pas de bouton

    const card = document.createElement("div");
    card.className = "recoCard";
    card.id = "btnLoadConfig";
    card.style.cssText = "padding:14px;margin-top:10px;cursor:pointer;border:1px dashed var(--comelit-green, #00BC70);background:rgba(0,188,112,0.03);transition:background 0.15s";
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:22px">📂</span>
        <div>
          <div style="font-weight:800;color:var(--cosmos)">Reprendre une configuration</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${saves.length} config(s) sauvegardée(s)</div>
        </div>
      </div>`;
    card.addEventListener("mouseenter", () => card.style.background = "rgba(0,188,112,0.08)");
    card.addEventListener("mouseleave", () => card.style.background = "rgba(0,188,112,0.03)");
    card.addEventListener("click", () => showLoadModal(getSaves()));
    col.appendChild(card);
  }
  onAfterRender(injectLoadButton);


  // ==========================================================
  // G. BOUTONS "💾 SAUVEGARDER" + "🔗 PARTAGER" — Résumé
  // ==========================================================

  function injectSummaryButtons() {
    const sid = (window._STEPS || [])[window._MODEL?.stepIndex ?? -1]?.id;
    if (sid !== "summary") return;
    if (document.getElementById("btnSaveConfig")) return;

    const exportRow = document.querySelector(".exportRowSummary");
    if (!exportRow) return;

    const btnSave = document.createElement("button");
    btnSave.id = "btnSaveConfig";
    btnSave.className = "btn secondary";
    btnSave.type = "button";
    btnSave.innerHTML = "💾 Sauvegarder";
    btnSave.addEventListener("click", handleSave);

    const btnShare = document.createElement("button");
    btnShare.id = "btnShareConfig";
    btnShare.className = "btnGhost";
    btnShare.type = "button";
    btnShare.innerHTML = "🔗 Partager";
    btnShare.addEventListener("click", handleShare);

    exportRow.appendChild(btnSave);
    exportRow.appendChild(btnShare);
  }
  onAfterRender(injectSummaryButtons);


  // ==========================================================
  // H. SAVE / LOAD / SHARE logic
  // ==========================================================

  function getSaves() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)||"[]"); } catch { return []; } }
  function setSaves(c) { localStorage.setItem(SAVE_KEY, JSON.stringify(c)); }

  function handleSave() {
    const snap = cloneModel(); if (!snap) { showToast("⚠️ Impossible"); return; }
    const name = snap.projectName?.trim() || `Config ${new Date().toLocaleDateString("fr-FR")}`;
    const cam = (snap.cameraLines||[]).reduce((s,l)=>s+(+l.qty||0),0);
    const blk = (snap.cameraBlocks||[]).filter(b=>b.validated).length;
    const entry = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), name, savedAt: new Date().toISOString(), camCount:cam, blockCount:blk, useCase: snap.projectUseCase||"", snapshot: snap };
    const configs = getSaves();
    const ex = configs.findIndex(c=>c.name===name);
    if (ex>=0) { if (!confirm(`"${name}" existe. Écraser ?`)) return; configs[ex] = entry; }
    else configs.unshift(entry);
    while (configs.length > MAX_SAVES) configs.pop();
    setSaves(configs);
    showToast(`✅ "${name}" sauvegardé`);
  }

  function loadConfig(entry) {
    if (!entry?.snapshot) return; applySnapshot(entry.snapshot);
    forceRerender(); showToast(`📂 "${entry.name}" chargé`); closeLoadModal();
  }

  function deleteConfig(id) {
    setSaves(getSaves().filter(c=>c.id!==id));
    const ov = document.getElementById("cfgModalOverlay");
    if (ov?.classList.contains("open")) showLoadModal(getSaves());
  }

  function handleShare() {
    const snap = cloneModel(); if (!snap) { showToast("⚠️ Rien à partager"); return; }
    try {
      const light = { pn:snap.projectName, uc:snap.projectUseCase,
        bl:(snap.cameraBlocks||[]).map(b=>({id:b.id,lb:b.label,v:b.validated,sc:b.selectedCameraId,q:b.qty,a:b.answers})),
        cl:(snap.cameraLines||[]).map(l=>({ci:l.cameraId,fb:l.fromBlockId,q:l.qty})),
        al:(snap.accessoryLines||[]).map(a=>({ai:a.accessoryId,fb:a.fromBlockId,q:a.qty,t:a.type,n:a.name})),
        rc:snap.recording, cm:snap.complements, si:snap.stepIndex };
      const enc = btoa(unescape(encodeURIComponent(JSON.stringify(light))));
      if (enc.length > 4000) { showToast("⚠️ Config trop grosse"); return; }
      const url = new URL(window.location.href); url.searchParams.set("cfg", enc);
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url.toString()).then(()=>showToast("🔗 Lien copié !")).catch(()=>prompt("Copiez :",url.toString()));
      else prompt("Copiez :",url.toString());
    } catch { showToast("⚠️ Erreur"); }
  }

  function restoreFromURL() {
    try {
      const url = new URL(window.location.href), enc = url.searchParams.get("cfg"); if (!enc) return;
      const light = JSON.parse(decodeURIComponent(escape(atob(enc))));
      const snap = { projectName:light.pn||"", projectUseCase:light.uc||"",
        cameraBlocks:(light.bl||[]).map(b=>({id:b.id,label:b.lb,validated:b.v,selectedCameraId:b.sc,qty:b.q,answers:b.a||{}})),
        cameraLines:(light.cl||[]).map(l=>({cameraId:l.ci,fromBlockId:l.fb,qty:l.q})),
        accessoryLines:(light.al||[]).map(a=>({accessoryId:a.ai,fromBlockId:a.fb,qty:a.q,type:a.t,name:a.n})),
        recording:light.rc||{}, complements:light.cm||{}, stepIndex:light.si||0 };
      const tryR = () => { if (window._MODEL) { applySnapshot(snap); forceRerender(); showToast("📂 Config restaurée"); url.searchParams.delete("cfg"); window.history.replaceState({},"",url.toString()); } else setTimeout(tryR,200); };
      tryR();
    } catch {}
  }


  // ==========================================================
  // I. LOAD MODAL
  // ==========================================================

  function showLoadModal(configs) {
    let ov = document.getElementById("cfgModalOverlay");
    if (!ov) { ov = document.createElement("div"); ov.id="cfgModalOverlay"; ov.className="cfgModal__overlay"; document.body.appendChild(ov); ov.addEventListener("click",e=>{if(e.target===ov)closeLoadModal();}); }
    const he = s => { const d = document.createElement("div"); d.textContent=s; return d.innerHTML; };
    const list = configs.length ? configs.map(c => {
      const dt = new Date(c.savedAt).toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
      return `<div class="cfgModal__item"><div class="cfgModal__itemInfo" data-cfg-load="${c.id}"><div class="cfgModal__itemName">${he(c.name)}</div><div class="cfgModal__itemMeta">${dt} · ${c.camCount||0} cam. · ${c.blockCount||0} blocs</div></div><button class="cfgModal__itemDelete" data-cfg-delete="${c.id}">🗑️</button></div>`;
    }).join("") : `<div class="cfgModal__empty">Aucune config sauvegardée.</div>`;
    ov.innerHTML = `<div class="cfgModal"><div class="cfgModal__title">📂 Configurations</div><div class="cfgModal__list">${list}</div><div class="cfgModal__footer"><button class="cfgModal__btnClose" id="cfgModalClose">Fermer</button></div></div>`;
    ov.querySelector("#cfgModalClose")?.addEventListener("click",closeLoadModal);
    ov.querySelectorAll("[data-cfg-load]").forEach(el=>el.addEventListener("click",()=>{const e=configs.find(c=>c.id===el.dataset.cfgLoad);if(e)loadConfig(e);}));
    ov.querySelectorAll("[data-cfg-delete]").forEach(el=>el.addEventListener("click",e=>{e.stopPropagation();if(confirm("Supprimer ?"))deleteConfig(el.dataset.cfgDelete);}));
    requestAnimationFrame(()=>ov.classList.add("open"));
  }
  function closeLoadModal() { document.getElementById("cfgModalOverlay")?.classList.remove("open"); }


  // ==========================================================
  // J. NAV GUARD + EXPORT JSON + TOAST
  // ==========================================================

  window.addEventListener("beforeunload", (e) => {
    const m = window._MODEL; if (!m) return;
    if ((m.cameraLines||[]).length > 0 || m.projectName?.trim()) { e.preventDefault(); e.returnValue = ""; }
  });

  window.exportCatalogJSON = function () {
    const c = window._CATALOG; if (!c) return;
    const json = { cameras:c.CAMERAS||[], nvrs:c.NVRS||[], hdds:c.HDDS||[], switches:c.SWITCHES||[], screens:c.SCREENS||[], enclosures:c.ENCLOSURES||[], signage:c.SIGNAGE||[] };
    const blob = new Blob([JSON.stringify(json,null,2)],{type:"application/json"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`catalog.json`; a.click();
  };

  let _tt;
  function showToast(msg) {
    let t = document.getElementById("cfgToast");
    if (!t) { t=document.createElement("div"); t.id="cfgToast"; t.className="cfgToast"; document.body.appendChild(t); }
    t.textContent=msg; t.classList.remove("show");
    clearTimeout(_tt); requestAnimationFrame(()=>t.classList.add("show"));
    _tt = setTimeout(()=>t.classList.remove("show"), 2500);
  }


  // ==========================================================
  // Z. INIT
  // ==========================================================

  function init() {
    if (!watchSteps()) { setTimeout(init, 300); return; }
    _prevStepIndex = window._MODEL?.stepIndex ?? 0;
    setupCompareListeners();
    setupSwipeNavigation();
    restoreFromURL();
    runCallbacks();
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(applySwipeToCards, 300); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 500));
  else setTimeout(init, 500);

})();