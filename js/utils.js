/**
 * UTILITAIRES GLOBAUX
 * Fonctions partagées : KPI, semaines, sidebar, etc.
 */

// ============ KPI UTILS ============
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
function isGMPage() {
  const page = getCurrentPage();
  return page === 'gm.html' || page === 'gm-saisie.html' || page === 'gm-admin.html';
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
 * Compare deux objets KPI par année et semaine (ordre décroissant)
 * Utilisé pour trier les KPI du plus récent au plus ancien
 * @param {Object} a - Premier KPI {year, week}
 * @param {Object} b - Deuxième KPI {year, week}
 * @returns {number} - Résultat de comparaison pour Array.sort()
 */
function compareByYearWeekDesc(a, b) {
  if (a.year !== b.year) {
    return b.year - a.year;  // Année la plus récente en premier
  }
  return b.week - a.week;  // Puis semaine la plus récente
}

/**
 * Récupère le dernier KPI publié (le plus récent)
 * @returns {Object|null} - KPI le plus récent ou null si aucun
 */
function getLastPublishedWeek() {
  const kpis = getKPIs();
  const published = kpis.filter(k => k.status === 'published').sort(compareByYearWeekDesc);
  return published[0] || null;
}

// ============ KPI STORAGE ============
/**
 * Récupère tous les KPI stockés dans localStorage
 * @returns {Array} - Liste des KPI ou tableau vide
 */
function getKPIs() {
  const kpis = localStorage.getItem('goudalle_kpis');
  return kpis ? JSON.parse(kpis) : [];
}

/**
 * Enregistre ou met à jour un KPI pour une semaine donnée
 * @param {number} year - Année
 * @param {number} week - Numéro de semaine
 * @param {number} m3 - m³ coulés
 * @param {number} hours - Heures travaillées
 * @param {string} comment - Commentaire sur la semaine
 * @param {string} status - Statut : 'draft' (brouillon) ou 'published' (publié)
 * @returns {Object} - KPI créé/mis à jour
 */
function saveKPI(year, week, m3, hours, comment, status = 'draft') {
  const kpis = getKPIs();
  
  // Vérifier si un KPI existe déjà pour cette semaine (mise à jour)
  const existing = kpis.find(k => k.year === year && k.week === week);
  
  // Créer ou mettre à jour le KPI
  const kpi = {
    id: existing?.id || Date.now(),  // Conserver l'ID si mise à jour
    year,
    week,
    m3: parseFloat(m3),
    hours: parseFloat(hours),
    comment,
    status,
    createdAt: existing?.createdAt || new Date().toISOString(),  // Conserver date création
    createdBy: existing?.createdBy || Auth.getSession().username,
    updatedAt: new Date().toISOString(),  // Mettre à jour la date de modification
    updatedBy: Auth.getSession().username
  };

  // Supprimer l'ancien KPI de cette semaine s'il existe, puis ajouter le nouveau
  const filtered = kpis.filter(k => !(k.year === year && k.week === week));
  filtered.push(kpi);
  
  localStorage.setItem('goudalle_kpis', JSON.stringify(filtered));
  Auth.audit('KPI_SAVED', `KPI S${String(week).padStart(2, '0')}/${year} - Status: ${status}`);
  
  return kpi;
}

/**
 * Publie un KPI en brouillon (le rend visible à tous)
 * @param {number} year - Année du KPI
 * @param {number} week - Semaine du KPI
 * @returns {Object} - { success: boolean, message: string }
 */
function publishKPI(year, week) {
  const kpis = getKPIs();
  const kpi = kpis.find(k => k.year === year && k.week === week);
  
  if (!kpi) return { success: false, message: '❌ KPI non trouvé' };
  
  kpi.status = 'published';
  kpi.updatedAt = new Date().toISOString();
  kpi.updatedBy = Auth.getSession().username;
  
  localStorage.setItem('goudalle_kpis', JSON.stringify(kpis));
  Auth.audit('KPI_PUBLISHED', `KPI S${String(week).padStart(2, '0')}/${year} publié`);
  
  return { success: true, message: '✅ KPI publié' };
}

/**
 * Supprime un KPI pour une semaine donnée
 * @param {number} year - Année du KPI
 * @param {number} week - Semaine du KPI
 * @returns {Object} - { success: boolean, message: string }
 */
function deleteKPI(year, week) {
  const kpis = getKPIs();
  const index = kpis.findIndex(k => k.year === year && k.week === week);

  if (index === -1) return { success: false, message: '❌ KPI non trouvé' };

  kpis.splice(index, 1);
  localStorage.setItem('goudalle_kpis', JSON.stringify(kpis));
  Auth.audit('KPI_DELETED', `KPI S${String(week).padStart(2, '0')}/${year} supprimé`);

  return { success: true, message: '🗑️ KPI supprimé' };
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
  } else if (window.APP_LOGO === 'cbco') {
    logoFile = 'cbco.png';
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

  // Récupérer les permissions de l'utilisateur
  const isDirection = Auth.isDirection();
  const canEdit = Auth.canEditGM();
  const canView = Auth.canViewGM();
  const base = getBasePath();

  // Détecter la page active pour le style
  const currentPage = getCurrentPage();
  const onGMPage = isGMPage();

  // ===== CONSTRUCTION DU MENU HIÉRARCHIQUE SELON LES DROITS =====
  const accueilActive = currentPage === 'index.html' ? ' active' : '';
  let items = `
    <a href="${base}index.html" class="sidebar-item${accueilActive}">🏠 Accueil</a>
  `;

  // ===== SECTION GOUDALLE MAÇONNERIE =====
  if (canView) {
    // Tous les utilisateurs avec accès : lien direct vers gm.html
    const gmActive = onGMPage ? ' active' : '';
    items += `<a href="${base}pages/gm.html" class="sidebar-item${gmActive}">🏭 Goudalle Maçonnerie</a>`;
  }

  // ===== SECTION CBCO =====
  if (Auth.canViewCBCO()) {
    const cbcoActive = isCBCOPage() ? ' active' : '';
    items += `<a href="${base}pages/cbco.html" class="sidebar-item${cbcoActive}">💼 CBCO</a>`;
  }

  // ===== SECTIONS ADMINISTRATIVES (direction uniquement) =====
  if (isDirection) {
    const usersActive = currentPage === 'users-admin.html' ? ' active' : '';
    const auditActive = currentPage === 'audit.html' ? ' active' : '';
    items += `
      <a href="${base}pages/users-admin.html" class="sidebar-item${usersActive}">👥 Utilisateurs</a>
      <a href="${base}pages/audit.html" class="sidebar-item${auditActive}">📋 Audit</a>
    `;
  }

  // ===== LIENS COMMUNS À TOUS LES UTILISATEURS =====
  const accountActive = currentPage === 'account.html' ? ' active' : '';
  items += `
    <a href="${base}pages/account.html" class="sidebar-item${accountActive}">👤 Profil</a>
    <a href="#" onclick="logoutUser(); return false;" class="sidebar-item logout">🚪 Déconnexion</a>
  `;

  return `
    <aside class="sidebar">
      <div class="topbar">
        <div>Tel. +33 (0)3 21 90 98 98</div>
        <div><a href="#">Contact</a></div>
      </div>
      <div class="mainbar">
        <div class="brand">
          <img src="${getLogoPath()}" alt="Logo">
          <div class="brand-text">
            <div class="brand-title">GOUDALLE</div>
            <div class="brand-subtitle">Intranet Groupe</div>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${items}
        </nav>
        <div class="user-badge">${session.displayName}</div>
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
function injectGMSecondaryBar() {
  const session = Auth.getSession();
  if (!session) return;

  const canEdit = Auth.canEditGM();
  const isDirection = Auth.isDirection();
  const base = getBasePath();

  // Détecter quelle sous-page GM est active
  const currentPage = getCurrentPage();

  // Construire les items de la barre secondaire
  let secondaryItems = '';
  
  // Consultation GM - accessible à tous
  const consultationActive = currentPage === 'gm.html' ? ' active' : '';
  secondaryItems += `<a href="${base}pages/gm.html" class="sidebar-item${consultationActive}">📊 Consultation</a>`;
  
  // Saisies - référents et direction
  if (canEdit) {
    const saisieActive = currentPage === 'gm-saisie.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/gm-saisie.html" class="sidebar-item${saisieActive}">✏️ Saisies indicateurs</a>`;
  }

  // Créer et injecter la barre secondaire
  if (secondaryItems) {
    const barHTML = `
      <aside class="sidebar-secondary" id="gmSidebar">
        <div class="sidebar-secondary-content">
          <div class="sidebar-secondary-title">🏭 Goudalle Maçonnerie</div>
          <button class="sidebar-secondary-close" onclick="toggleGMSidebar();">✕</button>
          <nav class="sidebar-secondary-nav">
            ${secondaryItems}
          </nav>
        </div>
      </aside>
    `;

    // Injecter après la sidebar principale
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.insertAdjacentHTML('afterend', barHTML);
    }

    // Ouvrir la barre par défaut sur cette page
    const gmSidebar = document.getElementById('gmSidebar');
    if (gmSidebar) {
      gmSidebar.classList.add('open');
    }
  }
}

