/**
 * UTILITAIRES GLOBAUX
 * Fonctions partagées : indicateurs, semaines, sidebar, etc.
 */

// ============ SÉCURITÉ ============
/**
 * Échappe les caractères HTML pour prévenir les injections XSS
 * À utiliser lors de l'insertion de contenu utilisateur dans le DOM via innerHTML
 * @param {string} str - Chaîne à échapper
 * @returns {string} - Chaîne sécurisée
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ INDICATEURS UTILS ============
/**
 * Calcule le ratio heures/m³ pour évaluer la performance
 * @param {number} hours - Nombre d'heures travaillées
 * @param {number} m3 - Nombre de m³ coulés
 * @returns {number|null} - Ratio ou null si m³ = 0
 */
function calculateRatio(hours, m3) {
  if (m3 === 0 || m3 === null) return null;
  return hours / m3;
}

// Clé de stockage pour le seuil de performance du ratio h/m³
const KPI_RATIO_THRESHOLD_STORAGE_KEY = 'goudalle_thresholds';
// Seuil par défaut : 5h/m³ maximum pour être dans le vert
const DEFAULT_KPI_RATIO_THRESHOLD = 5;

/**
 * Récupère le seuil de performance configuré (ratio h/m³ max acceptable)
 * Supporte plusieurs formats pour compatibilité avec anciennes versions
 * @returns {number} - Seuil configuré ou valeur par défaut (5)
 */
function getKpiRatioThreshold() {
  const stored = localStorage.getItem(KPI_RATIO_THRESHOLD_STORAGE_KEY);
  if (!stored) return DEFAULT_KPI_RATIO_THRESHOLD;

  // ===== COMPATIBILITÉ MULTI-FORMATS =====
  // Cette fonction supporte plusieurs formats historiques pour éviter les erreurs :
  // - Format 1 : nombre brut ("5")
  // - Format 2 : objet { ratioThreshold: 5 }
  // - Format 3 : objet { threshold: 5 }
  // - Format ancien (ignoré) : { greenMax: 4.5, orangeMax: 5.5 }
  const trimmed = stored.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const asNumber = parseFloat(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;
  }

  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    if (parsed && typeof parsed.ratioThreshold === 'number' && Number.isFinite(parsed.ratioThreshold)) {
      return parsed.ratioThreshold;
    }
    if (parsed && typeof parsed.threshold === 'number' && Number.isFinite(parsed.threshold)) {
      return parsed.threshold;
    }
  } catch {
    // ignore
  }

  return DEFAULT_KPI_RATIO_THRESHOLD;
}

/**
 * Détermine le smiley (couleur) selon le ratio par rapport au seuil
 * @param {number|null} ratio - Ratio h/m³ calculé
 * @returns {string} - 'vert' (bon), 'rouge' (mauvais) ou 'neutral' (pas de données)
 */
function getSmiley(ratio) {
  if (ratio === null) return 'neutral';

  const threshold = getKpiRatioThreshold();
  // Si ratio <= seuil : performance bonne (vert), sinon mauvaise (rouge)
  return ratio <= threshold ? 'vert' : 'rouge';
}

/**
 * Génère une balise img du smiley selon le type (vert/rouge/neutral)
 * Utilise les images PNG du dossier assets
 * @param {string} smiley - Type : 'vert', 'rouge' ou 'neutral'
 * @returns {string} - Code HTML img du smiley
 */
function getSmileyEmoji(smiley) {
  const base = getBasePath();
  const images = {
    vert: `${base}assets/smiley%20vert.png`,
    rouge: `${base}assets/smiley%20rouge.png`,
    neutral: `${base}assets/smiley%20vert.png`  // Par défaut : vert
  };

  const imagePath = images[smiley] || images.vert;
  return `<img src="${imagePath}" alt="Smiley ${smiley}" class="smiley-emoji" loading="lazy">`;
}

// ============ PAGE DETECTION ============
/**
 * Retourne le nom de la page actuelle (ex: "gm.html", "index.html")
 * Permet de détecter quelle page est active pour le style de navigation
 * @returns {string} - Nom du fichier actuel
 */
function getCurrentPage() {
  const path = window.location.pathname;
  const filename = path.substring(path.lastIndexOf('/') + 1);
  return filename || 'index.html';
}

/**
 * Vérifie si l'utilisateur est sur une sous-page de Goudalle Maçonnerie
 * @returns {boolean} - true si on est sur gm.html, gm-saisie.html ou gm-admin.html
 */
function isProductionPage() {
  const page = getCurrentPage();
  return page === 'gm.html' || page === 'gm-saisie.html' || page === 'cbco-usine.html' || page === 'cbco-productivite-saisie.html' || page === 'indicateurs-generale.html';
}

/**
 * Vérifie si l'utilisateur est sur une sous-page de Goudalle Charpente
 * @returns {boolean} - true si on est sur gc.html ou gc-saisie.html
 */
function isCommercialPage() {
  const page = getCurrentPage();
  return page === 'cbco.html' || page === 'cbco-saisie.html' || page === 'cbco-commercial.html';
}

function isComptaPage() {
  const page = getCurrentPage();
  return page === 'sylve-support.html' || page === 'sylve-support-saisie.html' || page === 'gc-paiement.html' || page === 'gm-paiement.html' || page === 'cbco-paiement.html';
}

// ============ WEEK UTILS ============
/**
 * Calcule le numéro de semaine ISO 8601 d'une date
 * Norme : La semaine 1 est celle qui contient le premier jeudi de l'année
 * @param {Date} date - Date à analyser (par défaut : aujourd'hui)
 * @returns {number} - Numéro de semaine (1-53)
 */
