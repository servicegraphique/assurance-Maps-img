/**
 * Tests unitaires — contact.js et stockage des coordonnées de contact.
 *
 * L'API officielle ne publie ni téléphone, ni e-mail, ni contact : ces données
 * sont saisies par l'utilisateur. On vérifie donc la normalisation des numéros
 * français, la validation, les liens `tel:`/`mailto:` (aucune injection), le
 * stockage local par SIRET et leur présence dans les exports et la fiche
 * transmise au formulaire.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTACT_FIELDS, CONTACT_KEYS, normalizePhoneFr, isMobileFr, isLandlineFr,
  formatPhoneFr, phoneHref, isValidEmail, emailHref, validateContactInput,
  hasContact, contactChannels, contactSummary, buildContactRecord,
} from '../../js/contact.js';
import { userContacts, purgeUserData } from '../../js/storage.js';
import { ficheFields } from '../../js/export.js';
import { selectionPayload } from '../../js/embed.js';

const SIRET = '73282932000074';

test('Numéros français : normalisation, type et affichage', () => {
  assert.equal(normalizePhoneFr('01 23 45 67 89'), '0123456789');
  assert.equal(normalizePhoneFr('+33 1 23 45 67 89'), '0123456789');
  assert.equal(normalizePhoneFr('0033123456789'), '0123456789');
  assert.equal(normalizePhoneFr('33123456789'), '0123456789');
  assert.equal(normalizePhoneFr('06.12.34.56.78'), '0612345678');

  // Refus explicites : trop court, trop long, ne commençant pas par 0.
  assert.equal(normalizePhoneFr('01 23 45 67'), '');
  assert.equal(normalizePhoneFr('012345678901'), '');
  assert.equal(normalizePhoneFr('1234567890'), '');
  assert.equal(normalizePhoneFr(''), '');
  assert.equal(normalizePhoneFr(null), '');

  assert.equal(isMobileFr('0612345678'), true);
  assert.equal(isMobileFr('0712345678'), true);
  assert.equal(isMobileFr('0112345678'), false);
  assert.equal(isLandlineFr('0112345678'), true);
  assert.equal(isLandlineFr('0912345678'), true);
  assert.equal(isLandlineFr('0612345678'), false);

  assert.equal(formatPhoneFr('0123456789'), '01 23 45 67 89');
  assert.equal(formatPhoneFr(''), '');
  assert.equal(formatPhoneFr('12345'), '12345');
});

test('Liens tel: et mailto: : jamais d’URL fabriquée à partir d’une saisie invalide', () => {
  assert.equal(phoneHref('01 23 45 67 89'), 'tel:+33123456789');
  assert.equal(phoneHref('n’appelez pas'), '');
  assert.equal(phoneHref('javascript:alert(1)'), '');

  assert.equal(isValidEmail('contact@entreprise.fr'), true);
  assert.equal(isValidEmail('Contact@Entreprise.FR'), true);
  assert.equal(isValidEmail('contact@entreprise'), false);
  assert.equal(isValidEmail('contact entreprise@fr'), false);
  assert.equal(isValidEmail('a@b.fr"onmouseover="alert(1)'), false);
  assert.equal(isValidEmail(''), false);

  assert.equal(emailHref('contact@entreprise.fr'), 'mailto:contact@entreprise.fr');
  assert.equal(emailHref('contact@entreprise'), '');
});

test('Validation d’une saisie : champs vides, types croisés et messages', () => {
  // Tout vide : valide, mais aucune coordonnée à enregistrer.
  const empty = validateContactInput({});
  assert.equal(empty.ok, true);
  assert.equal(hasContact(empty.value), false);

  const good = validateContactInput({
    telephone: '01 23 45 67 89',
    mobile: '+33 6 12 34 56 78',
    email: ' Contact@Entreprise.FR ',
    contact: '  Marie   Dupont — accueil ',
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value, {
    telephone: '0123456789',
    mobile: '0612345678',
    email: 'contact@entreprise.fr',
    contact: 'Marie Dupont — accueil',
  });
  assert.equal(hasContact(good.value), true);

  // Un mobile dans « téléphone fixe » est signalé, et inversement.
  const crossed = validateContactInput({ telephone: '0612345678', mobile: '0123456789' });
  assert.equal(crossed.ok, false);
  assert.match(crossed.errors.telephone, /mobile/i);
  assert.match(crossed.errors.mobile, /fixe/i);

  const invalid = validateContactInput({ telephone: '12', email: 'pas-un-email', contact: 'x'.repeat(120) });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.telephone, /10 chiffres/);
  assert.match(invalid.errors.email, /invalide/);
  assert.match(invalid.errors.contact, /trop long/);
});

test('Affichage : canaux, ordre et résumé', () => {
  assert.deepEqual(contactChannels(null), []);
  assert.deepEqual(contactChannels({}), []);

  const channels = contactChannels({ telephone: '0123456789', email: 'a@b.fr', mobile: '', contact: 'Accueil' });
  assert.equal(channels.length, 3);
  assert.deepEqual(channels.map((c) => c.key), ['telephone', 'email', 'contact']);
  assert.equal(channels[0].display, '01 23 45 67 89');
  assert.equal(channels[0].href, 'tel:+33123456789');
  assert.equal(channels[1].href, 'mailto:a@b.fr');
  assert.equal(channels[2].href, '');
  // Chaque libellé existe dans la définition des champs.
  assert.equal(CONTACT_KEYS.length, CONTACT_FIELDS.length);
  assert.match(contactSummary({ telephone: '0123456789', mobile: '0612345678' }), /Téléphone fixe : 01 23 45 67 89 · Téléphone mobile : 06 12 34 56 78/);
});

test('Enregistrement local par SIRET', () => {
  purgeUserData();
  assert.equal(userContacts.get(SIRET), null);

  const record = buildContactRecord({ telephone: '0123456789', email: 'contact@exemple.fr' }, { note: 'Standard 9h-17h' });
  assert.equal(record.source, 'Saisie manuelle (Company Locator)');
  assert.equal(record.note, 'Standard 9h-17h');
  assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  userContacts.save(SIRET, record);
  assert.equal(userContacts.get(SIRET).telephone, '0123456789');
  assert.equal(userContacts.get('00000000000000'), null);
  assert.equal(userContacts.list().length, 1);

  // Une saisie vide n'écrase pas silencieusement : buildContactRecord renvoie null.
  assert.equal(buildContactRecord({}), null);
  assert.equal(buildContactRecord({ email: 'invalide' }), null);

  userContacts.remove(SIRET);
  assert.equal(userContacts.get(SIRET), null);

  userContacts.save(SIRET, record);
  purgeUserData();
  assert.equal(userContacts.get(SIRET), null, 'purgé avec les autres données locales');
});

test('Exports et fiche transmise : les coordonnées suivent l’établissement', () => {
  const fiche = {
    row: {
      etablissement: {
        siret: SIRET, adresse: '15 RUE DE VAUGIRARD', codePostal: '75015',
        commune: 'PARIS', naf: '62.01Z', nomAffiche: 'EXEMPLE CITY', enseignes: [], estSiege: true,
      },
      entreprise: { siren: '732829320', raisonSociale: 'EXEMPLE CITY' },
    },
    position: { lat: 48.841234, lon: 2.300123, precision: 'adresse', source: 'BAN' },
    contacts: { telephone: '0123456789', mobile: '0612345678', email: 'contact@exemple.fr', contact: 'Marie Dupont', note: '' },
  };

  // `ficheFields` attend la fiche aplatie (comme l'export CSV de l'application).
  const flat = {
    etablissement: fiche.row.etablissement,
    entreprise: fiche.row.entreprise,
    position: fiche.position,
    contacts: fiche.contacts,
  };
  const fields = Object.fromEntries(ficheFields(flat).map(([label, value]) => [label, value]));
  assert.equal(fields['Téléphone fixe'], '01 23 45 67 89');
  assert.equal(fields['Téléphone mobile'], '06 12 34 56 78');
  assert.equal(fields['E-mail'], 'contact@exemple.fr');
  assert.equal(fields['Contact'], 'Marie Dupont');

  const payload = selectionPayload(fiche);
  assert.equal(payload.telephone, '0123456789');
  assert.equal(payload.mobile, '0612345678');
  assert.equal(payload.email, 'contact@exemple.fr');
  assert.equal(payload.contact, 'Marie Dupont');

  // Sans coordonnées, rien n'est inventé.
  const bare = selectionPayload({ row: fiche.row, position: null, contacts: null });
  assert.equal(bare.telephone, '');
  assert.equal(bare.email, '');
  assert.ok(!ficheFields({ ...flat, contacts: null }).some(([label]) => label === 'Téléphone fixe'));
});