// ============ CBCO COMMERCIAL DATA ============
/**
 * Récupère tous les enregistrements commerciaux CBCO du localStorage
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
 * Sauvegarde ou met à jour une entrée commerciale CBCO
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
 * @param {Array} data - Données triées CBCO
 */
function calculateCBCOCumuls(data) {
  // Grouper par année
  const byYear = {};
  
  data.forEach(entry => {
    if (!byYear[entry.year]) {
      byYear[entry.year] = [];
    }
    byYear[entry.year].push(entry);
  });

  // Pour chaque année, calculer les cumuls
  Object.keys(byYear).forEach(year => {
    let cumul = 0;
    // Trier les mois de l'année en ordre croissant pour cumul correct
    const yearEntries = byYear[year].sort((a, b) => a.month - b.month);
    
    yearEntries.forEach(entry => {
      cumul += entry.montantTotal;
      entry.cumulAnnuel = cumul;
    });
  });
}

/**
 * Supprime une entrée commerciale CBCO
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
  const byYear = {};
  
  data.forEach(entry => {
    if (!byYear[entry.year]) {
      byYear[entry.year] = [];
    }
    byYear[entry.year].push(entry);
  });
  
  // Trier les mois dans chaque année
  Object.keys(byYear).forEach(year => {
    byYear[year].sort((a, b) => a.month - b.month);
  });
  
  return byYear;
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
function injectCBCOSecondaryBar() {
  const session = Auth.getSession();
  if (!session) return;

  const canEdit = Auth.canEditCBCO();
  const base = getBasePath();

  // Détecter quelle sous-page CBCO est active
  const currentPage = getCurrentPage();

  // Construire les items de la barre secondaire
  let secondaryItems = '';
  
  // Consultation CBCO - accessible à tous
  const consultationActive = currentPage === 'cbco.html' ? ' active' : '';
  secondaryItems += `<a href="${base}pages/cbco.html" class="sidebar-item${consultationActive}">📊 Dashboard Indicateur</a>`;
  
  // Saisies - référents CBCO et direction
  if (canEdit) {
    const saisieActive = currentPage === 'cbco-saisie.html' ? ' active' : '';
    secondaryItems += `<a href="${base}pages/cbco-saisie.html" class="sidebar-item${saisieActive}">✏️ Saisies données</a>`;
  }

  // Créer et injecter la barre secondaire
  if (secondaryItems) {
    const barHTML = `
      <aside class="sidebar-secondary" id="cbcoSidebar">
        <div class="sidebar-secondary-content">
          <div class="sidebar-secondary-title">💼 CBCO</div>
          <button class="sidebar-secondary-close" onclick="toggleCBCOSidebar();">✕</button>
          <nav class="sidebar-secondary-nav">
            ${secondaryItems}
          </nav>
        </div>
      </aside>
    `;

    // Injecter après la sidebar principale
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.insertAdjacentHTML('afterend', barHTML);
    }

    // Ouvrir la barre par défaut sur cette page
    const cbcoSidebar = document.getElementById('cbcoSidebar');
    if (cbcoSidebar) {
      cbcoSidebar.classList.add('open');
    }
  }
}

/**
 * Verifies if current page is a CBCO page
 * @returns {boolean}
 */
