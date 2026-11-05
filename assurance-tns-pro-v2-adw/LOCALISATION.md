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
| Carte interactive | Leaflet embarqué, marqueur déplaçable, clic sur la carte pour repositionner |
| **4 boutons de vue** | `Plan OSM` (par défaut), `Plan IGN`, `Photo aérienne`, `Street View` (image de rue) |
| Adresse + GPS | Libellé de l'adresse, latitude/longitude à 6 décimales, précision et source |
| `Rechercher` | Ouvre la modale de recherche (entreprise, rue, code postal, ville, pays) |
| `Valider` | Enregistre le bloc, l'écrit dans les champs du formulaire et le stocke localement |

### Bloc 2 — Bâtiment

| Élément | Comportement |
| --- | --- |
| **4 boutons de vue** | `Plan OSM`, `Plan IGN`, **`Photo aérienne` (par défaut)**, `Street View` |
| Photo aérienne | Carte Esri World Imagery zoom 19 centrée sur le bâtiment : l'image affichée d'emblée |
| Street View | Image de rue plein cadre (Panoramax, sinon Wikimedia Commons) avec libellé d'adresse, crédit, flèches pour parcourir les images et lien « Ouvrir en 360° » |
| Adresse + GPS | Même principe que le bloc 1, avec sa propre recherche indépendante |
| `Rechercher` / `Valider` | Modale indépendante ; validation enregistre la vue choisie |

L'image du bloc est donc une **vue réelle du bâtiment** (plan, photo aérienne ou
image de rue), jamais une illustration. Sans image de rue disponible, l'onglet
`Street View` affiche un message explicite et **le bloc reste validable** en
plan ou en photo aérienne.

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

Les champs de la modale sont **déjà remplis** avec l'adresse saisie à l'étape
précédente (voir ci-dessous) : l'utilisateur ne ressaisit jamais son adresse.

### Adresse saisie à l'étape « société »

L'étape « Quelle est la société concernée par cette demande ? » demande
désormais, en plus du nom et du code postal :

| Champ | `name` | Obligatoire |
| --- | --- | --- |
| Numéro et nom de rue | `adresse` | non |
| Code postal | `code_postal` | oui (déjà) |
| Ville | `ville` | non |

Dès que l'étape de localisation s'affiche, le module :

1. recopie ces valeurs dans les deux modales (`company`, `street`, `postcode`,
   `city`) ;
2. si la rue, le code postal et la ville sont renseignés, lance **une seule**
   recherche automatique et remplit les deux blocs (adresse, GPS, bâtiment en
   photo aérienne, image de rue si disponible) ;
3. laisse l'utilisateur ajuster le repère puis cliquer sur `Valider`.

Si l'adresse est incomplète ou introuvable, aucune erreur bloquante : un message
invite à cliquer sur `Rechercher`. La recherche automatique ne s'exécute qu'une
fois par adresse et **n'écrase jamais** une adresse déjà validée. Le champ
`adresse` est aussi transmis dans le lead (voir section 4).

---

## 2. Aucune clé d'API

