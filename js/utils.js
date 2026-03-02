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
 * Génère le SVG du smiley selon le type (vert/rouge/neutral)
 * Utilise des SVG au lieu d'emojis pour permettre la personnalisation CSS
 * @param {string} smiley - Type : 'vert', 'rouge' ou 'neutral'
 * @returns {string} - Code HTML SVG du smiley
 */
function getSmileyEmoji(smiley) {
  // Note de compatibilité : retourne un SVG au lieu d'emoji Unicode
  // pour permettre d'appliquer des couleurs via CSS (currentColor)
  const svgBase = (path) => `
    <svg viewBox="0 0 24 24" width="1em" height="1em" class="smiley-icon" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      ${path}
    </svg>
  `.trim();

  const paths = {
    vert: '<path d="M8 14c1.2 1.6 2.6 2.4 4 2.4s2.8-.8 4-2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />',
    rouge: '<path d="M8 16c1.2-1.6 2.6-2.4 4-2.4s2.8.8 4 2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />',
    neutral: '<path d="M8 15h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />'
  };

  return svgBase(paths[smiley] || paths.neutral);
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
  const logoFile = window.APP_LOGO === 'maconnerie' ? 'goudalle-maconnerie.png' : 'groupe.png';
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

  // ===== CONSTRUCTION DU MENU HIÉRARCHIQUE SELON LES DROITS =====
  let items = `
    <a href="${base}index.html" class="sidebar-item">🏠 Accueil</a>
  `;

  // ===== SECTION GOUDALLE MAÇONNERIE (avec sous-menu) =====
  if (canView) {
    // Construire le sous-menu selon les permissions
    let gmSubItems = '';
    
    // Consultation GM - accessible à tous ceux qui ont accès à GM
    gmSubItems += `<a href="${base}pages/gm.html" class="sidebar-subitem">📊 Consultation</a>`;
    
    // Saisies - référents et direction
    if (canEdit) {
      gmSubItems += `<a href="${base}pages/gm-saisie.html" class="sidebar-subitem">✏️ Saisies indicateurs</a>`;
    }
    
    // Admin GM - direction uniquement
    if (isDirection) {
      gmSubItems += `<a href="${base}pages/gm-admin.html" class="sidebar-subitem">⚙️ Administration</a>`;
    }

    // Menu principal avec sous-menu
    items += `
      <div class="sidebar-menu-group">
        <a href="#" class="sidebar-item sidebar-toggle" onclick="toggleSubMenu(event, 'gm-submenu'); return false;">
          🏭 Goudalle Maçonnerie
          <span class="submenu-arrow">▼</span>
        </a>
        <div class="sidebar-submenu" id="gm-submenu">
          ${gmSubItems}
        </div>
      </div>
    `;
  }

  // ===== SECTIONS ADMINISTRATIVES (direction uniquement) =====
  if (isDirection) {
    items += `
      <a href="${base}pages/users-admin.html" class="sidebar-item">👥 Utilisateurs</a>
      <a href="${base}pages/audit.html" class="sidebar-item">📋 Audit</a>
    `;
  }

  // ===== LIENS COMMUNS À TOUS LES UTILISATEURS =====
  items += `
    <a href="${base}pages/account.html" class="sidebar-item">👤 Profil</a>
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
 * Restaure l'état des sous-menus depuis localStorage
 * Appelé automatiquement au chargement de la page
 */
function restoreSubMenuStates() {
  // Restaurer l'état du sous-menu GM
  const gmState = localStorage.getItem('submenu_gm-submenu');
  if (gmState === 'open') {
    const submenu = document.getElementById('gm-submenu');
    const toggle = document.querySelector('[onclick*="gm-submenu"]');
    const arrow = toggle?.querySelector('.submenu-arrow');
    
    if (submenu) {
      submenu.classList.add('open');
      toggle?.classList.add('active');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
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
