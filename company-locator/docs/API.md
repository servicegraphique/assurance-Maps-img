# Sources de données et relais HTTP (`server.js`)

## Sources publiques utilisées (sans clé)

| Bloc de la fiche | Source | Protocole |
| --- | --- | --- |
| Identité, SIRET, NAF, effectif, dirigeants, bilans | API Recherche d'entreprises (DINUM / INSEE SIRENE / INPI) | REST JSON |
| Géocodage et normalisation d'adresse | Base Adresse Nationale — Géoplateforme IGN | REST JSON |
| Altitude du site | Service altimétrique IGN (RGE ALTI) + repli Open-Meteo | REST JSON |
| Carte `Localisation` | Plan IGN V2 (WMTS Géoplateforme) + repli OpenStreetMap | Tuiles WMTS / XYZ |
| Carte `Vue satellite` | IGN BD ORTHO HR (20 cm) + repli ORTHOIMAGERY.ORTHOPHOTOS | Tuiles WMTS |
| `Surface bâtiment` & usage | IGN BD TOPO V3 (`BDTOPO_V3:batiment`) + calcul géodésique Turf.js | WFS 2.0 GeoJSON |
| `Population`, `Département`, `Région` | API Géo France (`geo.api.gouv.fr/communes`) + tables INSEE locales de repli | REST JSON |
| `Météo actuelle` | Open-Meteo (`/v1/forecast`) | REST JSON |
| `Vue de la rue` | Panoramax (IGN / OSM France) | STAC JSON |

## Sources optionnelles (avec clé côté serveur uniquement)

- **Mapillary** (`mapillaryToken` dans `server.config.json` ou `MAPILLARY_TOKEN`) : photographies de rue complémentaires via `/api/mapillary/images`.
- **Google Street View Static API** (`googleStreetViewKey` ou `GOOGLE_STREETVIEW_KEY`) : aperçu de façade via `/api/streetview/metadata` et `/api/streetview/image`.

Les clés restent strictement dans `server.js` et ne sont jamais exposées au navigateur.

## Points d'entrée du serveur local

- `GET /api/health` — état du serveur et disponibilité des clés optionnelles.
- `GET /api/proxy/entreprises/*` — relais vers `https://recherche-entreprises.api.gouv.fr`.
- `GET /api/proxy/geocodage/*` — relais vers `https://data.geopf.fr/geocodage`.
- `GET /api/proxy/panoramax/*` — relais vers `https://api.panoramax.xyz/api`.
- `GET /api/weather?lat=…&lon=…` — relais borné vers Open-Meteo (météo actuelle).
- `GET /api/altitude?lat=…&lon=…` — relais borné vers le service altimétrique IGN.
- `GET /api/site?source=batiments&lat=…&lon=…` — relais borné vers WFS IGN BD TOPO V3.
- `GET /api/mapillary/status` et `GET /api/mapillary/images` — relais Mapillary.
- `GET /api/streetview/status`, `/metadata` et `/image` — relais Google Street View.

Si un relais local renvoie une erreur réseau (`502`/`504`) ou si l'application est servie par un hébergement statique, le navigateur interroge automatiquement les API publiques compatibles CORS en direct.