function getWeekNumber(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;  // Lundi = 1, Dimanche = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // Jeudi de cette semaine
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Retourne l'année en cours
 * @returns {number} - Année (ex: 2026)
 */
function getCurrentYear() {
  return new Date().getFullYear();
}

// ============ EXERCICE FISCAL (1er oct → 30 sept) ============
/**
 * Calcule l'année de début de l'exercice fiscal (1er oct - 30 sept)
 * Ex : octobre 2025 → exercice 2025 (= 2025/2026), mars 2026 → exercice 2025
 * @param {number} year - Année calendaire
 * @param {number} month - Mois (1-12)
 * @returns {number} - Année de début de l'exercice
 */
function getFiscalYear(year, month) {
  return month >= 10 ? year : year - 1;
}

/**
 * Retourne le libellé d'un exercice fiscal (ex : "2025/2026")
 * @param {number} fiscalYearStart - Année de début de l'exercice
 * @returns {string} - Libellé "YYYY/YYYY+1"
 */
function getFiscalYearLabel(fiscalYearStart) {
  return `${fiscalYearStart}/${fiscalYearStart + 1}`;
}

/**
 * Retourne la position d'un mois dans l'exercice fiscal
 * Octobre = 1, Novembre = 2, Décembre = 3, Janvier = 4, ..., Septembre = 12
 * @param {number} month - Mois calendaire (1-12)
 * @returns {number} - Position dans l'exercice (1-12)
 */
function getFiscalMonth(month) {
  return month >= 10 ? month - 9 : month + 3;
}

/**
 * Retourne l'exercice fiscal en cours
 * @returns {number} - Année de début de l'exercice en cours
 */
function getCurrentFiscalYear() {
  const now = new Date();
  return getFiscalYear(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Retourne le numéro de la semaine en cours
 * @returns {number} - Numéro de semaine (1-53)
 */
function getCurrentWeek() {
  return getWeekNumber();
}

/**
 * Retourne les dates du lundi et vendredi d'une semaine donnée
 * @param {number} week - Numéro de semaine (1-53)
 * @param {number} year - Année (ex: 2026)
 * @returns {object} - {monday: 'jj/mm/yyyy', friday: 'jj/mm/yyyy'}
 */
function getWeekDateRange(week, year) {
  // ISO 8601 : la semaine 1 est celle qui contient le 4 janvier
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Lundi=1 ... Dimanche=7

  // Lundi de la semaine 1 ISO
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);

  // Lundi de la semaine demandée
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);

  // Vendredi de la semaine demandée
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  // Format jj/mm/aaaa (en UTC pour éviter les décalages de fuseau)
  const formatDate = (date) => {
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${d}/${m}/${y}`;
  };

  return {
    monday: formatDate(monday),
    friday: formatDate(friday)
  };
}

/**
 * Formate un numéro de semaine en chaîne (ex: 5 → "S05")
 * @param {number} week - Numéro de semaine
 * @returns {string} - Format "SXX"
 */
function getWeekString(week) {
  return `S${String(week).padStart(2, '0')}`;
}

/**
 * Compare deux objets indicateur par année et semaine (ordre décroissant)
 * Utilisé pour trier les indicateurs du plus récent au plus ancien
 * @param {Object} a - Premier indicateur {year, week}
 * @param {Object} b - Deuxième indicateur {year, week}
 * @returns {number} - Résultat de comparaison pour Array.sort()
 */
function compareByYearWeekDesc(a, b) {
  if (a.year !== b.year) {
    return b.year - a.year;  // Année la plus récente en premier
  }
  return b.week - a.week;  // Puis semaine la plus récente
}

/**
 * Récupère le dernier indicateur publié (le plus récent)
 * @returns {Object|null} - Indicateur le plus récent ou null si aucun
 */
function getLastPublishedWeek() {
  const kpis = getKPIs();
  const published = kpis.filter(k => k.status === 'published').sort(compareByYearWeekDesc);
  return published[0] || null;
}

// ============ INDICATEURS STORAGE ============
/**
 * Récupère tous les indicateurs stockés dans localStorage
 * @returns {Array} - Liste des indicateurs ou tableau vide
 */
function getKPIs() {
  const kpis = localStorage.getItem('goudalle_kpis');
  return kpis ? JSON.parse(kpis) : [];
}

/**
 * Enregistre ou met à jour un indicateur pour une semaine donnée
 * @param {number} year - Année
 * @param {number} week - Numéro de semaine
 * @param {number} m3 - m³ coulés
 * @param {number} hours - Heures travaillées
 * @param {string} comment - Commentaire sur la semaine
 * @param {string} status - Statut : 'draft' (brouillon) ou 'published' (publié)
 * @returns {Object} - Indicateur créé/mis à jour
 */
function saveKPI(year, week, m3, hours, comment, status = 'draft', timeDistribution = null) {
  const kpis = getKPIs();
  
  // Vérifier si un indicateur existe déjà pour cette semaine (mise à jour)
  const existing = kpis.find(k => k.year === year && k.week === week);
  
  // Créer ou mettre à jour l'indicateur
  const kpi = {
    id: existing?.id || Date.now(),  // Conserver l'ID si mise à jour
    year,
    week,
    m3: parseFloat(m3),
    hours: parseFloat(hours),
    comment,
    status,
    tempsBeton: timeDistribution?.beton ?? existing?.tempsBeton ?? null,
    tempsAciers: timeDistribution?.aciers ?? existing?.tempsAciers ?? null,
    tempsChargement: timeDistribution?.chargement ?? existing?.tempsChargement ?? null,
    tempsCentrale: timeDistribution?.centrale ?? existing?.tempsCentrale ?? null,
    createdAt: existing?.createdAt || new Date().toISOString(),  // Conserver date création
    createdBy: existing?.createdBy || Auth.getSession().username,
    updatedAt: new Date().toISOString(),  // Mettre à jour la date de modification
    updatedBy: Auth.getSession().username
  };

  // Supprimer l'ancien indicateur de cette semaine s'il existe, puis ajouter le nouveau
  const filtered = kpis.filter(k => !(k.year === year && k.week === week));
  filtered.push(kpi);
  
  localStorage.setItem('goudalle_kpis', JSON.stringify(filtered));
  Auth.audit('KPI_SAVED', `Indicateur S${String(week).padStart(2, '0')}/${year} - Status: ${status}`);
  
  return kpi;
}

/**
 * Publie un indicateur en brouillon (le rend visible à tous)
 * @param {number} year - Année de l'indicateur
 * @param {number} week - Semaine de l'indicateur
 * @returns {Object} - { success: boolean, message: string }
 */
function publishKPI(year, week) {
  const kpis = getKPIs();
  const kpi = kpis.find(k => k.year === year && k.week === week);
  
  if (!kpi) return { success: false, message: '❌ Indicateur non trouvé' };
  
  kpi.status = 'published';
  kpi.updatedAt = new Date().toISOString();
  kpi.updatedBy = Auth.getSession().username;
  
  localStorage.setItem('goudalle_kpis', JSON.stringify(kpis));
  Auth.audit('KPI_PUBLISHED', `Indicateur S${String(week).padStart(2, '0')}/${year} publié`);
  
  return { success: true, message: '✅ Indicateur publié' };
}

/**
 * Supprime un indicateur pour une semaine donnée
 * @param {number} year - Année de l'indicateur
 * @param {number} week - Semaine de l'indicateur
 * @returns {Object} - { success: boolean, message: string }
 */
function deleteKPI(year, week) {
  const kpis = getKPIs();
  const index = kpis.findIndex(k => k.year === year && k.week === week);

  if (index === -1) return { success: false, message: '❌ Indicateur non trouvé' };

  kpis.splice(index, 1);
  localStorage.setItem('goudalle_kpis', JSON.stringify(kpis));
  Auth.audit('KPI_DELETED', `Indicateur S${String(week).padStart(2, '0')}/${year} supprimé`);

  return { success: true, message: '🗑️ Indicateur supprimé' };
}

// ============ UI HELPERS ============
/**
 * Détermine le chemin de base selon l'emplacement de la page
 * @returns {string} - '../' si dans /pages/, sinon './'
 */
function getBasePath() {
  return window.location.pathname.includes('/pages/') ? '../' : './';
}

/**
 * Génère le chemin vers le logo approprié
 * Variable globale APP_LOGO détermine quel logo afficher
 * @returns {string} - Chemin vers le fichier logo
 */
function getLogoPath() {
  const base = getBasePath();
  let logoFile = 'groupe.png';  // Logo par défaut
  if (window.APP_LOGO === 'maconnerie') {
    logoFile = 'goudalle-maconnerie.png';
  } else if (window.APP_LOGO === 'charpente') {
    logoFile = 'goudalle-charpente.png';
  } else if (window.APP_LOGO === 'cbco') {
    logoFile = 'cbco.png';
  } else if (window.APP_LOGO === 'sylve') {
    logoFile = 'sylve-support.png';
  }
  return `${base}assets/${logoFile}`;
}

/**
 * Génère le code HTML de la barre latérale (sidebar)
 * Le contenu varie selon les permissions de l'utilisateur connecté
 * Inclut une navigation hiérarchique avec sous-menus dépliants
 * @returns {string} - HTML complet de la sidebar
 */
function getSidebar() {
  const session = Auth.getSession();
  if (!session) return '';  // Pas de sidebar si non connecté

  const isDirection = Auth.isDirection();
  const base = getBasePath();
  const currentPage = getCurrentPage();

  const accueilActive = currentPage === 'index.html' ? ' active' : '';
  let items = `
    <a href="${base}index.html" class="sidebar-item${accueilActive}">🏠 Accueil</a>
  `;

  // ===== CHANTIERS (direction seulement - placeholder) =====
  if (isDirection) {
    const chantiersActive = currentPage === 'indicateurs-chantiers.html' ? ' active' : '';
    items += `<a href="${base}pages/indicateurs-chantiers.html" class="sidebar-item${chantiersActive}">🚧 Chantiers</a>`;
  }

  // ===== PRODUCTION =====
  if (Auth.canViewGM() || Auth.hasAccess('gm_saisie') || Auth.hasAccess('cbco_usine') || Auth.hasAccess('cbco_productivite_saisie')) {
    const productionActive = isProductionPage() ? ' active' : '';
    // Pointer vers la première page accessible dans la section production
    let productionHref = `${base}pages/gm.html`;
    if (!Auth.canViewGM()) {
      if (Auth.hasAccess('cbco_usine')) productionHref = `${base}pages/cbco-usine.html`;
      else if (Auth.hasAccess('gm_saisie')) productionHref = `${base}pages/gm-saisie.html`;
      else if (Auth.hasAccess('cbco_productivite_saisie')) productionHref = `${base}pages/cbco-productivite-saisie.html`;
    }
    items += `<a href="${productionHref}" class="sidebar-item${productionActive}">🏭 Production</a>`;
  }

  // ===== COMMERCIAUX =====
  if (Auth.hasAccess('cbco') || Auth.hasAccess('cbco_saisie') || Auth.hasAccess('cbco_commercial')) {
    const commercialActive = isCommercialPage() ? ' active' : '';
    // Pointer vers la première page accessible dans la section commerciale
    let commercialHref = `${base}pages/cbco.html`;
    if (!Auth.hasAccess('cbco')) {
      if (Auth.hasAccess('cbco_saisie')) commercialHref = `${base}pages/cbco-saisie.html`;
      else if (Auth.hasAccess('cbco_commercial')) commercialHref = `${base}pages/cbco-commercial.html`;
    }
    items += `<a href="${commercialHref}" class="sidebar-item${commercialActive}">💼 Commerce</a>`;
  }

  // ===== ACHAT (direction seulement - placeholder) =====
  if (isDirection) {
    const achatActive = currentPage === 'indicateurs-achat.html' ? ' active' : '';
    items += `<a href="${base}pages/indicateurs-achat.html" class="sidebar-item${achatActive}">🛒 Achat</a>`;
  }

  // ===== RH (direction seulement - placeholder) =====
  if (isDirection) {
    const rhActive = currentPage === 'indicateurs-rh.html' ? ' active' : '';
    items += `<a href="${base}pages/indicateurs-rh.html" class="sidebar-item${rhActive}">👷 RH</a>`;
  }

  // ===== COMPTABILITÉ =====
  if (Auth.canViewSylve() || Auth.hasAccess('gc_paiement') || Auth.hasAccess('gm_paiement') || Auth.hasAccess('cbco_paiement') || Auth.hasAccess('sylve_saisie')) {
    const comptaActive = isComptaPage() ? ' active' : '';
    // Pointer vers la première page accessible dans la section comptabilité
    let comptaHref = `${base}pages/sylve-support.html`;
    if (!Auth.canViewSylve()) {
      if (Auth.hasAccess('sylve_saisie')) comptaHref = `${base}pages/sylve-support-saisie.html`;
      else if (Auth.hasAccess('gc_paiement')) comptaHref = `${base}pages/gc-paiement.html`;
      else if (Auth.hasAccess('gm_paiement')) comptaHref = `${base}pages/gm-paiement.html`;
      else if (Auth.hasAccess('cbco_paiement')) comptaHref = `${base}pages/cbco-paiement.html`;
    }
    items += `<a href="${comptaHref}" class="sidebar-item${comptaActive}">📒 Comptabilité</a>`;
  }

  // ===== SECTIONS ADMINISTRATIVES (direction uniquement) =====
  if (isDirection) {
    const usersActive = isUsersPage() ? ' active' : '';
    items += `
      <a href="${base}pages/users-admin.html" class="sidebar-item${usersActive}">👥 Utilisateurs</a>
    `;
  }

  // ===== LIENS COMMUNS À TOUS LES UTILISATEURS =====
  const accountActive = currentPage === 'account.html' ? ' active' : '';
  items += `
    <a href="${base}pages/account.html" class="sidebar-item${accountActive}">👤 Profil</a>
  `;

  return `
    <aside class="sidebar">
      <div class="topbar">
        <div>Tel. +33 (0)3 21 90 98 98</div>
        <div><a href="#">Contact</a></div>
      </div>
      <div class="mainbar">
        <div class="brand">
        </div>
        <nav class="sidebar-nav">
          ${items}
        </nav>
        <div class="user-badge">
          ${session.displayName}
          <a href="#" onclick="logoutUser(); return false;" style="display:block; margin-top:6px; font-size:11px; color:#b85c5c; text-decoration:none; font-weight:600;">🚪 Déconnexion</a>
        </div>
      </div>
    </aside>
    <script>
      // Restaurer l'état des sous-menus après injection de la sidebar
      setTimeout(function() {
        if (typeof restoreSubMenuStates === 'function') {
          restoreSubMenuStates();
        }
      }, 50);
    </script>
  `;
}

/**
 * Déconnecte l'utilisateur après confirmation
 * Redirige vers la page de connexion
 */
function logoutUser() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    Auth.logout();  // Supprime la session
    window.location.href = `${getBasePath()}login.html`;
  }
}

/**
 * Toggle (ouvrir/fermer) un sous-menu de navigation
 * Sauvegarde l'état dans localStorage pour persistence
 * @param {Event} event - Événement du clic
 * @param {string} submenuId - ID du sous-menu à toggler
 */
function toggleSubMenu(event, submenuId) {
  event.preventDefault();
  event.stopPropagation();
  
  const submenu = document.getElementById(submenuId);
  const toggle = event.currentTarget;
  const arrow = toggle.querySelector('.submenu-arrow');
  
  if (!submenu) return;
  
  // Toggle la classe active
  const isOpen = submenu.classList.toggle('open');
  toggle.classList.toggle('active', isOpen);
  
  // Rotation de la flèche
  if (arrow) {
    arrow.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  }
  
  // Sauvegarder l'état dans localStorage
  localStorage.setItem(`submenu_${submenuId}`, isOpen ? 'open' : 'closed');
}

/**
 * Génère et injecte la barre de navigation secondaire Goudalle Maçonnerie
 * À appeler sur toutes les pages GM (gm.html, gm-saisie.html, etc.)
 */
function injectProductionSecondaryBar() {
  const session = Auth.getSession();
  if (!session) return;

  const base = getBasePath();
  const currentPage = getCurrentPage();

  let secondaryItems = '';

  if (Auth.canViewGM() || Auth.hasAccess('gm_saisie') || Auth.hasAccess('cbco_usine') || Auth.hasAccess('cbco_productivite_saisie')) {
    const generaleActive = currentPage === 'indicateurs-generale.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/indicateurs-generale.html" class="sidebar-item${generaleActive}">📈 Indicateures générale</a>`;
  }

  if (Auth.canViewGM()) {
    const gmActive = currentPage === 'gm.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/gm.html" class="sidebar-item${gmActive}">📊 Indicateurs Maçonnerie</a>`;
  }
  if (Auth.hasAccess('cbco_usine')) {
    const usineActive = currentPage === 'cbco-usine.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco-usine.html" class="sidebar-item${usineActive}">🏭 Indicateurs Usine CBCO</a>`;
  }
  if (Auth.hasAccess('gm_saisie')) {
    const saisieActive = currentPage === 'gm-saisie.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/gm-saisie.html" class="sidebar-item${saisieActive}">✏️ Saisie Indicateurs Maçonnerie</a>`;
  }
  if (Auth.hasAccess('cbco_productivite_saisie')) {
    const prodActive = currentPage === 'cbco-productivite-saisie.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco-productivite-saisie.html" class="sidebar-item${prodActive}">✏️ Saisie Productivité Usine</a>`;
  }

  if (secondaryItems) {
    const barHTML = `
      <aside class="sidebar-secondary" id="productionSidebar">
        <div class="sidebar-secondary-content">
          <div class="sidebar-secondary-title">🏭 Indicateurs Production</div>
          <button class="sidebar-secondary-close" onclick="toggleProductionSidebar();">✕</button>
          <nav class="sidebar-secondary-nav">
            ${secondaryItems}
          </nav>
        </div>
      </aside>
    `;

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.insertAdjacentHTML('afterend', barHTML);
    }

    const productionSidebar = document.getElementById('productionSidebar');
    if (productionSidebar) {
      productionSidebar.classList.add('open');
    }
  }
}

