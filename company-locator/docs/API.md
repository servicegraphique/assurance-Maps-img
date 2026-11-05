# API publiques utilisées — référence technique

Toutes les URL sont construites dans `js/config.js` et surchargées éventuellement par `config.local.js`. Aucune clé n'est nécessaire pour le fonctionnement de base.

---

## 1. API Recherche d'entreprises (DINUM / annuaire-entreprises.data.gouv.fr)

- **Base** : `https://recherche-entreprises.api.gouv.fr`
- **Endpoint** : `GET /search`
- **Authentification** : aucune
- **Limite** : **7 requêtes/seconde** par IP. L'application s'impose 220 ms entre deux appels (≈ 4,5 req/s).
- **CORS** : **aucun en-tête `Access-Control-Allow-Origin`**. → relais local `GET /api/proxy/entreprises/search` (voir §7).
- **Sources de données** : SIRENE (INSEE), RNE, Base Sirene ouverte, INPI.
- **Licence** : Licence Ouverte 2.0 (Etalab).

### Paramètres envoyés

| Paramètre | Usage dans l'application |
|---|---|
| `q` | Terme de recherche libre : nom, raison sociale, sigle, enseigne, **SIREN**, **SIRET**. Préfixes supportés : `siren:130025265`. Minimum 3 caractères si aucun autre filtre. |
| `code_postal` | Code postal français, regex `^((0[1-9])\|([1-8][0-9])\|(9[0-8])\|(2A)\|(2B))[0-9]{3}$`. |
| `code_commune` | Code **INSEE** de la commune (ex. `69382` pour Lyon 2e). Obtenu par résolution BAN. |
| `departement` | Code département, déduit du code postal. |
| `etat_administratif` | `A` (actifs) ou `C` (cessés). Filtre sur l'**unité légale**. |
| `page`, `per_page` | Pagination, `per_page ≤ 25`, `page × per_page ≤ 10 000`. |
| `limite_matching_etablissements` | Nombre d'établissements connexes inclus (1 à 100). L'application utilise 25 en recherche, 100 dans l'onglet *Établissements*. |
| `minimal`, `include` | Non utilisés en recherche standard : la réponse complète est nécessaire pour les adresses. |

### Champs consommés

**Réponse** : `{ results[], total_results, page, per_page, total_pages, execution_time }`

**Unité légale (`results[i]`)** :

| Champ | Destination dans la fiche |
|---|---|
| `siren` | Identifiant société, lien Annuaire, validation Luhn |
| `nom_complet`, `nom_raison_sociale`, `sigle` | Titre et dénomination |
| `etat_administratif` | Badge « Société active / cessée » |
| `activite_principale` | Code NAF + libellé (`assets/data/naf-codes.json`) |
| `nature_juridique` | Forme juridique (`assets/data/natures-juridiques.json`) |
| `categorie_entreprise` | PME / ETI / GE |
| `date_creation`, `date_fermeture` | Dates |
| `tranche_effectif_salarie` | Effectif (`assets/data/tranches-effectifs.json`) |
| `nombre_etablissements`, `nombre_etablissements_ouverts` | Compteur de sites |
| `statut_diffusion` | Blocage des non-diffusibles |
| `siege` | Établissement siège |
| `matching_etablissements[]` | Autres établissements correspondants |

**Établissement (`siege` ou `matching_etablissements[i]`)** :

| Champ | Destination |
|---|---|
| `siret` | Identifiant site, clé de dédoublonnage, validation Luhn |
| `est_siege` | Couleur du marqueur, badge « Siège » |
| `etat_administratif` | Badge « Établissement actif / fermé » |
| `adresse`, `complement_adresse` | Adresse brute |
| `numero_voie`, `indice_repetition`, `type_voie`, `libelle_voie` | Voie reconstituée |
| `code_postal`, `commune`, `libelle_commune` | Ville, code INSEE |
| `departement`, `region` | Libellés via référentiels INSEE |
| `latitude`, `longitude` | Position SIRENE (**chaînes de caractères**) |
| `geo_adresse`, `geo_id` | Adresse et identifiant BAN déjà résolus par l'API |
| `nom_commercial`, `liste_enseignes` | Nom commercial |
| `activite_principale` | NAF de l'établissement (prioritaire sur celui de l'unité légale) |
| `date_creation`, `date_fermeture` | Dates du site |
| `statut_diffusion_etablissement` | Blocage des non-diffusibles |

