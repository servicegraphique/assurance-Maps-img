# Module « Localisation et identification de votre entreprise »

Étape ajoutée au formulaire multi-étapes de la landing page
`assurance-tns-pro-v2-adw`, entre **« Quelle est la société concernée ? »**
(nom + code postal) et **« Votre société existe-t-elle déjà ? »**.

```
… → code postal → [Localisation et identification] → société existante → nom/prénom → téléphone
```

---

## 1. Ce que fait le module

### Bloc 1 — Localisation

| Élément | Comportement |
| --- | --- |
| Carte interactive | OpenStreetMap (Leaflet embarqué), marqueur déplaçable, clic sur la carte pour repositionner |
| Adresse + GPS | Libellé de l'adresse, latitude/longitude à 6 décimales, précision et source |
| `Rechercher` | Ouvre la modale de recherche (entreprise, rue, code postal, ville, pays) |
| `Valider` | Enregistre le bloc, l'écrit dans les champs du formulaire et le stocke localement |

### Bloc 2 — Bâtiment

| Élément | Comportement |
| --- | --- |
| Photographie réelle | Photo de rue issue de **Panoramax** (imagerie ouverte, France/Europe), sinon **Wikimedia Commons** géolocalisé |
| Vue aérienne | Onglet « Vue aérienne » : carte Esri World Imagery zoom 19 centrée sur le bâtiment |
| Adresse + GPS | Même principe que le bloc 1, avec sa propre recherche indépendante |
| `Rechercher` / `Valider` | Modale indépendante ; validation enregistre la vue choisie (façade ou aérienne) |

Si aucune photo de façade n'existe dans les sources ouvertes, le module bascule
automatiquement sur la vue aérienne : **le bloc reste validable** et l'URL de la
vue aérienne (Esri) est transmise avec le lead.

### Modales

Chaque bloc possède sa propre fenêtre modale (`#loc-modal-localisation`,
`#loc-modal-batiment`) avec les champs demandés :

- Nom de l'entreprise (facultatif, pré-rempli avec le champ `societe` du formulaire)
- Numéro et nom de rue
- Code postal
- Ville
- Pays (France par défaut, 44 pays européens)

`Lancer la recherche` interroge le géocodeur, affiche les adresses trouvées avec
leur précision (numéro de rue / rue / commune) et leurs coordonnées ; `Utiliser
cette adresse` remplit la carte et les informations du bloc.

---

## 2. Aucune clé d'API