/**
 * Génère et injecte la barre de navigation secondaire Goudalle Charpente
 * À appeler sur toutes les pages GC (gc.html, gc-saisie.html)
 */
function injectCommercialSecondaryBar() {
  const session = Auth.getSession();
  if (!session) return;

  const base = getBasePath();
  const currentPage = getCurrentPage();

  let secondaryItems = '';

  if (Auth.hasAccess('cbco')) {
    const bureauActive = currentPage === 'cbco.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco.html" class="sidebar-item${bureauActive}">🏢 Indicateurs Bureau d'Étude</a>`;
  }
  if (Auth.hasAccess('cbco_saisie')) {
    const caActive = currentPage === 'cbco-saisie.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco-saisie.html" class="sidebar-item${caActive}">✏️ Saisie Chiffre d'Affaires</a>`;
  }
  if (Auth.hasAccess('cbco_commercial')) {
    const commercialActive = currentPage === 'cbco-commercial.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco-commercial.html" class="sidebar-item${commercialActive}">💼 Saisie Indicateurs Commerciaux</a>`;
  }

  if (secondaryItems) {
    const barHTML = `
      <aside class="sidebar-secondary" id="commercialSidebar">
        <div class="sidebar-secondary-content">
          <div class="sidebar-secondary-title">💼 Indicateurs Commerciaux</div>
          <button class="sidebar-secondary-close" onclick="toggleCommercialSidebar();">✕</button>
          <nav class="sidebar-secondary-nav">
            ${secondaryItems}
          </nav>
        </div>
      </aside>
    `;

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.insertAdjacentHTML('afterend', barHTML);
    }

    const commercialSidebar = document.getElementById('commercialSidebar');
    if (commercialSidebar) {
      commercialSidebar.classList.add('open');
    }
  }
}

