/**
 * contact.js — Coordonnées de contact d'un établissement.
 *
 * Pourquoi ce module existe : l'API officielle Recherche d'entreprises
 * (DINUM) ne publie **aucune** coordonnée de contact (téléphone, e-mail,
 * personne à joindre). Ces informations ne peuvent donc pas être affichées
 * « par défaut » : elles sont **saisies par l'utilisateur** pour
 * l'établissement consulté, conservées uniquement sur son appareil, et
 * clairement signalées comme telles (jamais présentées comme officielles).
 *
 * Ce fichier ne touche ni au DOM ni au réseau : normalisation, validation et
 * fabrication des liens `tel:` / `mailto:` sont des fonctions pures, testables.
 */

/** Champs de contact, dans l'ordre d'affichage. */
export const CONTACT_FIELDS = [
  {
    key: 'telephone',
    label: 'Téléphone fixe',
    icon: 'phone',
    type: 'tel',
    placeholder: '01 23 45 67 89',
    help: 'Standard ou ligne fixe (01 à 05, 09).',
  },
  {
    key: 'mobile',
    label: 'Téléphone mobile',
    icon: 'phone',
    type: 'tel',
    placeholder: '06 12 34 56 78',
    help: 'Portable du dirigeant ou de l’accueil (06, 07).',
  },
  {
    key: 'email',
    label: 'E-mail',
    icon: 'mail',
    type: 'email',
    placeholder: 'contact@entreprise.fr',
    help: 'Adresse de contact publiée par l’entreprise.',
  },
  {
    key: 'contact',
    label: 'Contact',
    icon: 'user',
    type: 'text',
    placeholder: 'Prénom Nom — fonction',
    help: 'Personne ou service à joindre.',
  },
];

export const CONTACT_KEYS = CONTACT_FIELDS.map((field) => field.key);

/** Longueurs maximales acceptées (protège le stockage local). */
export const CONTACT_LIMITS = {
  telephone: 20,
  mobile: 20,
  email: 120,
  contact: 80,
  note: 200,
};

/**
 * Normalise un numéro français : séparateurs tolérés, `+33` et `0033`
 * ramenés au format national à 10 chiffres.
 * @returns {string} chiffres seuls (« 0123456789 ») ou '' si inexploitable
 */
export function normalizePhoneFr(value) {
  let digits = String(value ?? '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+33')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0033')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('33') && digits.length === 11) digits = `0${digits.slice(2)}`;
  digits = digits.replace(/\D/g, '');
  if (digits.length !== 10) return '';
  if (!/^0[1-9]\d{8}$/.test(digits)) return '';
  return digits;
}

/** Vrai si le numéro (normalisé) est un mobile français (06 / 07). */
export const isMobileFr = (normalized) => /^0[67]\d{8}$/.test(String(normalized || ''));

/** Vrai si le numéro (normalisé) est une ligne fixe ou spéciale (01-05, 08, 09). */
export const isLandlineFr = (normalized) => /^0[1-589]\d{8}$/.test(String(normalized || ''));

/** « 0123456789 » → « 01 23 45 67 89 » (lisible) ; '' reste ''. */
export function formatPhoneFr(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 10) return String(value ?? '').trim();
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

/** Lien `tel:` international (E.164) prêt pour un `<a href>`. */
export function phoneHref(value) {
  const digits = normalizePhoneFr(value);
  return digits ? `tel:+33${digits.slice(1)}` : '';
}

/** Validation d'adresse e-mail (suffisante pour un usage de formulaire). */
export function isValidEmail(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > CONTACT_LIMITS.email) return false;
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(text);
}

/** Lien `mailto:` (sans injection possible : adresse validée + encodage). */
export function emailHref(value) {
  return isValidEmail(value) ? `mailto:${String(value).trim()}` : '';
}

/**
 * Valide et normalise une saisie de coordonnées.
 *
 * @param {{telephone?: string, mobile?: string, email?: string, contact?: string}} input
 * @returns {{ok: boolean, errors: Record<string,string>, value: {telephone: string, mobile: string, email: string, contact: string}}}
 */