function isCBCOPage() {
  const page = getCurrentPage();
  return page === 'cbco.html' || page === 'cbco-saisie.html' || page === 'cbco-admin.html';
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
function toggleGMSidebar(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  const gmSidebar = document.getElementById('gmSidebar');
  if (!gmSidebar) return;
  
  // Toggle la classe 'open'
  const isOpen = gmSidebar.classList.toggle('open');
  
  // Sauvegarder l'état dans localStorage
  localStorage.setItem('gm_sidebar_state', isOpen ? 'open' : 'closed');
}

/**
 * Toggle la barre de navigation secondaire CBCO
 * @param {Event} event - Événement du clic (optionnel)
 */
function toggleCBCOSidebar(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  const cbcoSidebar = document.getElementById('cbcoSidebar');
  if (!cbcoSidebar) return;
  
  // Toggle la classe 'open'
  const isOpen = cbcoSidebar.classList.toggle('open');
  
  // Sauvegarder l'état dans localStorage
  localStorage.setItem('cbco_sidebar_state', isOpen ? 'open' : 'closed');
}

/**
 * Restaure l'état de la barre de navigation secondaire depuis localStorage
 * Appelé automatiquement au chargement de la page
 */
function restoreSubMenuStates() {
  // Restaurer l'état du sidebar secondaire GM
  const gmState = localStorage.getItem('gm_sidebar_state');
  if (gmState === 'open') {
    const gmSidebar = document.getElementById('gmSidebar');
    if (gmSidebar) {
      gmSidebar.classList.add('open');
    }
  }

  // Restaurer l'état du sidebar secondaire CBCO
  const cbcoState = localStorage.getItem('cbco_sidebar_state');
  if (cbcoState === 'open') {
    const cbcoSidebar = document.getElementById('cbcoSidebar');
    if (cbcoSidebar) {
      cbcoSidebar.classList.add('open');
    }
  }
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
