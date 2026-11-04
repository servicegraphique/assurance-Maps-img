# Company Locator France

**Retrouver une entreprise française, son adresse exacte, ses coordonnées GPS réelles et les images disponibles de son bâtiment.**

Application web locale, en HTML5 / CSS3 / JavaScript Vanilla + Leaflet. Aucun framework, aucun compte, aucun abonnement, aucun backend payant. Toutes les données proviennent d'API publiques françaises et ouvertes.

---

## Sommaire

1. [Ce que fait l'application](#1-ce-que-fait-lapplication)
2. [Installation et lancement (Windows, macOS, Linux)](#2-installation-et-lancement)
3. [Configuration Mapillary (optionnelle)](#3-configuration-mapillary-optionnelle)
4. [Architecture des fichiers](#4-architecture-des-fichiers)
5. [API utilisées, limites et licences](#5-api-utilisées-limites-et-licences)
6. [Fiabilité des coordonnées GPS](#6-fiabilité-des-coordonnées-gps)
7. [Authenticité des images](#7-authenticité-des-images)
8. [Exports et presse-papiers](#8-exports-et-presse-papiers)
9. [Données locales et confidentialité](#9-données-locales-et-confidentialité)
10. [Tests](#10-tests)
11. [Limites connues et alternatives gratuites](#11-limites-connues-et-alternatives-gratuites)
12. [Dépannage](#12-dépannage)
13. [Grille de validation](#13-grille-de-validation)

---

## 1. Ce que fait l'application

### Recherche

| Critère | Exemple | Comportement |
|---|---|---|
| Nom + code postal | `Allianz` + `75015` | Requête API officielle filtrée sur le code postal |
| Nom seul | `Renault` | Recherche nationale, classée par pertinence |
| Code postal seul | `33000` | Tous les établissements du code postal (paginé) |
| Ville | `Lyon` | Résolution de la commune en **code INSEE** via la BAN, puis filtre `code_commune` |
| Adresse | `15 rue de Vaugirard` | Géocodage de l'adresse → code postal / commune déduits |
| SIREN / SIRET | `130025265` / `13002526500013` | Clé de Luhn vérifiée **avant** tout appel réseau |

- Recherche exacte puis **recherche approximative** (formes juridiques et accents ignorés, premier mot significatif, élargissement géographique). Chaque assouplissement est **signalé à l'écran**, jamais silencieux.
- Gestion de la dénomination sociale, du sigle, du nom commercial et des enseignes.
- **Dédoublonnage strict par SIRET** (un même site peut remonter via le siège *et* via les établissements connexes).
- Filtre **actifs / fermés / tous**, appliqué sur l'état de l'*établissement* (et non de la société).
- Tris : pertinence, nom, actifs d'abord, commune. Pagination jusqu'à 25 résultats par page (plafond de l'API).
- Distinction explicite **société** (SIREN, unité légale) / **établissement** (SIRET, site géographique).

### Fiche détaillée

- **Administratif** : raison sociale, nom complet, sigle, nom commercial, enseignes, SIREN, SIRET, état de l'établissement *et* de l'unité légale, code NAF/APE **avec son libellé**, forme juridique, catégorie, dates de création et de fermeture, effectif, nombre d'établissements.
- **Géographique** : adresse complète, numéro et voie, complément, code postal, ville, code commune INSEE, département, région, pays.
- **GPS** : latitude, longitude, **niveau de précision**, score de géocodage, écart entre position SIRENE et position BAN, bouton de vérification par géocodage inverse.
- **Images** : vue aérienne IGN, photographies de rue, photographies complémentaires sourcées.
- **Établissements** : liste des autres sites de la même société, filtrable par code postal.
- **Sources** : tableau donnée → source → licence, plus l'URL exacte de la requête API utilisée.

### Carte

- Fonds **Plan OpenStreetMap**, **Plan IGN**, **Photographie aérienne IGN (BD ORTHO®)** — commutables à tout moment.
- Marqueurs différenciés : siège (turquoise), établissement (bleu), fermé (gris), sélectionné (orange).
- Popup d'information au clic, centrage et zoom automatiques sur le bâtiment, cercle pointillé d'incertitude quand la position est imprécise, plein écran, échelle, copie des coordonnées, attributions permanentes.

---

## 2. Installation et lancement

### Prérequis

- Un navigateur moderne : Chrome, Edge, Firefox ou Safari (récent).
- **Node.js 18 ou plus** *(recommandé)* — <https://nodejs.org> — **ou** Python 3 *(mode dégradé, voir plus bas)*.
- Une connexion Internet (les cartes, les API et les images sont en ligne).

> Aucune installation de dépendance n'est nécessaire pour faire fonctionner l'application : `node server.js` n'utilise que la bibliothèque standard de Node. `npm install` n'est utile **que** pour lancer le test d'intégration DOM (jsdom).

### Windows — méthode la plus simple : le lanceur

**Double-cliquez sur `Lancer-Company-Locator.bat`** dans le dossier `company-locator`.
Le serveur démarre et le navigateur s'ouvre automatiquement sur la bonne adresse.
Pour arrêter : fermez la fenêtre du terminal ou appuyez sur `Ctrl + C`.

Le lanceur détecte Node.js, et bascule sur Python en mode dégradé si Node est absent
(en expliquant ce qui sera limité).

### Windows — méthode PowerShell

```powershell
# 1. Ouvrir PowerShell dans le dossier du projet
cd C:\chemin\vers\company-locator

# 2. Lancer le serveur local
node server.js          # ajoutez --open pour ouvrir le navigateur automatiquement

# 3. Ouvrir le navigateur sur
#    http://localhost:8080/
```

Arrêt : `Ctrl + C`. **Port déjà pris ?** Le serveur essaie automatiquement les
9 ports suivants et affiche l'adresse réellement utilisée. Vous pouvez aussi
imposer un port :

```powershell
$env:PORT = 8090; node server.js
```

> ⚠️ **N'ouvrez jamais `index.html` en double-cliquant.** L'adresse serait
> `file:///C:/…/index.html` : les navigateurs y bloquent les modules JavaScript
> et les requêtes réseau, donc aucune recherche ne peut aboutir. Si cela arrive,
> l'application affiche désormais un bandeau qui rappelle la marche à suivre et
> la commande exacte à taper.

### macOS / Linux

```bash
cd company-locator
./lancer.sh            # ou : node server.js --open
# http://localhost:8080/
```

Si le script n'est pas exécutable : `chmod +x lancer.sh`.

### Pourquoi un serveur local est obligatoire

L'application utilise des **modules ES** (`import`/`export`). Les navigateurs les refusent en `file://`.

Deux garde-fous sont en place :

- **`js/boot.js`**, script *classique* (donc exécuté même en `file://`), détecte le protocole et affiche la procédure complète avec le chemin exact de votre dossier ;
- un **chien de garde** de 8 secondes signale tout module qui ne s'exécuterait pas (extension bloquante, navigateur trop ancien, fichier manquant) au lieu de laisser un écran vide.

### Alternative sans Node.js (mode dégradé)

```powershell
cd company-locator
python -m http.server 8080
```

L'application fonctionne, mais **sans le relais local** :

| Fonction | `node server.js` | `python -m http.server` |
|---|---|---|
| Recherche d'entreprises | ✅ fiable (relais de même origine) | ⚠️ dépend de la politique CORS de l'API |
| Géocodage BAN / IGN | ✅ | ✅ (CORS ouvert) |
| Carte, BD ORTHO® | ✅ | ✅ |
| Photos de rue Panoramax | ✅ | ✅ (CORS ouvert, sans jeton) |
| Photos de rue Mapillary | ✅ via proxy, jeton côté serveur | ❌ sauf jeton client exposé |

**L'API Recherche d'entreprises n'expose pas d'en-tête `Access-Control-Allow-Origin`.** Un appel direct depuis le navigateur peut donc être bloqué. C'est la raison d'être du relais intégré à `server.js` : les requêtes partent du serveur local (non soumis à CORS) et reviennent au navigateur en même origine. **Utilisez `node server.js`.**

Le chemin réseau réellement utilisé est affiché dans **Paramètres → Connexion aux services** et dans le panneau d'état des API.

---

## 3. Configuration Mapillary (optionnelle)

**Mapillary n'est pas nécessaire pour utiliser l'application.** Panoramax fournit déjà des photographies de rue libres, sans jeton ni inscription.

Si vous souhaitez aussi les photos Mapillary :

### Méthode recommandée — le jeton reste côté serveur

1. Créez un compte gratuit et un *client token* sur <https://www.mapillary.com/dashboard/developers>.
2. Copiez `server.config.example.json` vers **`server.config.json`** :

   ```json
   { "mapillaryToken": "MLY|1234567890|abcdef1234567890" }
   ```

3. Relancez `node server.js` (ou appelez `http://localhost:8080/api/reload-token` pour recharger à chaud).

Le jeton n'est **jamais** envoyé au navigateur : le front interroge `/api/mapillary/images`, le serveur ajoute le jeton côté serveur. `server.config.json` est **ignoré par Git** et **refusé en téléchargement** par le serveur (HTTP 403).

Variante par variable d'environnement :

```powershell
$env:MAPILLARY_TOKEN = "MLY|…"; node server.js     # PowerShell
```
```bash
MAPILLARY_TOKEN="MLY|…" node server.js             # bash
```

### Méthode déconseillée — jeton client dans le navigateur

Dans `config.local.js` :

```js
export default {
  api: { mapillary: { clientToken: 'MLY|…' } },
};
```

Un jeton client est **visible par tout visiteur**. À réserver à un usage strictement personnel sur votre poste. Ne le versionnez jamais. L'application affiche un avertissement explicite dans les paramètres lorsque ce mode est actif.

### Autres réglages

`config.local.js` est livré vide et fusionné avec `js/config.js`. Exemples :

```js
export default {
  search: { perPage: 25 },
  imagery: { streetRadiusM: 200, streetProviders: 'panoramax' },
  map: { defaultBaseLayer: 'ortho' },
  storage: { historyEnabled: true },
};
```

---

## 4. Architecture des fichiers

```
company-locator/
├── index.html                  Interface complète, sémantique et accessible
├── README.md                   Ce document
├── server.js                   Serveur local + relais API + proxy Mapillary (0 dépendance)
├── package.json                Scripts npm (démarrage, tests) — aucun runtime requis
├── config.local.js             Surcharges locales (livré vide, aucun secret)
├── server.config.example.json  Modèle de configuration du jeton Mapillary
├── Lancer-Company-Locator.bat  Lanceur Windows double-clic
├── lancer.sh                   Lanceur macOS / Linux
│
├── css/
│   ├── style.css               Design system, layout, composants
│   ├── map.css                 Tout ce qui touche à Leaflet et aux marqueurs
│   └── responsive.css          Media queries uniquement (desktop/tablette/mobile/print)
│
├── js/
│   ├── app.js                  Orchestration : événements, état, routage par ancre
│   ├── boot.js                 Garde de démarrage (script classique) : file://, chien de garde
│   ├── search.js               Moteur de recherche : validation, replis, tri, filtres
│   ├── entreprise-api.js       Client + normalisation de l'API Recherche d'entreprises
│   ├── geocoding.js            BAN / Géoplateforme + évaluation de la fiabilité GPS
│   ├── map.js                  Leaflet : fonds, marqueurs, popups, plein écran, vue aérienne
│   ├── images.js               Photographies de rue (Panoramax, Mapillary) + photos sourcées
│   ├── storage.js              LocalStorage : paramètres, historique opt-in, favoris, cache
│   ├── export.js               CSV, GeoJSON, JSON, presse-papiers
│   ├── ui.js                   Rendu DOM (résultats, fiche, images, modales, lightbox)
│   ├── transport.js            Choix du chemin réseau : relais local ou appel direct
│   ├── labels.js               Libellés INSEE (NAF, départements, régions, formes juridiques)
│   ├── config.js               Configuration centralisée et fusion des surcharges
│   └── utils.js                HTTP robuste, cache TTL, quotas, validations, géographie
│
├── assets/
│   ├── logo/                   logo.svg, favicon.svg
│   ├── icons/                  32 icônes SVG (masques CSS, héritent de currentColor)
│   └── data/                   Référentiels INSEE (NAF, départements, régions, effectifs…)
│
├── vendor/leaflet/             Leaflet 1.9.4 servi localement (aucun CDN) + LICENSE
├── docs/
│   ├── API.md                  Détail des endpoints, paramètres et champs consommés
│   └── VERIFICATION.md         Rapport de tests et périmètre réellement vérifié
└── tests/
    ├── unit/*.test.mjs         101 tests unitaires (node:test, sans réseau)
    ├── css.test.mjs            16 vérifications de cascade CSS (éléments masqués)
    ├── boot.test.mjs           14 vérifications du garde de démarrage
    ├── dom.test.mjs            42 vérifications d'intégration DOM (jsdom + Leaflet réels)
    ├── live-smoke.mjs          Test de fumée contre les VRAIES API (à lancer chez vous)
    └── fixtures/               Réponses d'API SYNTHÉTIQUES, jamais chargées par l'app
```

**Règles respectées :** un fichier = une responsabilité ; aucun CSS dans le HTML ; aucun chemin absolu dépendant d'une machine ; aucune donnée d'entreprise codée en dur.

---

## 5. API utilisées, limites et licences

| Service | Endpoint | Clé | Limite officielle | Licence |
|---|---|---|---|---|
| **Recherche d'entreprises** (DINUM) | `https://recherche-entreprises.api.gouv.fr/search` | non | **7 req/s**, 25 résultats/page, 10 000 résultats explorables | Licence Ouverte 2.0 |
| **Géocodage BAN / Géoplateforme IGN** | `https://data.geopf.fr/geocodage/search` et `/reverse` | non | **50 req/s** par IP | Licence Ouverte 2.0 |
| **Plan IGN** | `https://data.geopf.fr/wmts` — `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` | non | usage raisonnable | IGN, attribution |
| **BD ORTHO® (photo aérienne)** | `https://data.geopf.fr/wmts` — `HR.ORTHOIMAGERY.ORTHOPHOTOS` (20 cm), repli `ORTHOIMAGERY.ORTHOPHOTOS` | non | usage raisonnable | IGN, attribution |
| **OpenStreetMap** | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | non | [politique d'usage](https://operations.osmfoundation.org/policies/tiles/) | ODbL, attribution |
| **Panoramax** (photos de rue) | `https://api.panoramax.xyz/api/search` | **non** | usage raisonnable | CC BY-SA 4.0 / Licence Ouverte selon l'instance |
| **Mapillary** (photos de rue) | `https://graph.mapillary.com/images` | **oui, gratuit** | selon le jeton | CC BY-SA 4.0 |

### Mesures de respect des quotas

- Limiteur de débit par service : **220 ms** entre deux appels entreprises (≈ 4,5 req/s < 7), **120 ms** pour la BAN, **250 ms** pour Panoramax.
- Cache local : recherches **6 h**, géocodage **30 jours**, photographies **24 h**, avec plafond d'entrées et purge automatique.
- Dédoublonnage des requêtes concurrentes (une seule requête pour deux demandes identiques simultanées).
- `Retry-After` respecté, backoff exponentiel avec gigue, 2 tentatives maximum.
- Le serveur local applique en plus une limite de 12 req/s sur le relais public et 5 req/s sur Mapillary.

### Point d'attention historique

`api-adresse.data.gouv.fr` (ancienne API Adresse) est **décommissionnée depuis le 31 janvier 2026**. L'application utilise exclusivement `data.geopf.fr/geocodage`, son remplaçant officiel.

Détail des paramètres et des champs consommés : **[docs/API.md](docs/API.md)**.

---

## 6. Fiabilité des coordonnées GPS

C'est le cœur du sujet : une coordonnée juste mais imprécise est plus dangereuse qu'une absence de coordonnée. L'application **qualifie systématiquement** la position affichée.

### Ordre de résolution

1. **Position SIRENE** fournie par l'API (`latitude`, `longitude`), parfois déjà géocodée BAN (`geo_adresse`, `geo_id`).
2. **Géocodage BAN** de l'adresse déclarée, filtré sur le code postal et le code commune.
3. Décision :
   - BAN atteint le **numéro de voie** avec un score ≥ 0,70 → position BAN retenue, précision **« Niveau adresse »**.
   - Le `geo_id` SIRENE correspond à l'identifiant BAN → confiance **haute**, mention « confirmée par le géocodage SIRENE ».
   - Sinon, position SIRENE conservée, précision **« Position SIRENE (précision non garantie) »**, confiance faible.
   - Sinon, BAN niveau voie ou commune → précision annoncée comme telle, **cercle d'incertitude** tracé sur la carte.
   - Sinon → **erreur explicite**, aucune coordonnée inventée, aucun marqueur placé.
4. **Contrôle de cohérence** : si la position SIRENE et la position BAN sont distantes de plus de **300 m**, un avertissement chiffré s'affiche.
5. **Vérification à la demande** : bouton « Vérifier l'adresse à ce point » → géocodage inverse BAN.

### Garde-fous

- Coordonnées hors de l'emprise France (métropole + DROM) : rejetées.
- `(0, 0)` : rejeté.
- Établissements **non diffusibles** (INSEE) : message dédié, aucun appel de géocodage.
- Chaque coordonnée affichée porte sa **source** et son **niveau de précision**.

---

## 7. Authenticité des images

### A. Vue aérienne — vraie photographie

Orthophotographie **BD ORTHO® de l'IGN**, 20 cm de résolution, servie en WMTS. Ce n'est pas un plan : l'interface le dit explicitement (« Orthophotographie réelle, pas un plan »). Zoom jusqu'au bâtiment, croix de visée sur les coordonnées, cercle d'incertitude si la position est approximative, lien vers **IGN Remonter le temps** pour comparer les millésimes.

Si les tuiles ne répondent pas : repli automatique de la couche 20 cm vers la couche standard, puis **message d'indisponibilité**. Aucune image de remplacement n'est jamais affichée.

Le fond de plan (OSM ou Plan IGN) n'est, lui, **jamais** présenté comme une photographie : le pied de carte rappelle « Fond de plan — pas une photographie ».

### B. Photographies de rue

- **Panoramax** (fédération IGN / OpenStreetMap France) : sans jeton, CORS ouvert, recherche par `place_position` + `place_distance` (repli `bbox`).
- **Mapillary** : si un jeton est configuré, recherche par `bbox`.
- Chaque vignette affiche : **fournisseur, date de prise de vue, auteur, licence, distance au point, lien vers la source**, et un badge `360°` pour les panoramas.
- Agrandissement en lightbox navigable (flèches clavier, Échap).
- Rayon réglable : 50 / 100 / 200 / 500 m.
- Si aucune image : message explicite par fournisseur, avec le rayon testé. **Aucune image générique.**

> Les photographies de rue montrent l'**environnement de l'adresse**. Elles ne prouvent pas l'identité de l'occupant actuel du bâtiment. Ce rappel est affiché dans l'interface.

### C. Photographies complémentaires

Il n'existe **aucune API gratuite** permettant d'associer de façon fiable une photographie « officielle » à un SIRET. Plutôt que d'inventer, l'application :

1. affiche un message explicite : *« Aucune photographie officielle vérifiée »* ;
2. permet d'ajouter manuellement une photographie **dont vous garantissez la provenance** — URL **et** source sont obligatoires, la licence et la date sont recommandées ;
3. conserve ces photos uniquement sur votre appareil, avec leur attribution.

---

## 8. Exports et presse-papiers

| Export | Contenu | Format |
|---|---|---|
| Résultats de recherche | 23 colonnes : identité, SIREN/SIRET, état, NAF + libellé, adresse, commune, département, région, lat/lon, source des coordonnées, liens OSM et Annuaire | **CSV** UTF-8 avec BOM, séparateur `;`, CRLF |
| Résultats géolocalisés | Points + propriétés, `EPSG:4326`, précision et source par point | **GeoJSON** (QGIS, uMap…) |
| Fiche entreprise | Tous les champs renseignés, en trois colonnes *Champ / Valeur / Source* | **CSV** |
| Fiches enregistrées | Ensemble des fiches sauvegardées | **JSON** |

Le CSV s'ouvre directement dans **Excel version française** sans assistant d'importation. Les cellules commençant par `=`, `+`, `-`, `@` sont neutralisées (protection contre l'injection de formule).

Copies en un clic : **adresse complète**, **coordonnées GPS**, **SIRET**, **SIREN**. Ouverture de la localisation dans **OpenStreetMap**.

---

## 9. Données locales et confidentialité

- **Aucun serveur tiers** autre que les API publiques listées. Aucun analytics, aucun traceur, aucune police externe, aucun CDN.
- **Historique désactivé par défaut.** Aucun enregistrement tant que vous ne l'avez pas activé explicitement dans les paramètres.
- Les **fiches enregistrées** résultent toujours d'un clic sur l'étoile.
- Les **photos complémentaires** ne sont ajoutées que par vous.
- Tout est stocké dans le `localStorage` du navigateur, sous le préfixe `clf:`.
- Purge disponible : *Vider le cache*, *Tout effacer*, suppression par entrée d'historique.
- Si le `localStorage` est indisponible (navigation privée), un magasin mémoire prend le relais et l'interface le signale.

---

## 10. Tests

```bash
# Tests unitaires (101 tests, aucune dépendance, aucun réseau)
npm test

# Tests d'interface (jsdom requis : npm install)
npm install        # installe jsdom, uniquement pour ces tests
npm run test:css   # 16 vérifications : aucun élément masqué ne fuite à l'affichage
npm run test:boot  # 14 vérifications : ouverture en file://, chien de garde
npm run test:dom   # 42 vérifications : parcours complet, Leaflet réel

# Les deux
npm run test:all

# Connectivité RÉELLE aux API publiques (à lancer sur une machine avec Internet)
npm run test:live
```

`npm test` et `npm run test:dom` fonctionnent **hors ligne**. `npm run test:live` interroge réellement les API et affiche, pour chaque cas, le SIRET, les coordonnées et le score de géocodage obtenus.

### Couverture

- **Unitaires** : Luhn SIREN/SIRET (dont dérogation La Poste), codes postaux, départements (Corse, DROM), haversine, emprise France, similarité de noms, limiteur de débit, cache TTL, retry/backoff/429, construction des requêtes API, normalisation du schéma officiel, déduplication, filtres et tris, replis de recherche, **toute la logique de décision GPS**, CSV/GeoJSON, stockage et historique opt-in, Panoramax/Mapillary, transport.
- **Intégration DOM** : démarrage, carte Leaflet, recherche, résultats, marqueurs, fiche, géocodage, onglet Images, tuiles IGN, photos de rue, lightbox, bascule de fond, plein écran, exports, favoris, paramètres, historique, états d'erreur, **absence d'erreur JavaScript**, **absence d'appel à un service non déclaré**, **absence de jeton dans les requêtes navigateur**.

Les fixtures de `tests/fixtures/` sont **synthétiques** et **jamais chargées par l'application** : il n'existe aucun « mode démo » pouvant faire passer de fausses données pour réelles.

Rapport détaillé et périmètre vérifié : **[docs/VERIFICATION.md](docs/VERIFICATION.md)**.

---

## 11. Limites connues et alternatives gratuites

| Limite | Réalité | Solution retenue |
|---|---|---|
| **Liste exhaustive des établissements d'un SIREN** | L'API publique renvoie le siège + les établissements *connexes* (100 max/page), pas la totalité des sites d'un grand groupe | Onglet *Établissements* avec filtre par code postal + lien vers la fiche officielle de l'Annuaire |
| **CORS de l'API entreprises** | Pas d'en-tête `Access-Control-Allow-Origin` | Relais de même origine intégré à `server.js` |
| **Mapillary sans jeton** | Impossible : l'API Graph exige un *client token* | **Panoramax**, sans jeton, couvre déjà largement la France ; jeton Mapillary gratuit et gardé côté serveur |
| **Photo « officielle » d'un établissement** | Aucune source gratuite fiable par SIRET | Message explicite + ajout manuel sourcé, jamais d'image générique |
| **Couverture aérienne 20 cm** | La couche HR ne couvre pas tout (certains DROM) | Repli automatique sur `ORTHOIMAGERY.ORTHOPHOTOS`, puis message si échec |
| **Position SIRENE imprécise** | Certaines adresses ne sont géocodées qu'à la commune | Précision annoncée, cercle d'incertitude, géocodage BAN prioritaire quand il atteint le numéro de voie |
| **Profondeur de pagination** | `page × per_page ≤ 10 000` | Message invitant à affiner la recherche |
| **Google Street View** | API payante et non libre | Non intégré : Panoramax et Mapillary sont les alternatives libres |
| **Cadastre, intérieur des bâtiments** | Hors périmètre des services gratuits retenus | Non intégré |

---

## 12. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Bandeau « le fichier est ouvert directement » | Ouverture en `file://` (double-clic sur `index.html`) | Double-cliquez sur `Lancer-Company-Locator.bat`, ou `node server.js` puis `http://localhost:8080/` |
| Page sombre avec une modale « Historique » visible au chargement | Ancienne version : `.modal { display:flex }` écrasait l'attribut `hidden` | **Corrigé** par `[hidden] { display:none !important }` — rechargez avec `Ctrl + F5` pour vider le cache CSS |
| Page blanche ou bandeau « Carte indisponible » | Fichiers servis en `file://` | Lancez `node server.js` puis `http://localhost:8080/` |
| « Le serveur local n'a pas pu joindre le service public » | La machine qui exécute `server.js` n'a pas accès à Internet (sandbox, proxy d'entreprise, pare-feu) | Lancez l'application sur votre poste ; autorisez `recherche-entreprises.api.gouv.fr` et `data.geopf.fr` |
| Recherches vides mais carte OK | Blocage CORS en mode serveur statique | Utilisez `node server.js` (relais de même origine) |
| « Le service limite temporairement les requêtes » | Quota public atteint (429) | Attendez quelques secondes ; le cache évite de re-interroger |
| Photos de rue Mapillary absentes | Jeton non configuré | Normal : Panoramax reste actif. Voir [section 3](#3-configuration-mapillary-optionnelle) |
| Photo aérienne grisée | Tuiles IGN indisponibles ou zone non couverte | Basculez sur le plan, ou réessayez ; aucun substitut n'est affiché |
| `EADDRINUSE` | Port 8080 occupé | `$env:PORT=8090; node server.js` |
| Coordonnées absentes | Établissement non diffusible ou adresse non géocodable | Message explicite dans la fiche ; consultez la fiche officielle |

Le panneau **état des API** (pastille dans l'en-tête) teste réellement les cinq services et affiche latence et diagnostic.

---

## 13. Grille de validation

| # | Critère | État |
|---|---|---|
| 1 | Recherche réelle nom + code postal | ✅ `searchEntreprises` → API officielle |
| 2 | Résultats provenant de l'API officielle | ✅ aucune donnée locale d'entreprise |
| 3 | SIREN et SIRET correctement affichés | ✅ formatés, validés par Luhn, copiables |
| 4 | Adresses correctement récupérées | ✅ adresse SIRENE + voie reconstituée |
| 5 | Coordonnées GPS réelles et vérifiables | ✅ BAN / SIRENE, source + précision + contrôle d'écart |
| 6 | Marqueur correspondant à l'adresse | ✅ priorité au géocodage niveau numéro de voie |
| 7 | Vue aérienne IGN fonctionnelle | ✅ WMTS BD ORTHO®, repli + message d'erreur |
| 8 | Photos Mapillary quand elles existent | ✅ via proxy sécurisé ; Panoramax sans jeton |
| 9 | Images indisponibles signalées | ✅ message dédié par fournisseur, jamais d'image générique |
| 10 | Fonctionnement local sous Windows | ✅ `node server.js`, chemins relatifs uniquement |
| 11 | Export CSV fonctionnel | ✅ BOM + `;` + CRLF, testé |
| 12 | Aucun abonnement payant obligatoire | ✅ zéro clé requise pour le cœur de l'application |

---

## Licence

Code de l'application : **MIT**.
Leaflet 1.9.4 : **BSD-2-Clause** (voir `vendor/leaflet/LICENSE`).
Données et images : licences de leurs producteurs respectifs (voir [section 5](#5-api-utilisées-limites-et-licences) et l'onglet *Sources* de chaque fiche). Les attributions sont affichées en permanence sur les cartes et sous chaque photographie.