// ============ CBCO CHIFFRE D'AFFAIRES DATA ============
/**
 * Récupère tous les enregistrements CBCO (chiffre d'affaires) du localStorage
 * @returns {Array} - Liste des enregistrements CBCO
 */
function getCBCOData() {
  const data = localStorage.getItem('goudalle_cbco_data');
  const entries = data ? JSON.parse(data) : [];
  
  // Recalculer les cumuls pour garantir la cohérence
  if (entries.length > 0) {
    calculateCBCOCumuls(entries);
  }
  
  return entries;
}

/**
 * Compare deux enregistrements CBCO par année et mois (décroissant)
 * Trie du plus récent au plus ancien
 * @param {Object} a - Premier enregistrement
 * @param {Object} b - Deuxième enregistrement
 * @returns {number} - Résultat pour Array.sort()
 */
function compareByYearMonthDesc(a, b) {
  if (a.year !== b.year) {
    return b.year - a.year;  // Année la plus récente en premier
  }
  return b.month - a.month;  // Puis mois le plus récent
}

/**
 * Sauvegarde ou met à jour une entrée CBCO (chiffre d'affaires)
 * @param {number} year - Année
 * @param {number} month - Mois (1-12)
 * @param {number} montantChantiersCours - Montant chantiers en cours
 * @param {number} montantChantiersTermines - Montant chantiers terminés
 * @returns {Object} - Entrée CBCO créée/mise à jour
 */
function saveCBCOEntry(year, month, montantChantiersCours, montantChantiersTermines) {
  const data = getCBCOData();
  
  // Vérifier si une entrée existe déjà pour ce mois/année
  const existing = data.find(e => e.year === year && e.month === month);
  
  // Calculer les totaux
  const montantTotal = parseFloat(montantChantiersCours) + parseFloat(montantChantiersTermines);
  
  // Créer ou mettre à jour l'entrée
  const entry = {
    id: existing?.id || Date.now(),
    year,
    month,
    montantChantiersCours: parseFloat(montantChantiersCours),
    montantChantiersTermines: parseFloat(montantChantiersTermines),
    montantTotal,
    cumulAnnuel: 0,  // Sera calculé après tri
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdBy: existing?.createdBy || Auth.getSession().username,
    updatedAt: new Date().toISOString(),
    updatedBy: Auth.getSession().username
  };

  // Remplacer l'ancien ou ajouter le nouveau
  const filtered = data.filter(e => !(e.year === year && e.month === month));
  filtered.push(entry);
  
  // Trier et calculer les cumuls annuels
  const sorted = filtered.sort(compareByYearMonthDesc);
  calculateCBCOCumuls(sorted);
  
  localStorage.setItem('goudalle_cbco_data', JSON.stringify(sorted));
  Auth.audit('CBCO_SAVED', `Entrée CBCO ${month}/${year} enregistrée`);
  
  return entry;
}

/**
 * Calcule les cumuls annuels pour chaque année dans les données CBCO
 * Met à jour le champ cumulAnnuel pour chaque entrée
 * @param {Array} data - Données CBCO (ordre n'importe pas, sera trié par année/mois)
 */
function calculateCBCOCumuls(data) {
  // Trier par exercice fiscal, puis par position dans l'exercice (oct → sept)
  data.sort((a, b) => {
    const fyA = getFiscalYear(a.year, a.month);
    const fyB = getFiscalYear(b.year, b.month);
    if (fyA !== fyB) return fyA - fyB;
    return getFiscalMonth(a.month) - getFiscalMonth(b.month);
  });

  // Grouper par exercice fiscal
  const byFiscalYear = {};
  data.forEach(entry => {
    const fy = getFiscalYear(entry.year, entry.month);
    if (!byFiscalYear[fy]) byFiscalYear[fy] = [];
    byFiscalYear[fy].push(entry);
  });

  // Pour chaque exercice, calculer les cumuls cumulatifs (oct → sept)
  Object.keys(byFiscalYear).sort((a, b) => a - b).forEach(fy => {
    let cumul = 0;
    byFiscalYear[fy].forEach(entry => {
      cumul += entry.montantTotal;
      entry.cumulAnnuel = cumul;
    });
  });
}

/**
 * Supprime une entrée CBCO (chiffre d'affaires)
 * @param {number} year - Année
 * @param {number} month - Mois
 * @returns {Object} - { success, message }
 */
function deleteCBCOEntry(year, month) {
  const data = getCBCOData();
  const index = data.findIndex(e => e.year === year && e.month === month);

  if (index === -1) return { success: false, message: '❌ Entrée non trouvée' };

  data.splice(index, 1);
  // Recalculer les cumuls
  calculateCBCOCumuls(data);
  localStorage.setItem('goudalle_cbco_data', JSON.stringify(data));
  Auth.audit('CBCO_DELETED', `Entrée CBCO ${month}/${year} supprimée`);

  return { success: true, message: '✅ Entrée supprimée' };
}

/**
 * Récupère les données CBCO agrégées par année
 * Utile pour les graphiques annuels
 * @returns {Object} - { year: [{ month, montantTotal, cumulAnnuel }, ...], ... }
 */
function getCBCOByYear() {
  const data = getCBCOData();
  const byFiscalYear = {};

  data.forEach(entry => {
    const fy = getFiscalYear(entry.year, entry.month);
    if (!byFiscalYear[fy]) byFiscalYear[fy] = [];
    byFiscalYear[fy].push(entry);
  });

  // Trier les entrées de chaque exercice par position fiscale (oct → sept)
  Object.keys(byFiscalYear).forEach(fy => {
    byFiscalYear[fy].sort((a, b) => getFiscalMonth(a.month) - getFiscalMonth(b.month));
  });

  return byFiscalYear;
}

/**
 * Récupère les cumuls annuels CBCO (cumul total par année)
 * @returns {Array} - [{ year, totalAnnuel }, ...]
 */