| Usage | Service | Clé |
| --- | --- | --- |
| Carte rue | Esri World Street Map via Leaflet (repli automatique : OpenStreetMap France) | non |
| Géocodage France | Base Adresse Nationale — `data.geopf.fr/geocodage` (Etalab / IGN) | non |
| Géocodage Europe | Photon (`photon.komoot.io`, données OpenStreetMap) | non |
| Géocodage inverse | Géoplateforme puis Photon | non |
| Photos de rue | Panoramax (fédération d'instances ouvertes) | non |
| Photos de bâtiments | Wikimedia Commons (API `geosearch`) | non |
| Vue aérienne | Esri World Imagery (tuiles publiques) | non |

Les attributions légales sont affichées dans la carte (Leaflet) et sous la photo
(`Photo : auteur · licence · date · ouvrir la source`).

---

## 3. Fichiers ajoutés / modifiés

| Fichier | Rôle |
| --- | --- |
| `localisation-core.js` | Logique pure : pays, validation, construction des requêtes, analyse des réponses, état, champs de lead (testable sans DOM) |
| `localisation.js` | Interface : cartes Leaflet, modales, photos, validation, persistance, garde de navigation, API publique |
| `localisation.css` | Styles isolés `.loc-*` / `#loc-section` (responsive, modales) |
| `vendor/leaflet/` | Leaflet 1.9.4 embarqué (BSD-2-Clause, `LICENSE` fourni) — aucun CDN requis |
| `index.html` | Étape ajoutée + chaînage `code-postal → localisation → societe`, liens CSS et scripts |
| `lead-handler.js` | Fusion des champs `loc_*` dans le lead et ajout du récapitulatif |
| `tests/` | 39 tests (`node --test`), dont 12 tests DOM jsdom avec réseau simulé |

---

## 4. Champs transmis avec le lead

Ajoutés à l'objet `data` envoyé au CRM et à Google Sheets (préfixe `loc_`) :
`loc_adresse`, `loc_rue`, `loc_code_postal`, `loc_ville`, `loc_pays`,
`loc_pays_code`, `loc_latitude`, `loc_longitude`, `loc_precision`, `loc_source`,
`loc_validee`, `loc_batiment_*` (adresse, GPS, `photo`, `photo_vignette`,
`photo_source`, `photo_licence`, `photo_auteur`, `photo_date`, `photo_lien`,
`vue`, `vue_aerienne`, `validee`).

Un récapitulatif lisible est également ajouté à `autre_info_fj` (colonne
« enjeu » du Google Sheet) :

```
Localisation : 12 Rue de la Paix 75002 Paris (48.868989, 2.331150)
Bâtiment : 12 Rue de la Paix 75002 Paris (48.868989, 2.331150)
Bâtiment - photo : Panoramax (CC-BY-SA-4.0)
```

> **Google Sheets** : les colonnes `loc_adresse`, `loc_latitude`,
> `loc_longitude`, `loc_batiment_adresse`, `loc_batiment_latitude`,
> `loc_batiment_longitude`, `loc_batiment_photo`, `loc_batiment_vue` et
> `loc_batiment_validee` doivent être créées dans la feuille si le script Apps
> Script les attend. Le récapitulatif `autre_info_fj` fonctionne sans
> modification. À valider avec l'équipe CRM.

API de contrôle (console) :

```js
LocalisationEntreprise.getState()        // état complet (validé ou non)
LocalisationEntreprise.getLeadFields()   // champs loc_*
LocalisationEntreprise.isValidated()     // les deux blocs validés ?
LocalisationEntreprise.open('batiment')  // ouvre une modale
LocalisationEntreprise.reset()           // remet à zéro (état + stockage)
lpLead.preview()                         // payload complet du lead
```

Événements DOM émis sur `document` : `localisation:search:results`,
`localisation:search:empty`, `localisation:search:error`,
`localisation:modal:open`, `localisation:change`, `localisation:validee`,
`localisation:validation:requise`, `localisation:validation:ignoree`.

---

## 5. Validation obligatoire (et échappatoire)

Par défaut, le bouton **Suivant** de l'étape est bloqué tant que les deux blocs
ne sont pas validés. Un message indique le ou les blocs manquants et propose
*« Je renseignerai ces informations plus tard »*, qui laisse poursuivre pour ne
pas perdre de leads lorsque les sources ouvertes ne couvrent pas l'adresse.

Pour rendre la validation facultative :

```html
<script>
  window.LOCALISATION_CONFIG = { requireValidation: false };
</script>
```

---

## 6. Configuration

Surchargez `window.LOCALISATION_CONFIG` **avant** le chargement de
`localisation.js` (par exemple dans un script inline en fin de `<head>`).

```js
window.LOCALISATION_CONFIG = {
  defaultCountry: 'FR',
  requireValidation: true,
  persist: true,                       // sauvegarde locale de secours
  storageKey: 'cpro_loc_entreprise_v1',
  clearStoredOnSubmit: true,           // purge le stockage 15 s après l'envoi
  mapZoom: 16,
  aerialZoom: 19,
  photoRadiusMeters: 90,
  photoLimit: 12,
  photoProviderOrder: ['panoramax', 'commons'],
  requestTimeoutMs: 9000,
  urls: {
    geopf: 'https://data.geopf.fr/geocodage/search',
    geopfReverse: 'https://data.geopf.fr/geocodage/reverse',
    photon: 'https://photon.komoot.io/api/',
    photonReverse: 'https://photon.komoot.io/reverse',
    panoramax: 'https://api.panoramax.xyz/api/search',
    commons: 'https://commons.wikimedia.org/w/api.php',
    aerialExport: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
  },
  tiles: {
    street: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    streetAttribution: 'Fond de carte &copy; Esri, HERE, Garmin',
    streetFallback: 'https://tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    streetFallbackAttribution: '&copy; OpenStreetMap France',
    aerial: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    aerialAttribution: 'Imagerie &copy; Esri'
  }
};
```

> **Important — fond de carte** : le serveur public `tile.openstreetmap.org`
> n'est **pas** utilisé par défaut. Il renvoie des tuiles « 403 Access blocked »
> aux applications qui ne respectent pas sa politique d'usage (c'était le cas
> en test, y compris en ouvrant simplement `index.html` en local).
>
> Le fond de carte par défaut est **Esri World Street Map** (couverture
> européenne, sans clé, attribution affichée). Si les tuiles Esri échouent
> (proxy, réseau, blocage), le module bascule automatiquement sur
> **OpenStreetMap France** (`tile.openstreetmap.fr`) après trois tuiles en
> erreur ; si tout échoue, un message discret « Fond de carte indisponible »
> apparaît et l'adresse + les coordonnées GPS restent exploitables.
>
> Pour un trafic important ou des exigences de licence, remplacez
> `tiles.street` par votre fournisseur habituel (IGN/Géoplateforme, MapTiler,
> Stadia, Thunderforest…) et mettez `streetFallback: ''` si vous ne voulez
> aucun autre appel. Aucun autre réglage n'est nécessaire : le marqueur, le
> géocodage et les photos continuent de fonctionner.
>
> Utilitaire de contrôle : `LocalisationEntreprise.getTileProviders()` renvoie
> les fournisseurs réellement utilisés, dans l'ordre de repli.