> **Piège important** : dans `matching_etablissements`, plusieurs champs sont **masqués** par l'API (`geo_adresse`, `numero_voie`, `type_voie`, `libelle_voie`, `departement`). L'application les **reconstitue** à partir du code postal, du code commune INSEE et de l'adresse brute, plutôt que d'afficher des champs vides.

### Exemples de requêtes réellement construites

```
/search?q=Allianz&code_postal=75015&etat_administratif=A&page=1&per_page=10&limite_matching_etablissements=25
/search?code_postal=33000&etat_administratif=A&page=1&per_page=10
/search?q=13002526500013&per_page=10&limite_matching_etablissements=25
/search?q=siren:130025265&per_page=1&limite_matching_etablissements=100
```

---

## 2. Géocodage — Base Adresse Nationale via Géoplateforme IGN

- **Base** : `https://data.geopf.fr/geocodage`
- **Endpoints** : `GET /search`, `GET /reverse`
- **Authentification** : aucune
- **Limite** : **50 req/s** par IP (l'application cible ≈ 8 req/s, 120 ms d'intervalle). En cas de 429, `Retry-After` est respecté.
- **CORS** : ouvert (`*`) → appel direct possible depuis le navigateur.
- **Licence** : Licence Ouverte 2.0.

> ⚠️ `api-adresse.data.gouv.fr` a été **décommissionnée le 31 janvier 2026**. Ne pas l'utiliser.

### Recherche directe

```
GET /search?q=15+rue+de+Vaugirard+75015+Paris&limit=5&autocomplete=0&postcode=75015
GET /search?q=Lyon&type=municipality&limit=1&autocomplete=0
```

Réponse GeoJSON : `features[].properties.{label, city, citycode, postcode, type, score, id}` et `features[].geometry.coordinates = [lon, lat]`.

- `type` : `housenumber` (numéro de voie), `street`, `locality`, `municipality`.
- `score` : 0 à 1. L'application exige **≥ 0,50** pour accepter un résultat et **≥ 0,70** au niveau `housenumber` pour lui faire confiance sur la position du bâtiment.
- `citycode` : code INSEE, utilisé comme filtre `code_commune` de l'API entreprises.

### Recherche inverse

```
GET /reverse?lat=48.8509&lon=2.2896&limit=1
```

Utilisée par le bouton « Vérifier l'adresse à ce point ».

---

## 3. Géoplateforme IGN — WMTS (plan et photographie aérienne)

- **Base** : `https://data.geopf.fr/wmts`
- **Authentification** : aucune (les anciennes clés IGN ne sont plus nécessaires)
- **CORS** : ouvert
- **Licence** : IGN — attribution obligatoire

### Patron de tuile (équivalent XYZ)

```
https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
  &LAYER={couche}&STYLE=normal&TILEMATRIXSET=PM&FORMAT={format}
  &TILEMATRIX={z}&TILEROW={y}&TILECOL={x}
```

| Couche | Contenu | Format | Zoom natif |
|---|---|---|---|
| `HR.ORTHOIMAGERY.ORTHOPHOTOS` | **Orthophotographie 20 cm** | `image/jpeg` | 6 → **19** |
| `ORTHOIMAGERY.ORTHOPHOTOS` | Orthophotographie standard (repli, couverture plus large) | `image/jpeg` | 6 → 19 |
| `ORTHOIMAGERY.ORTHOPHOTOS2024` … `2000-2005` | Millésimes historiques | `image/jpeg` | 6 → 19 |
| `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` | Plan IGN | `image/png` | 0 → 19 |