function getCBCOYearlySummary() {
  const byYear = getCBCOByYear();
  
  return Object.keys(byYear)
    .map(year => {
      const entries = byYear[year];
      if (entries.length === 0) return null;
      
      // Le dernier mois de l'année aura le cumul annuel final
      const lastEntry = entries[entries.length - 1];
      return {
        year: parseInt(year),
        totalAnnuel: lastEntry.cumulAnnuel
      };
    })
    .filter(e => e !== null)
    .sort((a, b) => b.year - a.year);  // Trier par année décroissante
}

/**
 * Génère et injecte la barre de navigation secondaire CBCO
 * À appeler sur toutes les pages CBCO (cbco.html, cbco-saisie.html, etc.)
 */
function injectComptaSecondaryBar() {
  const session = Auth.getSession();
  if (!session) return;

  const base = getBasePath();
  const currentPage = getCurrentPage();

  let secondaryItems = '';

  if (Auth.canViewSylve()) {
    const dashActive = currentPage === 'sylve-support.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/sylve-support.html" class="sidebar-item${dashActive}">📊 Indicateurs Balance Âgée</a>`;
  }
  if (Auth.hasAccess('sylve_saisie')) {
    const saisieActive = currentPage === 'sylve-support-saisie.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/sylve-support-saisie.html" class="sidebar-item${saisieActive}">✏️ Saisie Factures</a>`;
  }
  if (Auth.hasAccess('gc_paiement')) {
    const gcPaiActive = currentPage === 'gc-paiement.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/gc-paiement.html" class="sidebar-item${gcPaiActive}">💳 Paiements en Attente - Charpente</a>`;
  }
  if (Auth.hasAccess('gm_paiement')) {
    const gmPaiActive = currentPage === 'gm-paiement.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/gm-paiement.html" class="sidebar-item${gmPaiActive}">💳 Paiements en Attente - Maçonnerie</a>`;
  }
  if (Auth.hasAccess('cbco_paiement')) {
    const cbcoPaiActive = currentPage === 'cbco-paiement.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco-paiement.html" class="sidebar-item${cbcoPaiActive}">💳 Paiements en Attente - CBCO</a>`;
  }

  if (secondaryItems) {
    const barHTML = `
      <aside class="sidebar-secondary" id="comptaSidebar">
        <div class="sidebar-secondary-content">
          <div class="sidebar-secondary-title">📒 Indicateurs Comptabilité</div>
          <button class="sidebar-secondary-close" onclick="toggleComptaSidebar();">✕</button>
          <nav class="sidebar-secondary-nav">
            ${secondaryItems}
          </nav>
        </div>
      </aside>
    `;

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.insertAdjacentHTML('afterend', barHTML);
    }

    const comptaSidebar = document.getElementById('comptaSidebar');
    if (comptaSidebar) {
      comptaSidebar.classList.add('open');
    }
  }
}

function isUsersPage() {
  const page = getCurrentPage();
  return page === 'users-admin.html' || page === 'users-code.html' || page === 'users-reminders.html';
}

/**
 * Fonction utilitaire pour formater les nombres en devise EUR
 * @param {number} value - La valeur à formater
 * @returns {string} - Valeur formatée (ex: "1 234,56 EUR")
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('fr-FR', { 
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Fonction utilitaire pour formater les nombres avec séparateurs
 * @param {number} value - La valeur à formater
 * @returns {string} - Valeur formatée (ex: "1 234,56")
 */
function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Toggle (ouvrir/fermer) la barre de navigation secondaire Goudalle Maçonnerie
 * @param {Event} event - Événement optionnel du clic
 */
function toggleProductionSidebar(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const productionSidebar = document.getElementById('productionSidebar');
  if (!productionSidebar) return;
  const isOpen = productionSidebar.classList.toggle('open');
  localStorage.setItem('production_sidebar_state', isOpen ? 'open' : 'closed');
}

/**
 * Toggle (ouvrir/fermer) la barre de navigation secondaire Goudalle Charpente
 * @param {Event} event - Événement optionnel du clic
 */
function toggleCommercialSidebar(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const commercialSidebar = document.getElementById('commercialSidebar');
  if (!commercialSidebar) return;
  const isOpen = commercialSidebar.classList.toggle('open');
  localStorage.setItem('commercial_sidebar_state', isOpen ? 'open' : 'closed');
}

/**
 * Toggle la barre de navigation secondaire CBCO
 * @param {Event} event - Événement du clic (optionnel)
 */
function toggleComptaSidebar(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const comptaSidebar = document.getElementById('comptaSidebar');
  if (!comptaSidebar) return;
  const isOpen = comptaSidebar.classList.toggle('open');
  localStorage.setItem('compta_sidebar_state', isOpen ? 'open' : 'closed');
}

/**
 * Génère et injecte la barre de navigation secondaire Utilisateurs
 * À appeler sur la page users-admin.html
 */
function injectUsersSecondaryBar() {
  const session = Auth.getSession();
  if (!session) return;

  const base = getBasePath();
  const currentPage = getCurrentPage();

  const usersActive = currentPage === 'users-admin.html' ? ' active' : '';
  const codeActive = currentPage === 'users-code.html' ? ' active' : '';
  const remindersActive = currentPage === 'users-reminders.html' ? ' active' : '';

  const secondaryItems = `
    <a href="${base}pages/users-admin.html" class="sidebar-item${usersActive}">👥 Utilisateurs</a>
    <a href="${base}pages/users-code.html" class="sidebar-item${codeActive}">🔐 Code admin</a>
    <a href="${base}pages/users-reminders.html" class="sidebar-item${remindersActive}">📧 Rappels email</a>
  `;

  const barHTML = `
    <aside class="sidebar-secondary" id="usersSidebar">
      <div class="sidebar-secondary-content">
        <div class="sidebar-secondary-title">👥 Administration</div>
        <button class="sidebar-secondary-close" onclick="toggleUsersSidebar();">✕</button>
        <nav class="sidebar-secondary-nav">
          ${secondaryItems}
        </nav>
      </div>
    </aside>
  `;

  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.insertAdjacentHTML('afterend', barHTML);
  }

  const usersSidebar = document.getElementById('usersSidebar');
  if (usersSidebar) {
    usersSidebar.classList.add('open');
  }
}

/**
 * Toggle la barre de navigation secondaire Utilisateurs
 */
function toggleUsersSidebar(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const usersSidebar = document.getElementById('usersSidebar');
  if (!usersSidebar) return;

  const isOpen = usersSidebar.classList.toggle('open');
  localStorage.setItem('users_sidebar_state', isOpen ? 'open' : 'closed');
}

/**
 * Restaure l'état de la barre de navigation secondaire depuis localStorage
 * Appelé automatiquement au chargement de la page
 */
function restoreSubMenuStates() {
  // Restaurer l'état du sidebar secondaire Production
  const productionState = localStorage.getItem('production_sidebar_state');
  if (productionState === 'open') {
    const productionSidebar = document.getElementById('productionSidebar');
    if (productionSidebar) {
      productionSidebar.classList.add('open');
    }
  }

  // Restaurer l'état du sidebar secondaire Commercial
  const commercialState = localStorage.getItem('commercial_sidebar_state');
  if (commercialState === 'open') {
    const commercialSidebar = document.getElementById('commercialSidebar');
    if (commercialSidebar) {
      commercialSidebar.classList.add('open');
    }
  }

  // Restaurer l'état du sidebar secondaire Comptabilité
  const comptaState = localStorage.getItem('compta_sidebar_state');
  if (comptaState === 'open') {
    const comptaSidebar = document.getElementById('comptaSidebar');
    if (comptaSidebar) {
      comptaSidebar.classList.add('open');
    }
  }

  // Restaurer l'état du sidebar secondaire Utilisateurs
  const usersState = localStorage.getItem('users_sidebar_state');
  if (usersState === 'open') {
    const usersSidebar = document.getElementById('usersSidebar');
    if (usersSidebar) {
      usersSidebar.classList.add('open');
    }
  }
}

