/**
 * Système de rappels par email pour la saisie des indicateurs
 * Utilise EmailJS (https://www.emailjs.com/) pour l'envoi depuis le frontend
 * 
 * Fonctionnement :
 * - Vérifie automatiquement au chargement du dashboard (direction uniquement)
 * - Envoie un rappel 2 jours avant la date butoir
 * - Envoie un rappel final le jour de la date butoir
 * - Référents GM → rappel hebdomadaire (indicateurs GM)
 * - Référents CBCO → rappel mensuel (données CBCO)
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
    const todayDay = today.getDay();
    const todayDate = today.getDate();
    const results = [];
    const users = Auth.getAllUsers();

    // ===== RAPPELS GM (hebdomadaire) =====
    const gmReminderDay = (config.gmDeadlineDay - 2 + 7) % 7;
    const isGmReminder = todayDay === gmReminderDay;
    const isGmFinal = todayDay === config.gmDeadlineDay;

    if (isGmReminder || isGmFinal) {
      const type = isGmReminder ? 'gm_rappel' : 'gm_final';
      const week = getCurrentWeek();
      const year = getCurrentYear();

      if (!this.hasGMData(week, year)) {
        const referents = Object.values(users).filter(u =>
          u.isActive && u.role === 'referent' && u.email
        );

        const deadlineStr = this.JOURS_FR[config.gmDeadlineDay];

        for (const user of referents) {
          if (this.wasAlreadySent(type, week, year, user.username)) continue;

          const subject = isGmReminder
            ? `⏰ Rappel : Saisie indicateur GM – S${String(week).padStart(2, '0')}/${year}`
            : `🚨 Dernier jour : Saisie indicateur GM – S${String(week).padStart(2, '0')}/${year}`;

          const message = isGmReminder
            ? `Bonjour ${user.displayName},\n\nVous n'avez pas encore saisi les indicateurs Goudalle Maçonnerie pour la semaine ${week} (${year}).\n\nLa date limite est ${deadlineStr}.\n\nMerci de vous connecter à l'intranet pour effectuer la saisie.\n\nCordialement,\nIntranet Goudalle`
            : `Bonjour ${user.displayName},\n\n⚠️ C'est aujourd'hui le dernier jour pour saisir les indicateurs Goudalle Maçonnerie pour la semaine ${week} (${year}).\n\nMerci de vous connecter rapidement à l'intranet.\n\nCordialement,\nIntranet Goudalle`;

          const sent = await this.sendEmail(config, user.email, user.displayName, subject, message);
          if (sent) {
            this.recordSentReminder({ type, period: week, year, sentTo: user.username });
            Auth.audit('REMINDER_SENT', `${type} → ${user.displayName} (${user.email}) – S${week}/${year}`);
            results.push({ type, user: user.displayName, indicator: 'GM' });
          }
        }
      }
    }

    // ===== RAPPELS CBCO (mensuel) =====
    // Deadline = jour X du mois courant, pour les données du mois précédent
    const cbcoDeadline = new Date(today.getFullYear(), today.getMonth(), config.cbcoDeadlineDay);
    const cbcoReminderDate = new Date(cbcoDeadline);
    cbcoReminderDate.setDate(cbcoReminderDate.getDate() - 2);

    const isCbcoReminder = todayDate === cbcoReminderDate.getDate()
      && today.getMonth() === cbcoReminderDate.getMonth();
    const isCbcoFinal = todayDate === config.cbcoDeadlineDay;

    if (isCbcoReminder || isCbcoFinal) {
      const type = isCbcoReminder ? 'cbco_rappel' : 'cbco_final';

      // Mois à vérifier = mois précédent
      const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
      const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

      if (!this.hasCBCOData(prevMonth, prevYear)) {
        const referents = Object.values(users).filter(u =>
          u.isActive && u.role === 'referent_cbco' && u.email
        );

        const currentMonthName = this.MOIS_FR[today.getMonth() + 1];
        const prevMonthName = this.MOIS_FR[prevMonth];

        for (const user of referents) {
          if (this.wasAlreadySent(type, prevMonth, prevYear, user.username)) continue;

          const subject = isCbcoReminder
            ? `⏰ Rappel : Saisie CBCO – ${prevMonthName} ${prevYear}`
            : `🚨 Dernier jour : Saisie CBCO – ${prevMonthName} ${prevYear}`;

          const message = isCbcoReminder
            ? `Bonjour ${user.displayName},\n\nVous n'avez pas encore saisi vos données CBCO pour ${prevMonthName} ${prevYear}.\n\nLa date limite est le ${config.cbcoDeadlineDay} ${currentMonthName}.\n\nMerci de vous connecter à l'intranet pour effectuer la saisie.\n\nCordialement,\nIntranet Goudalle`
            : `Bonjour ${user.displayName},\n\n⚠️ C'est aujourd'hui le dernier jour pour saisir vos données CBCO pour ${prevMonthName} ${prevYear}.\n\nMerci de vous connecter rapidement à l'intranet.\n\nCordialement,\nIntranet Goudalle`;

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

    const sent = await this.sendEmail(
      config,
      session.email,
      session.displayName,
      '✅ Test Rappels – Intranet Goudalle',
      `Bonjour ${session.displayName},\n\nCeci est un email de test du système de rappels de l'Intranet Goudalle.\n\nSi vous recevez cet email, la configuration est correcte !\n\nCordialement,\nIntranet Goudalle`
    );

    return sent
      ? { success: true, message: `✅ Email de test envoyé à ${session.email}` }
      : { success: false, message: '❌ Erreur lors de l\'envoi. Vérifiez la configuration EmailJS.' };
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
