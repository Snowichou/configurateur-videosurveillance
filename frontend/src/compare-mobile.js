/* ============================================================
   MODE COMPARAISON AMÉLIORÉ + SWIPE CARTES MOBILE
   Configurateur Vidéosurveillance — COMELIT
   
   📌 INTÉGRATION :
   Dans main.js :
     import "./compare-mobile.css";
     import("./compare-mobile.js");
   
   📌 PRÉREQUIS :
   - window._MODEL, window._STEPS, window._CATALOG exposés
   - Ajouter dans app.js : window._CATALOG = CATALOG;
   ============================================================ */

(() => {
  "use strict";

  // ==========================================================
  // 1. SWIPE HORIZONTAL SUR LES CARTES CAMÉRA (MOBILE)
  // ==========================================================

  /** Transforme le container .cameraCards en scroll horizontal sur mobile */
  function enableCardSwipe() {
    // Observer les mutations pour capter les re-renders
    const observer = new MutationObserver(() => {
      applySwipeToCards();
    });

    const stepsEl = document.getElementById("steps");
    if (stepsEl) {
      observer.observe(stepsEl, { childList: true, subtree: true });
    }

    // Premier run
    applySwipeToCards();
  }

  function applySwipeToCards() {
    // Ne s'applique qu'en mode mobile
    if (window.innerWidth > 768) return;

    const containers = document.querySelectorAll(".cameraCards");
    containers.forEach((container) => {
      if (container.dataset.swipeEnabled) return;
      container.dataset.swipeEnabled = "1";

      // Ajouter la classe pour le scroll horizontal
      container.classList.add("cameraCards--swipeable");

      // Ajouter un indicateur de scroll
      addScrollIndicator(container);

      // Snap scroll behavior
      container.addEventListener("scroll", () => {
        updateScrollIndicator(container);
      }, { passive: true });
    });
  }

  function addScrollIndicator(container) {
    // Vérifier qu'il n'y a pas déjà un indicateur
    if (container.nextElementSibling?.classList.contains("scrollIndicator")) return;

    const cards = container.querySelectorAll(".cameraPickCard");
    if (cards.length <= 1) return;

    const indicator = document.createElement("div");
    indicator.className = "scrollIndicator";
    indicator.innerHTML = Array.from(cards).map((_, i) =>
      `<span class="scrollDot ${i === 0 ? "active" : ""}" data-idx="${i}"></span>`
    ).join("");

    container.after(indicator);

    // Cliquer sur un dot pour scroller à la carte
    indicator.addEventListener("click", (e) => {
      const dot = e.target.closest(".scrollDot");
      if (!dot) return;
      const idx = Number(dot.dataset.idx);
      const card = cards[idx];
      if (card) {
        card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    });
  }

  function updateScrollIndicator(container) {
    const indicator = container.nextElementSibling;
    if (!indicator?.classList.contains("scrollIndicator")) return;

    const cards = container.querySelectorAll(".cameraPickCard");
    const dots = indicator.querySelectorAll(".scrollDot");
    if (!cards.length || !dots.length) return;

    // Déterminer quelle carte est visible
    const containerRect = container.getBoundingClientRect();
    const center = containerRect.left + containerRect.width / 2;

    let closestIdx = 0;
    let closestDist = Infinity;

    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const dist = Math.abs(cardCenter - center);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    });

    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === closestIdx);
    });
  }


  // ==========================================================
  // 2. COMPARAISON AMÉLIORÉE — Specs complètes côte à côte
  // ==========================================================

  /** Génère le HTML d'un comparatif enrichi (remplace le compareHtml existant) */
  function buildEnhancedCompare(camA, camB) {
    if (!camA || !camB) return "";

    const safe = (v) => {
      if (v == null) return "—";
      return String(v).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    };

    const specs = [
      { label: "Résolution", key: "resolution_mp", unit: "MP", icon: "📐" },
      { label: "IR", key: "ir_range_m", unit: "m", icon: "🔦" },
      { label: "DORI Détection", key: "dori_detection_m", unit: "m", icon: "👁️" },
      { label: "DORI Identification", key: "dori_identification_m", unit: "m", icon: "🔍" },
      { label: "Focale min", key: "focal_min_mm", unit: "mm", icon: "🔭" },
      { label: "Focale max", key: "focal_max_mm", unit: "mm", icon: "🔭" },
      { label: "IP", key: "ip", unit: "", icon: "💧", prefix: "IP" },
      { label: "IK", key: "ik", unit: "", icon: "🛡️", prefix: "IK" },
      { label: "PoE", key: "poe_w", unit: "W", icon: "⚡" },
      { label: "Analytics", key: "analytics_level", unit: "", icon: "🤖" },
    ];

    const rows = specs.map(s => {
      const valA = camA[s.key];
      const valB = camB[s.key];
      
      const fmtVal = (v) => {
        if (v == null || v === "" || v === 0) return "—";
        return `${s.prefix || ""}${v}${s.unit ? " " + s.unit : ""}`;
      };

      // Mise en valeur du meilleur (pour les numériques)
      let classA = "";
      let classB = "";
      if (typeof valA === "number" && typeof valB === "number" && valA !== valB) {
        // Pour PoE, moins = mieux
        if (s.key === "poe_w") {
          classA = valA < valB ? "cmpBetter" : valA > valB ? "cmpWorse" : "";
          classB = valB < valA ? "cmpBetter" : valB > valA ? "cmpWorse" : "";
        } else {
          classA = valA > valB ? "cmpBetter" : valA < valB ? "cmpWorse" : "";
          classB = valB > valA ? "cmpBetter" : valB < valA ? "cmpWorse" : "";
        }
      }

      return `
        <div class="cmpRowLabel">${s.icon} ${safe(s.label)}</div>
        <div class="cmpRowVal ${classA}">${fmtVal(valA)}</div>
        <div class="cmpRowVal ${classB}">${fmtVal(valB)}</div>
      `;
    }).join("");

    return `
      <div class="enhancedCompare" id="enhancedCompare">
        <div class="cmpHeader">
          <div class="cmpTitle">⚔️ Comparatif détaillé</div>
          <button class="btnGhost btnSmall" data-action="uiClearCompare" type="button">✕ Fermer</button>
        </div>
        
        <div class="cmpGrid">
          <!-- Headers -->
          <div class="cmpCorner"></div>
          <div class="cmpCamHead">
            ${camA.image_url ? `<img src="${safe(camA.image_url)}" class="cmpCamImg" alt="" loading="lazy">` : ""}
            <div class="cmpCamName">${safe(camA.id)}</div>
            <div class="cmpCamSub">${safe(camA.name)}</div>
            <div class="cmpCamRange">${safe(camA.brand_range)}</div>
          </div>
          <div class="cmpCamHead">
            ${camB.image_url ? `<img src="${safe(camB.image_url)}" class="cmpCamImg" alt="" loading="lazy">` : ""}
            <div class="cmpCamName">${safe(camB.id)}</div>
            <div class="cmpCamSub">${safe(camB.name)}</div>
            <div class="cmpCamRange">${safe(camB.brand_range)}</div>
          </div>

          <!-- Specs rows -->
          ${rows}
        </div>

        <div class="cmpLegend">
          <span class="cmpLegendItem"><span class="cmpDotBetter"></span> Meilleur</span>
          <span class="cmpLegendItem"><span class="cmpDotWorse"></span> Inférieur</span>
        </div>
      </div>
    `;
  }

  /** Hook : intercepter le rendu du compare pour injecter la version enrichie */
  function hookCompareRendering() {
    const stepsEl = document.getElementById("steps");
    if (!stepsEl) return;

    const observer = new MutationObserver(() => {
      const oldCompare = stepsEl.querySelector(".compareCard");
      if (!oldCompare) return;

      // Récupérer les 2 caméras du compare depuis MODEL
      const cmp = window._MODEL?.ui?.compare || [];
      if (cmp.length < 2) return;

      const getCam = window._getCameraById || ((id) => {
        return (window._CATALOG?.CAMERAS || []).find(c => c.id === id) || null;
      });

      const camA = getCam(cmp[0]);
      const camB = getCam(cmp[1]);
      if (!camA || !camB) return;

      // Remplacer par la version enrichie
      const enhanced = buildEnhancedCompare(camA, camB);
      if (enhanced) {
        oldCompare.outerHTML = enhanced;
      }
    });

    observer.observe(stepsEl, { childList: true, subtree: false });
  }


  // ==========================================================
  // 3. BOUTON "COMPARER" AMÉLIORÉ SUR LES CARTES
  // ==========================================================

  /** Ajoute un bouton toggle compare sur chaque carte caméra */
  function enhanceCompareButtons() {
    const stepsEl = document.getElementById("steps");
    if (!stepsEl) return;

    const observer = new MutationObserver(() => {
      const cards = stepsEl.querySelectorAll(".cameraPickCard");
      cards.forEach(card => {
        if (card.dataset.compareEnhanced) return;
        card.dataset.compareEnhanced = "1";

        // Trouver le camId de cette carte
        const validateBtn = card.querySelector("[data-action='validateCamera']");
        if (!validateBtn) return;
        const camId = validateBtn.dataset.camid;
        if (!camId) return;

        // Ajouter le bouton compare dans les actions
        const actionsDiv = card.querySelector(".cameraPickActions");
        if (!actionsDiv) return;

        const cmpBtn = document.createElement("button");
        cmpBtn.className = "btnGhost btnCompare";
        cmpBtn.type = "button";
        cmpBtn.title = "Ajouter au comparatif";
        cmpBtn.dataset.camid = camId;

        const isInCompare = (window._MODEL?.ui?.compare || []).includes(camId);
        cmpBtn.innerHTML = isInCompare ? "⚔️ Comparé" : "⚔️ Comparer";
        if (isInCompare) cmpBtn.classList.add("active");

        cmpBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleCompare(camId);
        });

        actionsDiv.appendChild(cmpBtn);
      });
    });

    observer.observe(stepsEl, { childList: true, subtree: false });
  }

  function toggleCompare(camId) {
    const m = window._MODEL;
    if (!m) return;

    if (!Array.isArray(m.ui.compare)) m.ui.compare = [];

    const idx = m.ui.compare.indexOf(camId);
    if (idx >= 0) {
      m.ui.compare.splice(idx, 1);
    } else {
      if (m.ui.compare.length >= 2) {
        // Remplacer le plus ancien
        m.ui.compare.shift();
      }
      m.ui.compare.push(camId);
    }

    // Re-render
    if (typeof render === "function") render();
    else if (typeof window.render === "function") window.render();
  }


  // ==========================================================
  // 4. INIT
  // ==========================================================

  function init() {
    enableCardSwipe();
    hookCompareRendering();
    enhanceCompareButtons();

    // Re-apply on resize (passage desktop <-> mobile)
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applySwipeToCards, 250);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 700));
  } else {
    setTimeout(init, 700);
  }

})();