// ============ CBCO COMMERCIAL (MÉMOIRES TECHNIQUES) ============

const CBCO_PRODUCTIVITE_KEY = 'goudalle_cbco_productivite';
const CBCO_SECURITE_KEY = 'goudalle_cbco_securite';
const CBCO_COMMERCIAL_KEY = 'goudalle_cbco_commercial';

function normalizeCBCOProductiviteNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getCBCOProductiviteData() {
  const raw = localStorage.getItem(CBCO_PRODUCTIVITE_KEY);
  const entries = raw ? JSON.parse(raw) : [];
  return entries
    .map(entry => computeCBCOProductiviteMetrics(entry))
    .sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      return (b.week || 0) - (a.week || 0);
    });
}

function computeCBCOProductiviteMetrics(entry) {
  const speedcutM3 = normalizeCBCOProductiviteNumber(entry.speedcutM3);
  const ultraM3 = normalizeCBCOProductiviteNumber(entry.ultraM3);
  const extraM2 = normalizeCBCOProductiviteNumber(entry.extraM2);
  const collageHeures = normalizeCBCOProductiviteNumber(entry.collageHeures);
  const collagePresses = normalizeCBCOProductiviteNumber(entry.collagePresses);
  const assemblageTempsRealise = normalizeCBCOProductiviteNumber(entry.assemblageTempsRealise);
  const assemblageTempsTheorique = normalizeCBCOProductiviteNumber(entry.assemblageTempsTheorique);
  const collageHeuresParPresse = collagePresses > 0 ? collageHeures / collagePresses : null;
  const assemblageRatio = assemblageTempsTheorique > 0 ? assemblageTempsRealise / assemblageTempsTheorique : null;
  const assemblageEcartHeures = assemblageTempsRealise - assemblageTempsTheorique;

  return {
    ...entry,
    speedcutM3,
    ultraM3,
    extraM2,
    collageHeures,
    collagePresses,
    assemblageTempsRealise,
    assemblageTempsTheorique,
    collageHeuresParPresse,
    assemblageRatio,
    assemblageEcartHeures
  };
}

function saveCBCOProductiviteEntry(entry) {
  const data = getCBCOProductiviteData();
  const week = parseInt(entry.week, 10);
  const year = parseInt(entry.year, 10);
  const existingIdx = data.findIndex(e => e.week === week && e.year === year);
  const normalized = computeCBCOProductiviteMetrics({
    id: existingIdx >= 0 ? data[existingIdx].id : Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    week,
    year,
    semaineLabel: entry.semaineLabel || `S${week} ${year}`,
    speedcutM3: entry.speedcutM3,
    ultraM3: entry.ultraM3,
    extraM2: entry.extraM2,
    collageHeures: entry.collageHeures,
    collagePresses: entry.collagePresses,
    assemblageTempsRealise: entry.assemblageTempsRealise,
    assemblageTempsTheorique: entry.assemblageTempsTheorique,
    importDate: new Date().toISOString(),
    updatedBy: Auth.getSession()?.username || 'system'
  });

  if (existingIdx >= 0) {
    data[existingIdx] = normalized;
  } else {
    data.push(normalized);
  }

  data.sort((a, b) => {
    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
    return (b.week || 0) - (a.week || 0);
  });
  localStorage.setItem(CBCO_PRODUCTIVITE_KEY, JSON.stringify(data));
  return normalized;
}

function replaceCBCOProductiviteData(entries) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(entry => computeCBCOProductiviteMetrics(entry))
    .filter(entry => Number(entry.week) > 0 && Number(entry.year) > 0);

  normalized.sort((a, b) => {
    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
    return (b.week || 0) - (a.week || 0);
  });

  localStorage.setItem(CBCO_PRODUCTIVITE_KEY, JSON.stringify(normalized));
  return normalized;
}

function deleteCBCOProductiviteEntry(id) {
  const data = getCBCOProductiviteData();
  const filtered = data.filter(e => e.id !== id);
  localStorage.setItem(CBCO_PRODUCTIVITE_KEY, JSON.stringify(filtered));
  return filtered.length !== data.length;
}

function getCBCOProductiviteLatest() {
  const data = getCBCOProductiviteData();
  return data.length > 0 ? data[0] : null;
}

function normalizeCBCOSecuriteData(entry) {
  const data = entry && typeof entry === 'object' ? entry : {};
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const year = toNum(data.anneeReference) || new Date().getFullYear();
  return {
    joursSansAccident: toNum(data.joursSansAccident),
    nombreAnnuelAccidents: toNum(data.nombreAnnuelAccidents),
    recordJoursSansAccident: toNum(data.recordJoursSansAccident),
    anneeReference: year,
    lastAccidentDate: data.lastAccidentDate ? String(data.lastAccidentDate) : '',
    lastAccidentPerson: data.lastAccidentPerson ? String(data.lastAccidentPerson) : '',
    importDate: data.importDate || new Date().toISOString()
  };
}

function getCBCOSecuriteData() {
  const raw = localStorage.getItem(CBCO_SECURITE_KEY);
  if (!raw) return normalizeCBCOSecuriteData({});
  try {
    return normalizeCBCOSecuriteData(JSON.parse(raw));
  } catch {
    return normalizeCBCOSecuriteData({});
  }
}

