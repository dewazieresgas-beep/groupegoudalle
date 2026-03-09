/**
 * Système de rappels par email pour la saisie des indicateurs
 * Utilise EmailJS (https://www.emailjs.com/) pour l'envoi depuis le frontend
 * 
 * Fonctionnement :
 * - Vérifie automatiquement au chargement du dashboard (direction uniquement)
 * - GM (hebdomadaire) : rappel le jour de la date butoir + relance le lundi suivant
 * - CBCO (mensuel) : rappel le jour de la date butoir + relance 2 jours après
 * - Chaque email contient un lien cliquable vers la page de saisie
 */

const Reminders = {
  STORAGE_KEY_CONFIG: 'goudalle_reminder_config',
  STORAGE_KEY_SENT: 'goudalle_reminders_sent',

  JOURS_FR: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  MOIS_FR: ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
            'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],

  // ============ CONFIGURATION ============

  getDefaultConfig() {
    return {
      enabled: false,
      gmDeadlineDay: 5,       // Jour de la semaine : 0=Dim, 1=Lun, 2=Mar, 3=Mer, 4=Jeu, 5=Ven, 6=Sam
      cbcoDeadlineDay: 5,     // Jour du mois (1-28)
      siteUrl: '',            // URL de base du site (ex: https://intranet.goudalle.fr)
      emailjsServiceId: '',
      emailjsTemplateId: '',
      emailjsPublicKey: ''
    };
  },

  getConfig() {
    const stored = localStorage.getItem(this.STORAGE_KEY_CONFIG);
    if (!stored) return this.getDefaultConfig();
    return { ...this.getDefaultConfig(), ...JSON.parse(stored) };
  },

  saveConfig(config) {
    localStorage.setItem(this.STORAGE_KEY_CONFIG, JSON.stringify(config));
  },

  // ============ HISTORIQUE DES ENVOIS ============

  getSentReminders() {
    const stored = localStorage.getItem(this.STORAGE_KEY_SENT);
    return stored ? JSON.parse(stored) : [];
  },

  recordSentReminder(entry) {
    const sent = this.getSentReminders();
    sent.push({ ...entry, sentAt: new Date().toISOString() });
    if (sent.length > 500) sent.splice(0, sent.length - 500);
    localStorage.setItem(this.STORAGE_KEY_SENT, JSON.stringify(sent));
  },

  wasAlreadySent(type, period, year, username) {
    return this.getSentReminders().some(r =>
      r.type === type && r.period === period && r.year === year && r.sentTo === username
    );
  },

  // ============ VÉRIFICATION DES DONNÉES ============

  /**
   * Vérifie si un indicateur GM existe pour la semaine donnée
   */
  hasGMData(week, year) {
    const kpis = getKPIs();
    return kpis.some(k => k.week === week && k.year === year);
  },

  /**
   * Vérifie si des données CBCO existent pour le mois donné
   */
  hasCBCOData(month, year) {
    const data = getCBCOData();
    return data.some(d => d.month === month && d.year === year &&
      (d.montantChantiersCours > 0 || d.montantChantiersTermines > 0));
  },

  // ============ ENVOI D'EMAIL ============

  async sendEmail(config, toEmail, toName, subject, message) {
    if (!window.emailjs) {
      console.warn('EmailJS SDK non chargé');
      return false;
    }
    try {
      await emailjs.send(config.emailjsServiceId, config.emailjsTemplateId, {
        to_email: toEmail,
        to_name: toName,
        subject: subject,
        message: message
      }, config.emailjsPublicKey);
      return true;
    } catch (err) {
      console.error('Erreur EmailJS:', err);
      return false;
    }
  },

  // ============ VÉRIFICATION ET ENVOI DES RAPPELS ============

  /**
   * Vérifie et envoie les rappels nécessaires
   * @returns {Array} Liste des rappels envoyés [{type, user, indicator}]
   */
  async checkAndSendReminders() {
    const config = this.getConfig();
    if (!config.enabled) return [];
    if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) return [];

    const today = new Date();
    const todayDay = today.getDay(); // 0=Dim..6=Sam
    const todayDate = today.getDate();
    const results = [];
    const users = Auth.getAllUsers();
    const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');
    const gmLink = baseUrl ? `${baseUrl}/pages/gm-saisie.html` : '';
    const cbcoLink = baseUrl ? `${baseUrl}/pages/cbco-saisie.html` : '';

    // ===== RAPPELS GM (hebdomadaire) =====
    // 1er rappel = le jour de la date butoir
    // 2e rappel (relance) = le lundi suivant si toujours pas saisi
    const isGmDeadline = todayDay === config.gmDeadlineDay;
    const isGmRelance = todayDay === 1; // Lundi

    if (isGmDeadline || isGmRelance) {
      const week = getCurrentWeek();
      const year = getCurrentYear();
      // Pour la relance du lundi, vérifier la semaine précédente
      const checkWeek = isGmRelance ? (week === 1 ? 52 : week - 1) : week;
      const checkYear = isGmRelance && week === 1 ? year - 1 : year;
      const type = isGmDeadline ? 'gm_deadline' : 'gm_relance';

      if (!this.hasGMData(checkWeek, checkYear)) {
        const referents = Object.values(users).filter(u =>
          u.isActive && u.role === 'referent' && u.email
        );

        const deadlineStr = this.JOURS_FR[config.gmDeadlineDay];
        const linkHtml = gmLink ? `\n\n👉 Saisir maintenant : ${gmLink}` : '';

        for (const user of referents) {
          if (this.wasAlreadySent(type, checkWeek, checkYear, user.username)) continue;

          const sLabel = `S${String(checkWeek).padStart(2, '0')}/${checkYear}`;

          const subject = isGmDeadline
            ? `⏰ Rappel : Saisie indicateur GM – ${sLabel}`
            : `🚨 Relance : Indicateur GM non saisi – ${sLabel}`;

          const message = isGmDeadline
            ? `Bonjour ${user.displayName},\n\nC'est aujourd'hui ${deadlineStr}, date limite pour saisir les indicateurs Goudalle Maçonnerie de la semaine ${checkWeek} (${checkYear}).\n\nMerci de vous connecter pour effectuer la saisie.${linkHtml}\n\nCordialement,\nIntranet Goudalle`
            : `Bonjour ${user.displayName},\n\n⚠️ Les indicateurs Goudalle Maçonnerie de la semaine ${checkWeek} (${checkYear}) n'ont toujours pas été saisis.\n\nLa date limite était ${deadlineStr} dernier. Merci de régulariser la situation dès que possible.${linkHtml}\n\nCordialement,\nIntranet Goudalle`;

          const sent = await this.sendEmail(config, user.email, user.displayName, subject, message);
          if (sent) {
            this.recordSentReminder({ type, period: checkWeek, year: checkYear, sentTo: user.username });
            Auth.audit('REMINDER_SENT', `${type} → ${user.displayName} (${user.email}) – ${sLabel}`);
            results.push({ type, user: user.displayName, indicator: 'GM' });
          }
        }
      }
    }

    // ===== RAPPELS CBCO (mensuel) =====
    // 1er rappel = le jour de la date butoir
    // 2e rappel (relance) = 2 jours après si toujours pas saisi
    const isCbcoDeadline = todayDate === config.cbcoDeadlineDay;
    const isCbcoRelance = todayDate === config.cbcoDeadlineDay + 2;

    if (isCbcoDeadline || isCbcoRelance) {
      const type = isCbcoDeadline ? 'cbco_deadline' : 'cbco_relance';

      const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
      const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

      if (!this.hasCBCOData(prevMonth, prevYear)) {
        const referents = Object.values(users).filter(u =>
          u.isActive && u.role === 'referent_cbco' && u.email
        );

        const prevMonthName = this.MOIS_FR[prevMonth];
        const linkHtml = cbcoLink ? `\n\n👉 Saisir maintenant : ${cbcoLink}` : '';

        for (const user of referents) {
          if (this.wasAlreadySent(type, prevMonth, prevYear, user.username)) continue;

          const subject = isCbcoDeadline
            ? `⏰ Rappel : Saisie CBCO – ${prevMonthName} ${prevYear}`
            : `🚨 Relance : Données CBCO non saisies – ${prevMonthName} ${prevYear}`;

          const message = isCbcoDeadline
            ? `Bonjour ${user.displayName},\n\nC'est aujourd'hui la date limite pour saisir vos données CBCO pour ${prevMonthName} ${prevYear}.\n\nMerci de vous connecter pour effectuer la saisie.${linkHtml}\n\nCordialement,\nIntranet Goudalle`
            : `Bonjour ${user.displayName},\n\n⚠️ Les données CBCO pour ${prevMonthName} ${prevYear} n'ont toujours pas été saisies.\n\nLa date limite était le ${config.cbcoDeadlineDay}. Merci de régulariser la situation dès que possible.${linkHtml}\n\nCordialement,\nIntranet Goudalle`;

          const sent = await this.sendEmail(config, user.email, user.displayName, subject, message);
          if (sent) {
            this.recordSentReminder({ type, period: prevMonth, year: prevYear, sentTo: user.username });
            Auth.audit('REMINDER_SENT', `${type} → ${user.displayName} (${user.email}) – ${prevMonthName} ${prevYear}`);
            results.push({ type, user: user.displayName, indicator: 'CBCO' });
          }
        }
      }
    }

    return results;
  },

  /**
   * Envoie un email de test pour vérifier la configuration
   */
  async sendTestEmail() {
    const config = this.getConfig();
    if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) {
      return { success: false, message: '❌ Configuration EmailJS incomplète' };
    }

    const session = Auth.getSession();
    if (!session || !session.email) {
      return { success: false, message: '❌ Aucun email associé à votre compte' };
    }

    const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');
    const linkGM = baseUrl ? `\n\n👉 Page GM : ${baseUrl}/pages/gm-saisie.html` : '';
    const linkCBCO = baseUrl ? `\n👉 Page CBCO : ${baseUrl}/pages/cbco-saisie.html` : '';

    const sent = await this.sendEmail(
      config,
      session.email,
      session.displayName,
      '✅ Test Rappels – Intranet Goudalle',
      `Bonjour ${session.displayName},\n\nCeci est un email de test du système de rappels de l'Intranet Goudalle.\n\nSi vous recevez cet email, la configuration est correcte !${linkGM}${linkCBCO}\n\nCordialement,\nIntranet Goudalle`
    );

    return sent
      ? { success: true, message: `✅ Email de test envoyé à ${session.email}` }
      : { success: false, message: '❌ Erreur lors de l\'envoi. Vérifiez la configuration EmailJS.' };
  },

  /**
   * Envoie un email de test à tous les référents concernés
   */
  async sendTestToAll() {
    const config = this.getConfig();
    if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) {
      return { success: false, message: '❌ Configuration EmailJS incomplète', sent: 0, failed: 0 };
    }

    const users = Auth.getAllUsers();
    const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');
    const referents = Object.values(users).filter(u =>
      u.isActive && (u.role === 'referent' || u.role === 'referent_cbco') && u.email
    );

    if (referents.length === 0) {
      return { success: false, message: '❌ Aucun référent actif avec email trouvé', sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    const details = [];

    for (const user of referents) {
      const isGM = user.role === 'referent';
      const link = baseUrl
        ? `\n\n👉 Accéder à la saisie : ${baseUrl}/pages/${isGM ? 'gm-saisie' : 'cbco-saisie'}.html`
        : '';

      const ok = await this.sendEmail(
        config,
        user.email,
        user.displayName,
        '✅ Test Rappels – Intranet Goudalle',
        `Bonjour ${user.displayName},\n\nCeci est un email de test du système de rappels de l'Intranet Goudalle.\n\nVous recevrez des rappels pour la saisie de vos indicateurs ${isGM ? 'Goudalle Maçonnerie (GM)' : 'CBCO'} lorsque les données ne sont pas encore renseignées.${link}\n\nCordialement,\nIntranet Goudalle`
      );

      if (ok) {
        sent++;
        details.push(`✅ ${user.displayName}`);
      } else {
        failed++;
        details.push(`❌ ${user.displayName}`);
      }
    }

    const message = `${sent} envoyé(s), ${failed} échec(s) sur ${referents.length} référent(s) :\n${details.join('\n')}`;
    return { success: failed === 0, message, sent, failed };
  },

  /**
   * Résumé de l'état des rappels pour le dashboard direction
   */
  getReminderStatus() {
    const config = this.getConfig();
    const today = new Date();
    const week = getCurrentWeek();
    const year = getCurrentYear();
    const users = Auth.getAllUsers();

    const status = {
      enabled: config.enabled,
      gm: { total: 0, missing: 0, users: [] },
      cbco: { total: 0, missing: 0, users: [] }
    };

    // GM referents
    const gmReferents = Object.values(users).filter(u =>
      u.isActive && u.role === 'referent'
    );
    status.gm.total = gmReferents.length;
    if (!this.hasGMData(week, year)) {
      status.gm.missing = gmReferents.length;
      status.gm.users = gmReferents.map(u => u.displayName);
    }

    // CBCO referents
    const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
    const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const cbcoReferents = Object.values(users).filter(u =>
      u.isActive && u.role === 'referent_cbco'
    );
    status.cbco.total = cbcoReferents.length;
    if (!this.hasCBCOData(prevMonth, prevYear)) {
      status.cbco.missing = cbcoReferents.length;
      status.cbco.users = cbcoReferents.map(u => u.displayName);
    }

    return status;
  }
};