---

## 7. Données personnelles et consentement

- Aucune donnée n'est envoyée à un géocodeur avant que l'utilisateur ne clique
  sur `Lancer la recherche` ; la saisie est alors transmise à
  `data.geopf.fr` / `photon.komoot.io` (adresse), à `api.panoramax.xyz` et
  `commons.wikimedia.org` (coordonnées du point) et à `arcgisonline.com`
  (tuiles).
- Les adresses validées sont conservées dans `localStorage` (clé
  `cpro_loc_entreprise_v1`) pour ne pas perdre la saisie, puis purgées 15 s
  après l'envoi du formulaire. Mettez `persist: false` pour désactiver
  totalement ce stockage.
- Le traitement reste couvert par la base légale « exécution de la demande »
  du formulaire ; la mention de sources et de conservation locale est affichée
  sous l'étape. À faire relire par le DPO avec la politique de confidentialité
  existante.

---

## 8. Accessibilité

- Modales `role="dialog"` + `aria-modal`, fermeture par `Échap`, piège de focus,
  restitution du focus à l'ouvreur.
- Champs étiquetés, erreurs associées (`aria-invalid` porté par le conteneur,
  messages `role="alert"`), statuts en `aria-live="polite"`.
- Boutons `aria-pressed` pour `Valider` et pour les onglets Façade / Vue aérienne.
- Carte : attributions Leaflet clavier ; les informations d'adresse et de GPS
  restent lisibles sans interaction avec la carte.

---

## 9. Limites connues

1. **Couverture photo** : Panoramax est dense en ville en France, plus rare en
   rural et inégal en Europe ; Wikimedia Commons ne contient pas toutes les
   façades. Le repli « vue aérienne » garantit une image pour chaque adresse.
   Le fond de carte « rue » repose sur Esri (aucune clé) : pour un volume élevé,
   préférez un fournisseur sous contrat via `tiles.street`.
2. **Pas de Street View / clé Google** : choix assumé (aucun coût, aucune clé).
   Le module est isolé : un provider Google Maps pourrait être ajouté dans
   `localisation.js` sans toucher au reste du formulaire.
3. **Adresses très récentes ou lieux-dits** : la BAN est la référence française,
   mais renvoie parfois la commune. Le repère reste déplaçable et le clic sur la
   carte relance un géocodage inverse.
4. **CSP** : si une politique de sécurité est ajoutée au domaine, autoriser
   `connect-src https://data.geopf.fr https://photon.komoot.io https://api.panoramax.xyz https://commons.wikimedia.org https://server.arcgisonline.com`,
   `img-src https://server.arcgisonline.com https://tile.openstreetmap.fr https://*.panoramax.xyz https://*.panoramax.fr https://upload.wikimedia.org data:`,
   `style-src 'unsafe-inline'` (Leaflet positionne ses tuiles en styles inline).
5. **Prestataires publics** : Photon et l'API Panoramax fédérée sont des
   services publics sans SLA. Une indisponibilité affiche un message explicite
   et n'empêche pas de poursuivre le formulaire.

---

## 10. Tests

```bash
npm ci --prefix tests
npm test --prefix tests
```

- `tests/localisation-core.test.js` — 27 tests : composition des requêtes,
  analyse BAN/Photon/Panoramax/Commons, validité des codes postaux européens,
  géocodage inverse, sérialisation, champs de lead, branchement HTML.
- `tests/localisation-ui.test.js` — 10 tests jsdom (réseau simulé) : ouverture
  des modales, blocage des saisies invalides, sélection d'adresse, validation,
  garde du bouton Suivant, chargement de photo, repli aérien, stockage local,
  gestion des pannes réseau.

Aucun test ne contacte Internet : les réponses des fournisseurs sont simulées.

---

## 11. Checklist QA avant publication

1. Parcours complet : société (nom + CP) → **localisation** → société existante
   → … → envoi ; vérifier que le bouton `Précédent` revient correctement sur
   l'étape.
2. Adresse française en ville, en rural, et une adresse en Belgique, en
   Espagne, au Royaume-Uni (pays + code postal).
3. Déplacer le marqueur : l'adresse se met à jour et la validation redevient
   nécessaire.
4. Vérifier une photo Panoramax (crédit + licence cliquables) et le repli
   « vue aérienne ».
5. `Suivant` bloqué sans validation, message lisible, échappatoire fonctionnelle.
6. Réception du lead en CRM et dans Google Sheets : champs `loc_*` +
   récapitulatif. Tester `lpLead.preview()` en console.
7. Mobile (≤ 479 px) : modale plein écran, carte et boutons utilisables ;
   l'étape élargit le formulaire uniquement sur desktop.
8. Après envoi : `localStorage` purgé (15 s) et aucune donnée résiduelle.