function replaceCBCOSecuriteData(entry) {
  const normalized = normalizeCBCOSecuriteData(entry);
  localStorage.setItem(CBCO_SECURITE_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * Récupère toutes les affaires commerciales CBCO
 * @returns {Array}
 */
function getCBCOCommercial() {
  const data = localStorage.getItem(CBCO_COMMERCIAL_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * Sauvegarde une nouvelle affaire commerciale
 * @param {Object} entry - { nomAffaire, montant, dateEnvoi }
 * @returns {Object} - L'entrée créée
 */
function saveCBCOCommercialEntry(entry) {
  const entries = getCBCOCommercial();
  const newEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    nomAffaire: entry.nomAffaire,
    montant: parseFloat(entry.montant) || 0,
    dateEnvoi: entry.dateEnvoi,
    resultat: 'en_cours',
    dateReponse: null,
    createdAt: new Date().toISOString()
  };
  entries.push(newEntry);
  localStorage.setItem(CBCO_COMMERCIAL_KEY, JSON.stringify(entries));
  return newEntry;
}

/**
 * Met à jour une affaire commerciale existante
 * @param {string} id - ID de l'affaire
 * @param {Object} updates - Champs à mettre à jour
 * @returns {boolean}
 */
function updateCBCOCommercialEntry(id, updates) {
  const entries = getCBCOCommercial();
  const index = entries.findIndex(e => e.id === id);
  if (index === -1) return false;
  entries[index] = { ...entries[index], ...updates };
  localStorage.setItem(CBCO_COMMERCIAL_KEY, JSON.stringify(entries));
  return true;
}

/**
 * Supprime une affaire commerciale
 * @param {string} id - ID de l'affaire
 * @returns {boolean}
 */
function deleteCBCOCommercialEntry(id) {
  const entries = getCBCOCommercial();
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length === entries.length) return false;
  localStorage.setItem(CBCO_COMMERCIAL_KEY, JSON.stringify(filtered));
  return true;
}

/**
 * Calcule le taux de réussite pour un mois/année donnés
 * @param {number} month - Mois (1-12)
 * @param {number} year - Année
 * @returns {Object} - { taux, gagnees, perdues, enCours, total }
 */
function getCBCOCommercialTauxReussite(month, year) {
  const entries = getCBCOCommercial().filter(e => {
    const d = new Date(e.dateEnvoi);
    return d.getMonth() + 1 === month && d.getFullYear() === year;
  });
  const gagnees = entries.filter(e => e.resultat === 'gagne').length;
  const perdues = entries.filter(e => e.resultat === 'perdu').length;
  const enCours = entries.filter(e => e.resultat === 'en_cours').length;
  const cloturees = gagnees + perdues;
  const taux = cloturees > 0 ? (gagnees / cloturees) * 100 : null;
  return { taux, gagnees, perdues, enCours, total: entries.length };
}

// ============ SYLVE SUPPORT DATA ============
const SYLVE_BALANCE_KEY = 'goudalle_sylve_balance';
const SYLVE_CA_KEY = 'goudalle_sylve_ca';
const SYLVE_PAIEMENTS_ATTENTE_KEY = 'goudalle_sylve_paiements_attente';
const SYLVE_ENTREPRISES = [
  { id: 'cbco', label: 'CBCO' },
  { id: 'gc', label: 'Goudalle Charpente' },
  { id: 'gm', label: 'Goudalle Maçonnerie' }
];
const SYLVE_MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/**
 * Structure stockée :
 * {
 *   cbco: [ { id, importDate, mois, annee, periode, clients: [{compte, client, solde, nonEchu, j1_30, j31_45, j46_60, j61_plus}] } ],
 *   gc:   [ ... ],
 *   gm:   [ ... ]
 * }
 * Les imports sont triés du plus récent au plus ancien (index 0 = dernier import)
 */

function getSylveBalance() {
  const data = localStorage.getItem(SYLVE_BALANCE_KEY);
  return data ? JSON.parse(data) : { cbco: [], gc: [], gm: [] };
}

/**
 * Récupère les informations de suivi "paiements en attente".
 * Structure :
 * {
 *   "entrepriseId::importId::compte": {
 *     selectedTypes: ["litiges", "regle"],
 *     amounts: { litiges: 1200, regle: 800 },
 *     commentaire,
 *     ...legacyFields,
 *     updatedAt
 *   }
 * }
 */
function getSylvePaiementsAttente() {
  const data = localStorage.getItem(SYLVE_PAIEMENTS_ATTENTE_KEY);
  return data ? JSON.parse(data) : {};
}

function saveSylvePaiementsAttente(data) {
  localStorage.setItem(SYLVE_PAIEMENTS_ATTENTE_KEY, JSON.stringify(data));
}

function getSylvePaiementAttente(entrepriseId, importId, compte) {
  const data = getSylvePaiementsAttente();
  const key = `${entrepriseId}::${importId}::${String(compte || '').trim()}`;
  return data[key] || {
    selectedTypes: [],
    amounts: {},
    chkSansRaison: false,
    chkAvecReserves: false,
    chkRgAttente: false,
    chkLitiges: false,
    chkSolde: false,
    chkAcompte: false,
    sansRaison: 0,
    avecReserves: 0,
    rgAttente: 0,
    litiges: 0,
    solde: 0,
    acompte: 0,
    commentaire: ''
  };
}

function saveSylvePaiementAttente(entrepriseId, importId, compte, payload) {
  const data = getSylvePaiementsAttente();
  const key = `${entrepriseId}::${importId}::${String(compte || '').trim()}`;
  const selectedTypes = Array.isArray(payload.selectedTypes)
    ? payload.selectedTypes.map(v => String(v || '').trim()).filter(Boolean)
    : [];
  const rawAmounts = (payload.amounts && typeof payload.amounts === 'object') ? payload.amounts : {};
  const amounts = {};
  Object.keys(rawAmounts).forEach(typeId => {
    const safeTypeId = String(typeId || '').trim();
    if (!safeTypeId) return;
    amounts[safeTypeId] = Number(rawAmounts[typeId]) || 0;
  });

  data[key] = {
    selectedTypes,
    amounts,
    chkSansRaison: !!payload.chkSansRaison,
    chkAvecReserves: !!payload.chkAvecReserves,
    chkRgAttente: !!payload.chkRgAttente,
    chkLitiges: !!payload.chkLitiges,
    chkSolde: !!payload.chkSolde,
    chkAcompte: !!payload.chkAcompte,
    sansRaison: Number(payload.sansRaison) || 0,
    avecReserves: Number(payload.avecReserves) || 0,
    rgAttente: Number(payload.rgAttente) || 0,
    litiges: Number(payload.litiges) || 0,
    solde: Number(payload.solde) || 0,
    acompte: Number(payload.acompte) || 0,
    commentaire: String(payload.commentaire || '').trim(),
    updatedAt: new Date().toISOString()
  };
  saveSylvePaiementsAttente(data);
}

function saveSylveBalance(data) {
  localStorage.setItem(SYLVE_BALANCE_KEY, JSON.stringify(data));
}

/**
 * Importe les données d'un fichier Excel balance âgée pour une entreprise et un mois donné.
 * Si un import existe déjà pour le même mois/année, il est remplacé.
 * Sinon, un nouvel import est ajouté à l'historique.
 */
function importSylveBalanceForEntreprise(entrepriseId, clients, periode, mois, annee) {
  const data = getSylveBalance();
  if (!data[entrepriseId]) data[entrepriseId] = [];

  // Vérifier si un import existe déjà pour ce mois/année
  const existingIdx = data[entrepriseId].findIndex(imp => imp.mois === mois && imp.annee === annee);

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    importDate: new Date().toISOString(),
    mois: mois,
    annee: annee,
    periode: periode || '',
    clients: clients
  };

  if (existingIdx !== -1) {
    // Remplacer l'import existant
    data[entrepriseId][existingIdx] = entry;
  } else {
    // Ajouter et trier par date décroissante (année puis mois)
    data[entrepriseId].push(entry);
    data[entrepriseId].sort((a, b) => {
      if (b.annee !== a.annee) return b.annee - a.annee;
      return b.mois - a.mois;
    });
  }

  saveSylveBalance(data);
}

/**
 * Supprime un import spécifique par son id
 */
function deleteSylveImport(entrepriseId, importId) {
  const data = getSylveBalance();
  if (!data[entrepriseId]) return;
  data[entrepriseId] = data[entrepriseId].filter(imp => imp.id !== importId);
  saveSylveBalance(data);
}

/**
 * Récupère tous les imports d'une entreprise (triés du plus récent au plus ancien)
 */
function getSylveImports(entrepriseId) {
  const data = getSylveBalance();
  return data[entrepriseId] || [];
}

/**
 * Récupère le dernier import (le plus récent) pour une entreprise
 */
function getSylveLastImport(entrepriseId) {
  const data = getSylveBalance();
  const imports = data[entrepriseId] || [];
  return imports.length > 0 ? imports[0] : null;
}

/**
 * Récupère tous les clients de toutes les entreprises (dernier import)
 */
function getSylveAllClients() {
  const data = getSylveBalance();
  const all = [];
  SYLVE_ENTREPRISES.forEach(e => {
    const imp = data[e.id] && data[e.id][0];
    if (imp) {
      imp.clients.forEach(c => {
        all.push({ ...c, entreprise: e.id });
      });
    }
  });
  return all;
}

/**
 * Calcule les totaux de retard par entreprise à partir des imports balance âgée
 */
function getSylveTotalRetards() {
  const data = getSylveBalance();
  const result = { cbco: 0, gc: 0, gm: 0, total: 0 };

  SYLVE_ENTREPRISES.forEach(e => {
    const imp = data[e.id] && data[e.id][0];
    if (imp) {
      imp.clients.forEach(c => {
        const retard = (c.j1_30 || 0) + (c.j31_45 || 0) + (c.j46_60 || 0) + (c.j61_plus || 0);
        result[e.id] += retard;
      });
      result.total += result[e.id];
    }
  });

  return result;
}

/**
 * Calcule la balance âgée consolidée par tranches
 */
function getSylveBalanceAgee() {
  const data = getSylveBalance();
  const result = {};
  SYLVE_ENTREPRISES.forEach(e => {
    result[e.id] = { j1_30: 0, j31_45: 0, j46_60: 0, j61_plus: 0, nonEchu: 0, total: 0 };
  });
  result.consolide = { j1_30: 0, j31_45: 0, j46_60: 0, j61_plus: 0, nonEchu: 0, total: 0 };

  SYLVE_ENTREPRISES.forEach(e => {
    const imp = data[e.id] && data[e.id][0];
    if (imp) {
      imp.clients.forEach(c => {
        result[e.id].j1_30 += (c.j1_30 || 0);
        result[e.id].j31_45 += (c.j31_45 || 0);
        result[e.id].j46_60 += (c.j46_60 || 0);
        result[e.id].j61_plus += (c.j61_plus || 0);
        result[e.id].nonEchu += (c.nonEchu || 0);
        result[e.id].total += (c.solde || 0);
      });
      result.consolide.j1_30 += result[e.id].j1_30;
      result.consolide.j31_45 += result[e.id].j31_45;
      result.consolide.j46_60 += result[e.id].j46_60;
      result.consolide.j61_plus += result[e.id].j61_plus;
      result.consolide.nonEchu += result[e.id].nonEchu;
      result.consolide.total += result[e.id].total;
    }
  });

  return result;
}

/**
 * Top clients en retard (classement consolidé)
 */
function getSylveClientsEnRetard() {
  const allClients = getSylveAllClients();
  const clientMap = {};
  let totalRetard = 0;

  allClients.forEach(c => {
    const retard = (c.j1_30 || 0) + (c.j31_45 || 0) + (c.j46_60 || 0) + (c.j61_plus || 0);
    if (retard <= 0) return;

    const key = c.client.toUpperCase().trim();
    if (!clientMap[key]) {
      clientMap[key] = { client: c.client, montant: 0, entreprises: new Set() };
    }
    clientMap[key].montant += retard;
    clientMap[key].entreprises.add(c.entreprise);
    totalRetard += retard;
  });

  return Object.values(clientMap)
    .map(c => ({
      client: c.client,
      montant: c.montant,
      pourcentage: totalRetard > 0 ? (c.montant / totalRetard * 100) : 0,
      entreprises: [...c.entreprises]
    }))
    .sort((a, b) => b.montant - a.montant);
}

/**
 * CA mensuel de référence (issu du dernier bilan)
 * Structure : { cbco: montant, gc: montant, gm: montant, bilanDate: 'YYYY-MM-DD' }
 * Rétrocompatible avec anciens formats:
 * - { cbco, gc, gm }
 * - { "YYYY-MM": { cbco, gc, gm, mois, annee }, ... }
 */
function getSylveCA() {
  const raw = localStorage.getItem(SYLVE_CA_KEY);
  if (!raw) return { cbco: 0, gc: 0, gm: 0, bilanDate: '' };

  const data = JSON.parse(raw);

  // Format courant
  if (data && typeof data === 'object' && ('bilanDate' in data || 'cbco' in data || 'gc' in data || 'gm' in data)) {
    return {
      cbco: Number(data.cbco) || 0,
      gc: Number(data.gc) || 0,
      gm: Number(data.gm) || 0,
      bilanDate: data.bilanDate || ''
    };
  }

  // Migration depuis ancien format par mois: prendre la période la plus récente
  const entries = Object.values(data || {}).filter(v => v && typeof v === 'object' && ('cbco' in v || 'gc' in v || 'gm' in v));
  if (entries.length > 0) {
    entries.sort((a, b) => {
      const ay = Number(a.annee) || 0;
      const by = Number(b.annee) || 0;
      if (by !== ay) return by - ay;
      return (Number(b.mois) || 0) - (Number(a.mois) || 0);
    });
    const latest = entries[0];
    const bilanDate = latest.annee && latest.mois
      ? `${latest.annee}-${String(latest.mois).padStart(2, '0')}-01`
      : '';
    return {
      cbco: Number(latest.cbco) || 0,
      gc: Number(latest.gc) || 0,
      gm: Number(latest.gm) || 0,
      bilanDate
    };
  }

  return { cbco: 0, gc: 0, gm: 0, bilanDate: '' };
}

function saveSylveCA(data) {
  const payload = {
    cbco: Number(data.cbco) || 0,
    gc: Number(data.gc) || 0,
    gm: Number(data.gm) || 0,
    bilanDate: data.bilanDate || ''
  };
  localStorage.setItem(SYLVE_CA_KEY, JSON.stringify(payload));
}

/**
 * Compatibilité d'affichage dashboard
 */
function getSylveCAList() {
  const ca = getSylveCA();
  return (ca.cbco || ca.gc || ca.gm) ? [ca] : [];
}

/**
 * Calcule le ratio retard/CA pour chaque mois importé
 * Utilise le CA du mois correspondant
 * Retourne un tableau trié par date : [{ mois, annee, label, cbco, gc, gm }]
 * où cbco/gc/gm = totalRetard / CA (nombre de mois de retard)
 */
function getSylveRetardCA() {
  const data = getSylveBalance();
  const ca = getSylveCA();
  const monthsMap = {};

  SYLVE_ENTREPRISES.forEach(e => {
    (data[e.id] || []).forEach(imp => {
      const key = `${imp.annee}-${String(imp.mois).padStart(2, '0')}`;
      if (!monthsMap[key]) {
        monthsMap[key] = { mois: imp.mois, annee: imp.annee, cbco: null, gc: null, gm: null };
      }
      const totalRetard = imp.clients.reduce((s, c) => s + ((c.j1_30||0) + (c.j31_45||0) + (c.j46_60||0) + (c.j61_plus||0)), 0);
      const caVal = Number(ca[e.id]) || 0;
      monthsMap[key][e.id] = caVal > 0 ? totalRetard / caVal : 0;
    });
  });

  return Object.values(monthsMap)
    .sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.mois - b.mois)
    .map(m => ({
      ...m,
      label: SYLVE_MOIS[m.mois].substring(0, 4).toLowerCase() + '-' + String(m.annee).slice(-2)
    }));
}