| Usage | Service | Clé |
| --- | --- | --- |
| Plan OSM | OpenStreetMap France (`tile.openstreetmap.fr`) via Leaflet | non |
| Plan IGN | WMTS Géoplateforme — `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` (`data.geopf.fr`) | non |
| Repli des plans | Esri World Street Map (si un plan ne répond pas) | non |
| Géocodage France | Base Adresse Nationale — `data.geopf.fr/geocodage` (Etalab / IGN) | non |
| Géocodage Europe | Photon (`photon.komoot.io`, données OpenStreetMap) | non |
| Géocodage inverse | Géoplateforme puis Photon | non |
| Photos de rue (vue « Street View ») | Panoramax (fédération d'instances ouvertes) | non |
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
| `tests/` | 45 tests (`node --test`), dont 17 tests DOM jsdom avec réseau simulé |

---

## 4. Champs transmis avec le lead

Le nom de rue saisi à l'étape société est transmis sous `adresse` (et `ville`),
en plus des champs géocodés :

Ajoutés à l'objet `data` envoyé au CRM et à Google Sheets (préfixe `loc_`) :
`loc_adresse`, `loc_rue`, `loc_code_postal`, `loc_ville`, `loc_pays`,
`loc_pays_code`, `loc_latitude`, `loc_longitude`, `loc_precision`, `loc_source`,
`loc_vue`, `loc_validee`, `loc_batiment_*` (adresse, GPS, `photo`,
`photo_vignette`, `photo_source`, `photo_licence`, `photo_auteur`, `photo_date`,
`photo_lien`, `vue`, `vue_aerienne`, `validee`).

`loc_vue` et `loc_batiment_vue` enregistrent la vue validée :

| Vue choisie | Valeur transmise |
| --- | --- |
| Plan OSM | `plan osm` |
| Plan IGN | `plan ign` |
| Photo aérienne | `vue aerienne` |
| Street View | `rue` |

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
  prefillFromCompany: true,            // reprend l'adresse de l'étape « société »
  autoSearchFromCompany: true,         // lance la recherche dès l'affichage de l'étape
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
    osm: 'https://tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    osmAttribution: '&copy; OpenStreetMap France',
    ign: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ignAttribution: 'Plan IGN &copy; IGN – Géoplateforme',
    aerial: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    aerialAttribution: 'Photo aérienne &copy; Esri, Maxar, Earthstar Geographics',
    // Repli commun (plans) si les tuiles échouent
    street: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    streetAttribution: 'Fond de carte &copy; Esri, HERE, Garmin'
  }
};
```

> **Important — fonds de carte et « Street View »** : le serveur public
> `tile.openstreetmap.org` n'est **pas** utilisé (il renvoie des tuiles
> « 403 Access blocked » aux applications hors politique d'usage, y compris en
> ouvrant `index.html` en local).
>
> Les quatre vues reposent sur des services sans clé :
>
> | Vue | Fond | Attribution |
> | --- | --- | --- |
> | Plan OSM | `tile.openstreetmap.fr/osmfr` | © OpenStreetMap France |
> | Plan IGN | WMTS `data.geopf.fr` — `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` | © IGN – Géoplateforme |
> | Photo aérienne | Esri World Imagery | © Esri, Maxar, Earthstar Geographics |
> | Street View | Panoramax (API `api.panoramax.xyz`), sinon Wikimedia Commons | © contributeurs Panoramax – CC BY-SA 4.0 |
>
> Si les tuiles d'un plan échouent (proxy, réseau, extension), le module bascule
> après trois erreurs sur **Esri World Street Map** ; si tout échoue, un message
> discret « Fond de carte indisponible » apparaît et l'adresse, les coordonnées
> GPS et l'image de rue restent exploitables.
>
> **Street View n'utilise pas Google** : Google Street View exige une clé API
> payante et interdit la récupération d'images, ce qui est incompatible avec un
> module sans clé. L'image de rue provient de **Panoramax** (panoramas 360°
> ouverts, France/Europe), complétée par les photos géolocalisées de Wikimedia
> Commons ; le lien « Ouvrir en 360° » ouvre le panorama interactif sur
> `api.panoramax.xyz`. Pour élargir la couverture, un fournisseur sous contrat
> (Mapillary avec jeton, Google Street View Static API, Mapbox) peut être branché
> dans `localisation.js` sans toucher au formulaire.
>
> Pour un trafic important ou des exigences de licence, remplacez `tiles.osm`,
> `tiles.ign`, `tiles.aerial` ou `tiles.street` par vos fournisseurs et mettez
> `street: ''` si vous ne voulez aucun repli. Aucun autre réglage n'est
> nécessaire : marqueur, géocodage et images continuent de fonctionner.
>
> Utilitaire de contrôle : `LocalisationEntreprise.getTileProviders()` (chaîne de
> repli du plan OSM) et `LocalisationEntreprise.getView('localisation'|'batiment')`.

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
2. **« Street View » sans Google** : l'image de rue vient de Panoramax et de
   Wikimedia Commons, jamais de Google Street View (clé payante, récupération
   d'images interdite par les conditions d'utilisation). La couverture est dense
   en ville en France, plus inégale en Europe : sans image, un message explicite
   s'affiche et le bloc reste validable en plan ou en photo aérienne. Un
   fournisseur sous contrat peut être ajouté dans `localisation.js`.
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

- `tests/localisation-core.test.js` — 28 tests : composition des requêtes,
  analyse BAN/Photon/Panoramax/Commons, validité des codes postaux européens,
  géocodage inverse, sérialisation, champs de lead, vue aérienne par défaut,
  branchement HTML.
- `tests/localisation-ui.test.js` — 17 tests jsdom (réseau simulé) : ouverture
  des modales, blocage des saisies invalides, sélection d'adresse, validation,
  garde du bouton Suivant, quatre vues des deux blocs, image de rue et son
  crédit, repli aérien sans photo, stockage local, gestion des pannes réseau,
  préremplissage depuis l'étape « société », déclenchement automatique à
  l'affichage de l'étape.

Aucun test ne contacte Internet : les réponses des fournisseurs sont simulées.

---

## 11. Checklist QA avant publication

1. Parcours complet : société (nom + rue + CP + ville) → **localisation**
   (adresse reprise automatiquement) → société existante
   → … → envoi ; vérifier que le bouton `Précédent` revient correctement sur
   l'étape.
2. Adresse française en ville, en rural, et une adresse en Belgique, en
   Espagne, au Royaume-Uni (pays + code postal).
3. Déplacer le marqueur : l'adresse se met à jour et la validation redevient
   nécessaire.
4. Vérifier les **quatre boutons de vue** sur les deux blocs (Plan OSM, Plan
   IGN, Photo aérienne, Street View), le chargement des tuiles IGN, l'image de
   rue Panoramax (crédit, flèches, lien 360°) et le comportement sans image de
   rue (message explicite, bloc validable).
5. `Suivant` bloqué sans validation, message lisible, échappatoire fonctionnelle.
6. Réception du lead en CRM et dans Google Sheets : champs `loc_*` +
   récapitulatif. Tester `lpLead.preview()` en console.
7. Mobile (≤ 479 px) : modale plein écran, carte et boutons utilisables ;
   l'étape élargit le formulaire uniquement sur desktop.
8. Après envoi : `localStorage` purgé (15 s) et aucune donnée résiduelle.
