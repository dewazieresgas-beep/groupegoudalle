/**
 * UTILITAIRES GLOBAUX
 * Fonctions partagées : KPI, semaines, sidebar, etc.
 */

// ============ KPI UTILS ============
function calculateRatio(hours, m3) {
  if (m3 === 0 || m3 === null) return null;
  return hours / m3;
}

function getSmiley(ratio) {
  if (ratio === null) return 'neutral';
  if (ratio < 4.5) return 'vert';
  if (ratio <= 5.5) return 'orange';
  return 'rouge';
}

function getSmileyEmoji(smiley) {
  return {
    vert: '🟢',
    orange: '🟠',
    rouge: '🔴',
    neutral: '◯'
  }[smiley] || '◯';
}

// ============ WEEK UTILS ============
function getWeekNumber(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function getCurrentWeek() {
  return getWeekNumber();
}

function getWeekString(week) {
  return `S${String(week).padStart(2, '0')}`;
}

function getLastPublishedWeek() {
  const kpis = getKPIs();
  const published = kpis.filter(k => k.status === 'published').sort((a, b) => b.id - a.id);
  return published[0] || null;
}

// ============ KPI STORAGE ============
function getKPIs() {
  const kpis = localStorage.getItem('goudalle_kpis');
  return kpis ? JSON.parse(kpis) : [];
}

function saveKPI(year, week, m3, hours, comment, status = 'draft') {
  const kpis = getKPIs();
  
  // Vérifier si existe déjà
  const existing = kpis.find(k => k.year === year && k.week === week);
  
  const kpi = {
    id: existing?.id || Date.now(),
    year,
    week,
    m3: parseFloat(m3),
    hours: parseFloat(hours),
    comment,
    status,
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdBy: existing?.createdBy || Auth.getSession().username,
    updatedAt: new Date().toISOString(),
    updatedBy: Auth.getSession().username
  };

  const filtered = kpis.filter(k => !(k.year === year && k.week === week));
  filtered.push(kpi);
  
  localStorage.setItem('goudalle_kpis', JSON.stringify(filtered));
  Auth.audit('KPI_SAVED', `KPI S${String(week).padStart(2, '0')}/${year} - Status: ${status}`);
  
  return kpi;
}

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
function getBasePath() {
  return window.location.pathname.includes('/pages/') ? '../' : './';
}

function getLogoPath() {
  const base = getBasePath();
  const logoFile = window.APP_LOGO === 'maconnerie' ? 'goudalle-maconnerie.png' : 'groupe.png';
  return `${base}assets/${logoFile}`;
}

function getSidebar() {
  const session = Auth.getSession();
  if (!session) return '';

  const isDirection = Auth.isDirection();
  const canEdit = Auth.canEditGM();
  const base = getBasePath();

  let items = `
    <a href="${base}index.html" class="sidebar-item">Accueil</a>
  `;

  if (Auth.canViewGM()) {
    items += `<a href="${base}pages/gm.html" class="sidebar-item">Goudalle Maconnerie</a>`;
  }

  if (canEdit) {
    items += `<a href="${base}pages/gm-saisie.html" class="sidebar-item">Saisie KPI</a>`;
  }

  if (isDirection) {
    items += `
      <a href="${base}pages/gm-admin.html" class="sidebar-item">Admin GM</a>
      <a href="${base}pages/users-admin.html" class="sidebar-item">Utilisateurs</a>
      <a href="${base}pages/audit.html" class="sidebar-item">Audit</a>
    `;
  }

  items += `
    <a href="${base}pages/account.html" class="sidebar-item">Profil</a>
    <a href="#" onclick="logoutUser(); return false;" class="sidebar-item logout">Deconnexion</a>
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
  `;
}

function logoutUser() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    Auth.logout();
    window.location.href = `${getBasePath()}login.html`;
  }
}

// ============ SECURITY ============
document.addEventListener('DOMContentLoaded', function() {
  // Vérifier la session toutes les 5 secondes (optionnel)
  // Utile pour détecter les changements de session en live
});