/**
 * Retard total mensuel par entreprise (en €)
 * Retourne un tableau trié par date : [{ mois, annee, label, cbco, gc, gm }]
 */
function getSylveRetardMensuel() {
  const data = getSylveBalance();
  const monthsMap = {};

  SYLVE_ENTREPRISES.forEach(e => {
    (data[e.id] || []).forEach(imp => {
      const key = `${imp.annee}-${String(imp.mois).padStart(2, '0')}`;
      if (!monthsMap[key]) {
        monthsMap[key] = { mois: imp.mois, annee: imp.annee, cbco: null, gc: null, gm: null };
      }
      const totalRetard = imp.clients.reduce((s, c) => s + ((c.j1_30||0) + (c.j31_45||0) + (c.j46_60||0) + (c.j61_plus||0)), 0);
      monthsMap[key][e.id] = totalRetard;
    });
  });

  return Object.values(monthsMap)
    .sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.mois - b.mois)
    .map(m => ({
      ...m,
      label: SYLVE_MOIS[m.mois].substring(0, 4).toLowerCase() + '-' + String(m.annee).slice(-2)
    }));
}

/**
 * Formate un montant en M€
 */
function formatMEuros(value) {
  return (value / 1000000).toFixed(2) + ' M€';
}

/**
 * Formate un montant en € lisible
 */
function formatSylveEuros(value) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value) + ' €';
}

// ============ SECURITY ============
/**
 * Événement déclenché au chargement complet du DOM
 * Peut être utilisé pour des vérifications de sécurité périodiques
 * Restaure aussi l'état des sous-menus
 */
document.addEventListener('DOMContentLoaded', function() {
  // NOTE : Possibilité d'ajouter une vérification périodique de session
  // Par exemple : setInterval(() => { if (!Auth.isConnected()) logout(); }, 5000);
  // Actuellement désactivé pour éviter les déconnexions intempestives
  
  // Restaurer l'état des sous-menus après un court délai
  setTimeout(restoreSubMenuStates, 100);
});