Le zoom Leaflet est plafonné à `maxNativeZoom = 19` puis agrandi jusqu'à 21 : au-delà, l'image est interpolée, ce qui est signalé par la perte de netteté, jamais présenté comme de la résolution supplémentaire.

Comparaison de millésimes : lien **IGN Remonter le temps** — `https://remonterletemps.ign.fr/comparer/basic?x={lon}&y={lat}&z=17`.

---

## 4. OpenStreetMap — fond de plan

```
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

- Sans clé. [Politique d'usage des tuiles](https://operations.osmfoundation.org/policies/tiles/) : pas de préchargement massif, usage interactif uniquement.
- Attribution obligatoire : `© OpenStreetMap contributors`.
- Licence **ODbL**.
- **Ce fond est un plan, jamais une photographie.** L'interface l'indique.

---

## 5. Panoramax — photographies de rue libres

- **Base** : `https://api.panoramax.xyz/api`
- **Endpoint** : `GET /search`
- **Authentification** : **aucune pour la lecture** (l'écriture seule exige un compte)
- **CORS** : ouvert
- **Format** : STAC (SpatioTemporal Asset Catalog)
- **Licences** : Licence Ouverte 2.0 ou CC BY-SA 4.0 selon la séquence ; l'application affiche la licence renvoyée.

```
GET /api/search?place_position={lon},{lat}&place_distance=0-{rayon}&limit=100
```

Repli automatique sur `bbox={minLon},{minLat},{maxLon},{maxLat}` si l'instance renvoie HTTP 400 sur `place_position`.

Champs consommés : `features[].id`, `properties.datetime`, `properties["view:azimuth"]`, `properties["pers:interior_orientation"]`, `assets.thumb.href`, `assets.sd.href`, `assets.hd.href`, `geometry.coordinates`.

Lien profond vers la visionneuse : `https://api.panoramax.xyz/#focus=pic&pic={id}`.

---

## 6. Mapillary — photographies de rue (jeton gratuit requis)

- **Base** : `https://graph.mapillary.com`
- **Endpoint** : `GET /images`
- **Authentification** : **client token obligatoire**, gratuit, créé sur <https://www.mapillary.com/dashboard/developers>
- **Licence** : CC BY-SA 4.0

```
GET /images?access_token={token}
  &fields=id,thumb_1024_url,captured_at,compass_angle,is_pano,geometry
  &bbox={minLon},{minLat},{maxLon},{maxLat}&limit=100
```

**Le jeton n'est jamais placé dans le JavaScript public.** Le navigateur appelle :

```
GET /api/mapillary/images?bbox=…&limit=…      (même origine)
```

et `server.js` ajoute le jeton côté serveur avant d'interroger Mapillary, puis renvoie la réponse. Le jeton n'apparaît dans aucune réponse, aucun log de requête et aucun export.

Lien profond : `https://www.mapillary.com/app/?pKey={id}&focus=photo`.

Sans jeton configuré, **aucune requête Mapillary n'est émise** : l'interface indique simplement que la source n'est pas configurée et s'appuie sur Panoramax.

---

## 6 bis. Vues immersives « Street View » 360°

> **4e bouton de la carte.** Le bouton `data-baselayer="street"` réutilise exactement les mêmes photographies (`fetchStreetPhotos()` → Panoramax/Mapillary) mais les affiche **sans iframe** : image plein cadre superposée à la carte, crédit, compteur et lien vers la fiche source. Aucune requête n'est faite avant le clic sur le bouton.

Trois sources, construites dans `js/streetview.js`. **Aucune n'est chargée avant un clic utilisateur.**

### Panoramax — viewer officiel (sans clé)

```
https://api.panoramax.xyz/#focus=pic&pic={uuid}&xyz={cap}/{inclinaison}/{zoom}
```

| Paramètre | Plage | Rôle |
|---|---|---|
| `focus=pic` | — | la photographie occupe tout le cadre |
| `pic` | UUID STAC | photographie affichée |
| `xyz` | cap 0–360, inclinaison −90–90, zoom 0–100 | orientation initiale |

`nav=none` est **volontairement omis** : le déplacement dans la séquence est l'intérêt de la vue immersive. L'identifiant provient de `features[].id` déjà récupéré par la recherche STAC — **aucune requête supplémentaire** n'est nécessaire pour construire l'URL.

### Mapillary — embed public (sans jeton)

```
https://www.mapillary.com/embed?image_key={id}&style=photo
```

`style` ∈ `photo` | `split` | `classic`.

> **Nuance importante** : l'**embed** ne demande aucun jeton, alors que l'**API Graph** (`graph.mapillary.com`) et les tuiles en exigent un. Un jeton reste donc nécessaire pour *trouver* les photos, pas pour les *afficher* en immersif.

### Google Street View — API Maps Embed (clé gratuite, optionnelle)

```
https://www.google.com/maps/embed/v1/streetview
  ?key={clé}&location={lat},{lon}&heading={cap}&pitch={inclinaison}&fov={10-100}&radius={m}
```

- **Tarification** : l'API **Maps Embed** est **gratuite, sans limite de requêtes** (ni QPS, ni quota journalier). Ce n'est pas l'API *Street View Static*, facturée elle au-delà de 10 000 appels/mois.
- **Prérequis** : un projet Google Cloud avec **facturation activée**, l'API *Maps Embed* activée, et une clé restreinte à cette API et aux référents HTTP.
- **La clé ne quitte jamais le serveur** : le navigateur demande `/api/streetview/embed`, le serveur répond `302` vers Google en ajoutant la clé.

---

## 7. Relais local intégré (`server.js`)

| Route | Rôle | Garde-fous |
|---|---|---|
| `GET /api/health` | Détection du serveur local par le front | Aucune donnée sensible |
| `GET /api/proxy/entreprises/search?…` | Relais vers l'API Recherche d'entreprises | Origine figée, chemin `/search` uniquement, 12 req/s |
| `GET /api/proxy/geocodage/search?…` et `/reverse?…` | Relais vers la Géoplateforme | Origine figée, chemins autorisés uniquement |
| `GET /api/proxy/panoramax/search?…` | Relais vers Panoramax | Origine figée |
| `GET /api/streetview/status` | Indique si une clé Google Embed est chargée (**booléen seulement**) | Ne renvoie jamais la clé |
| `GET /api/streetview/embed?lat=&lon=&heading=&pitch=&fov=&radius=` | Redirige vers Google Street View en ajoutant la clé | 8 req/s, coordonnées obligatoires et bornées, `302` + `Referrer-Policy: no-referrer`, `501` sans clé |
| `GET /api/mapillary/status` | Indique si un jeton est chargé (**booléen seulement**) | Ne renvoie jamais le jeton |
| `GET /api/mapillary/images?bbox=…` | Proxy Mapillary authentifié | 5 req/s, timeout 15 s |
| `GET /api/reload-token` | Recharge `server.config.json` à chaud | Aucun secret renvoyé |

Sécurité du serveur statique : confinement au dossier du projet, refus des traversées de répertoire, **HTTP 403 sur `server.config.json` et `.env*`**, aucun listing de répertoire, en-têtes `X-Content-Type-Options: nosniff` et `Referrer-Policy: no-referrer`.

Le relais n'est **pas un proxy ouvert** : impossible de lui faire interroger une autre origine ou un autre chemin que ceux déclarés dans `PUBLIC_PROXIES`.

**Piège évité** : `Number(null)` vaut `0` en JavaScript. Un paramètre `lat` ou `lon` **absent** est explicitement refusé (`400`) au lieu d'être interprété comme la coordonnée 0 — sinon la vue s'ouvrirait dans le golfe de Guinée.

---

## 8. Référentiels locaux

`assets/data/*.json` provient du dépôt officiel `annuaire-entreprises-data-gouv-fr/search-api` (`app/labels/`) : codes NAF rév. 2, natures juridiques, départements, régions, tranches d'effectifs, catégories d'entreprise. Ils sont servis localement pour éviter un appel réseau par libellé. Aucun référentiel d'entreprise n'y figure.