export function validateContactInput(input = {}) {
  const errors = {};
  const value = { telephone: '', mobile: '', email: '', contact: '' };

  // Téléphone fixe : un mobile saisi ici est signalé (et inversement), ce qui
  // évite les fiches où le portable se retrouve dans la ligne fixe.
  const phoneRaw = String(input.telephone ?? '').trim();
  if (phoneRaw) {
    const normalized = normalizePhoneFr(phoneRaw);
    if (!normalized) errors.telephone = 'Numéro français à 10 chiffres attendu (ex. 01 23 45 67 89).';
    else if (isMobileFr(normalized)) errors.telephone = 'Ce numéro est un mobile : utilisez le champ « Téléphone mobile ».';
    else value.telephone = normalized;
  }

  const mobileRaw = String(input.mobile ?? '').trim();
  if (mobileRaw) {
    const normalized = normalizePhoneFr(mobileRaw);
    if (!normalized) errors.mobile = 'Numéro français à 10 chiffres attendu (ex. 06 12 34 56 78).';
    else if (!isMobileFr(normalized)) errors.mobile = 'Ce numéro n’est pas un mobile : utilisez le champ « Téléphone fixe ».';
    else value.mobile = normalized;
  }

  const emailRaw = String(input.email ?? '').trim();
  if (emailRaw) {
    if (!isValidEmail(emailRaw)) errors.email = 'Adresse e-mail invalide (ex. contact@entreprise.fr).';
    else value.email = emailRaw.toLowerCase();
  }

  const contactRaw = String(input.contact ?? '').trim().replace(/\s+/g, ' ');
  if (contactRaw) {
    if (contactRaw.length > CONTACT_LIMITS.contact) errors.contact = `Nom du contact trop long (${CONTACT_LIMITS.contact} caractères maximum).`;
    else value.contact = contactRaw;
  }

  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** Vrai si au moins une coordonnée est renseignée. */
export function hasContact(contact) {
  if (!contact || typeof contact !== 'object') return false;
  return CONTACT_KEYS.some((key) => String(contact[key] ?? '').trim() !== '');
}

/**
 * Canaux affichables (valeur lisible + lien cliquable).
 * Les valeurs vides sont écartées : aucun lien `tel:`/`mailto:` factice.
 *
 * @returns {Array<{key: string, label: string, icon: string, value: string, display: string, href: string}>}
 */
export function contactChannels(contact) {
  if (!contact || typeof contact !== 'object') return [];
  return CONTACT_FIELDS
    .map((field) => {
      const raw = String(contact[field.key] ?? '').trim();
      if (!raw) return null;
      if (field.key === 'telephone' || field.key === 'mobile') {
        const normalized = normalizePhoneFr(raw) || raw.replace(/\D/g, '');
        return { ...field, value: normalized, display: formatPhoneFr(normalized), href: phoneHref(normalized) };
      }
      if (field.key === 'email') {
        return { ...field, value: raw, display: raw, href: emailHref(raw) };
      }
      return { ...field, value: raw, display: raw, href: '' };
    })
    .filter(Boolean);
}

/** Résumé texte (presse-papiers, export, récapitulatif). */
export function contactSummary(contact) {
  const channels = contactChannels(contact);
  if (!channels.length) return '';
  return channels.map((channel) => `${channel.label} : ${channel.display}`).join(' · ');
}

/** Prépare l'objet stocké (horodatage + note éventuelle). */
export function buildContactRecord(input, { note = '' } = {}) {
  const { ok, value } = validateContactInput(input);
  if (!ok || !hasContact(value)) return null;
  return {
    ...value,
    note: String(note ?? '').trim().slice(0, CONTACT_LIMITS.note),
    updatedAt: new Date().toISOString(),
    source: 'Saisie manuelle (Company Locator)',
  };
}
