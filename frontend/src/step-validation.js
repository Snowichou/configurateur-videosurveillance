/* ============================================================
   VALIDATION PAR ÉTAPE + CATALOGUE JSON HELPER
   Configurateur Vidéosurveillance — COMELIT
   
   📌 INTÉGRATION :
   Dans main.js :
     import "./step-validation.css";
     import("./step-validation.js");
   
   📌 PRÉREQUIS :
   - window._MODEL, window._STEPS exposés
   ============================================================ */

(() => {
  "use strict";

  // ==========================================================
  // 1. VALIDATION RULES — Règles par étape
  // ==========================================================

  /**
   * Retourne un objet { valid, message, details[] } pour chaque étape.
   * `valid` = peut-on passer à l'étape suivante ?
   * `message` = message court affiché à l'utilisateur
   * `details` = liste de raisons détaillées (pour le tooltip)
   */
  function validateStep(stepId) {
    const m = window._MODEL;
    if (!m) return { valid: true, message: "", details: [] };

    switch (stepId) {

      case "project": {
        const hasName = !!m.projectName?.trim();
        const hasUseCase = !!m.projectUseCase?.trim();
        const details = [];
        if (!hasName) details.push("Nom du projet requis");
        if (!hasUseCase) details.push("Type de site requis");

        return {
          valid: hasName && hasUseCase,
          message: details.length ? details.join(" · ") : "✅ Projet configuré",
          details,
        };
      }

      case "cameras": {
        const blocks = m.cameraBlocks || [];
        const totalBlocks = blocks.length;
        const validated = blocks.filter(b => b.validated).length;
        const totalCams = (m.cameraLines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
        const details = [];

        if (validated === 0) details.push("Valide au moins 1 caméra");
        if (totalCams === 0) details.push("Aucune caméra sélectionnée");

        // Vérifier les blocs sans réponse
        const incomplete = blocks.filter(b => !b.validated && !b.selectedCameraId);
        if (incomplete.length > 0) details.push(`${incomplete.length} bloc(s) non configuré(s)`);

        return {
          valid: validated > 0 && totalCams > 0,
          message: details.length ? details.join(" · ") : `✅ ${totalCams} caméra(s) · ${validated}/${totalBlocks} blocs`,
          details,
        };
      }

      case "mounts": {
        // Étape optionnelle — toujours valide, mais on informe
        const accCount = (m.accessoryLines || []).reduce((s, a) => s + (Number(a.qty) || 0), 0);
        return {
          valid: true,
          message: accCount > 0 ? `✅ ${accCount} accessoire(s) configuré(s)` : "⚡ Aucun accessoire (optionnel)",
          details: [],
        };
      }

      case "nvr_network": {
        // Valide si on a des caméras (le NVR est auto-calculé)
        const hasCams = (m.cameraLines || []).length > 0;
        return {
          valid: hasCams,
          message: hasCams ? "✅ NVR sera calculé automatiquement" : "Configure les caméras d'abord",
          details: hasCams ? [] : ["Retourne à l'étape Caméras"],
        };
      }

      case "storage": {
        const rec = m.recording || {};
        const details = [];

        if (!rec.daysRetention || rec.daysRetention < 1) details.push("Rétention invalide");
        if (!rec.hoursPerDay || rec.hoursPerDay < 1) details.push("Heures/jour invalides");

        return {
          valid: details.length === 0,
          message: details.length ? details.join(" · ") : `✅ ${rec.daysRetention}j · ${rec.hoursPerDay}h/j · ${rec.codec?.toUpperCase()}`,
          details,
        };
      }

      case "summary": {
        return { valid: true, message: "✅ Configuration terminée", details: [] };
      }

      default:
        return { valid: true, message: "", details: [] };
    }
  }


  // ==========================================================
  // 2. VALIDATION BANNER — Barre d'info sous le stepper
  // ==========================================================

  function createValidationBanner() {
    if (document.getElementById("stepValidation")) return;

    const banner = document.createElement("div");
    banner.id = "stepValidation";
    banner.className = "stepValidation";
    banner.innerHTML = `
      <div class="stepValidation__inner">
        <span class="stepValidation__icon" id="validIcon">✅</span>
        <span class="stepValidation__msg" id="validMsg">—</span>
      </div>
    `;

    // Insérer après le stepper et avant les boutons
    const navActions = document.querySelector(".navActions");
    if (navActions) {
      navActions.parentNode.insertBefore(banner, navActions);
    }
  }

  function updateValidationBanner() {
    const m = window._MODEL;
    const steps = window._STEPS;
    if (!m || !steps) return;

    const stepId = steps[m.stepIndex]?.id;
    if (!stepId) return;

    const result = validateStep(stepId);

    const iconEl = document.getElementById("validIcon");
    const msgEl = document.getElementById("validMsg");
    const banner = document.getElementById("stepValidation");

    if (!iconEl || !msgEl || !banner) return;

    banner.classList.remove("valid", "invalid", "info");

    if (result.valid) {
      banner.classList.add("valid");
      iconEl.textContent = "✅";
    } else {
      banner.classList.add("invalid");
      iconEl.textContent = "⚠️";
    }

    msgEl.textContent = result.message;

    // Empêcher le bouton Suivant si invalide
    const btnCompute = document.getElementById("btnCompute");
    if (btnCompute) {
      const stepData = steps[m.stepIndex];
      // Ne pas bloquer sur Summary
      if (stepId !== "summary") {
        btnCompute.disabled = !result.valid;
        if (!result.valid) {
          btnCompute.title = result.details.join(", ") || "Complète cette étape";
        } else {
          btnCompute.title = "";
        }
      }
    }
  }


  // ==========================================================
  // 3. STEPPER DOTS — Badge de validation sur chaque dot
  // ==========================================================

  function updateStepperDotBadges() {
    const steps = window._STEPS;
    if (!steps) return;

    steps.forEach((step, i) => {
      const dotEl = document.querySelector(`.stepperStep[data-step="${i}"] .stepperDot`);
      if (!dotEl) return;

      const result = validateStep(step.id);

      // Ajouter/retirer une classe de validation
      dotEl.classList.remove("dotValid", "dotInvalid");
      
      const m = window._MODEL;
      if (i < (m?.stepIndex ?? 0)) {
        // Étape passée : montrer si valid ou pas
        dotEl.classList.add(result.valid ? "dotValid" : "dotInvalid");
      }
    });
  }


  // ==========================================================
  // 4. NAVIGATION GUARD — Confirmation si on recule
  // ==========================================================

  function setupNavigationGuard() {
    // Avertir si l'utilisateur quitte la page avec une config non sauvegardée
    window.addEventListener("beforeunload", (e) => {
      const m = window._MODEL;
      if (!m) return;

      const hasCams = (m.cameraLines || []).length > 0;
      const hasProject = m.projectName?.trim();

      if (hasCams || hasProject) {
        e.preventDefault();
        e.returnValue = "Tu as une configuration en cours. Quitter sans sauvegarder ?";
      }
    });
  }


  // ==========================================================
  // 5. HOOK INTO RENDER
  // ==========================================================

  function hookRender() {
    if (typeof window.render !== "function" || window._validationHooked) return;

    const originalRender = window.render;
    window.render = function () {
      originalRender.apply(this, arguments);
      updateValidationBanner();
      updateStepperDotBadges();
    };

    window._validationHooked = true;
  }

  function hookRenderSafe() {
    const tryHook = () => {
      if (typeof window.render === "function" && !window._validationHooked) {
        hookRender();
      } else if (!window._validationHooked) {
        setTimeout(tryHook, 200);
      }
    };
    tryHook();
  }


  // ==========================================================
  // 6. CATALOGUE JSON EXPORT HELPER
  // ==========================================================

  /**
   * Utilitaire pour exporter le catalogue courant en JSON.
   * Utilisable depuis la console : window.exportCatalogJSON()
   * 
   * L'idée : à terme, remplacer les CSV par un seul catalog.json
   * que tu peux versionner, éditer dans l'admin, etc.
   */
  window.exportCatalogJSON = function () {
    const cat = window._CATALOG;
    if (!cat) {
      console.warn("CATALOG non exposé. Ajoute window._CATALOG = CATALOG; dans app.js");
      return;
    }

    const json = {
      _meta: {
        exportedAt: new Date().toISOString(),
        source: "Configurateur Comelit — exportCatalogJSON()",
      },
      cameras: cat.CAMERAS || [],
      nvrs: cat.NVRS || [],
      hdds: cat.HDDS || [],
      switches: cat.SWITCHES || [],
      screens: cat.SCREENS || [],
      enclosures: cat.ENCLOSURES || [],
      signage: cat.SIGNAGE || [],
      accessories_map: cat.ACCESSORIES_MAP
        ? Object.fromEntries(cat.ACCESSORIES_MAP)
        : {},
    };

    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalog_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`✅ Catalogue exporté : ${json.cameras.length} caméras, ${json.nvrs.length} NVRs, ${json.hdds.length} HDDs`);
    return json;
  };

  /**
   * Charge un catalogue depuis un fichier JSON (pour remplacer les CSV).
   * Utilisable depuis la console : window.importCatalogJSON(jsonObj)
   * 
   * En prod, tu pourrais faire :
   *   fetch("/data/catalog.json").then(r => r.json()).then(importCatalogJSON);
   */
  window.importCatalogJSON = function (json) {
    const cat = window._CATALOG;
    if (!cat) {
      console.warn("CATALOG non exposé");
      return false;
    }

    if (json.cameras) cat.CAMERAS = json.cameras;
    if (json.nvrs) cat.NVRS = json.nvrs;
    if (json.hdds) cat.HDDS = json.hdds;
    if (json.switches) cat.SWITCHES = json.switches;
    if (json.screens) cat.SCREENS = json.screens;
    if (json.enclosures) cat.ENCLOSURES = json.enclosures;
    if (json.signage) cat.SIGNAGE = json.signage;
    if (json.accessories_map) {
      cat.ACCESSORIES_MAP = new Map(Object.entries(json.accessories_map));
    }

    console.log(`✅ Catalogue importé : ${cat.CAMERAS.length} caméras`);

    // Re-render
    if (typeof render === "function") render();
    else if (typeof window.render === "function") window.render();

    return true;
  };


  // ==========================================================
  // 7. INIT
  // ==========================================================

  function init() {
    createValidationBanner();
    hookRenderSafe();
    setupNavigationGuard();
    updateValidationBanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 650));
  } else {
    setTimeout(init, 650);
  }

})();
