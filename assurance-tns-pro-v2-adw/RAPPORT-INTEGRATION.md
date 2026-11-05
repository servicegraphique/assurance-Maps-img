# Intégration de assurance-tns-pro-v2-adw

Le formulaire et le design de la page sont conservés. Le wrapper de capture n'utilise plus le handler Webflow de soumission ; l'ancien SMS concurrent et la simulation locale des appels ont été retirés de ce dossier. `lead-handler.js` et `verification-sms.js` assurent la capture et la vérification SMS. Le conteneur GTM `GTM-53SH7D7F` est rétabli après le Consent Mode par défaut.

- Identité CRM : `ADW_LP_ASSURANCE_TNS_PRO` (à valider/enregistrer côté CRM).
- Source de secours : `LP TNS PRO`.
- CRM : URL et mode dans `lead-handler.js` (`UBE_CONFIG`, surcharge possible par `window.UBE_CONFIG_OVERRIDE`). Le mode par défaut `nocors` ne confirme pas la réception.
- Google Sheets : URL Apps Script dans `lead-handler.js` ; confirmer la feuille et ses droits.
- SMS : URL et délai dans `verification-sms.js` ; confirmer CORS et tester un vrai SMS sur le domaine final.
- En cas de réponses non confirmées ou d'échec des deux destinations, le formulaire reste disponible ; un beacon CRM accepté peut néanmoins avoir été reçu, la déduplication serveur est recommandée.


## Module « Localisation et identification de votre entreprise » (2026-11-04)

Une étape a été insérée dans le parcours, entre « Quelle est la société concernée ? » et « Votre société existe-t-elle déjà ? ». Elle affiche deux blocs indépendants (localisation / bâtiment), chacun avec sa modale de recherche, sa carte ou sa photo, ses coordonnées GPS et ses boutons « Rechercher » et « Valider ». Voir `LOCALISATION.md` pour le détail.

- L'étape « société » demande aussi la rue (`adresse`) et la ville (`ville`) : ces valeurs préremplissent les modales et déclenchent une recherche automatique dès l'affichage de l'étape de localisation, sans ressaisie. Désactivable via `prefillFromCompany` / `autoSearchFromCompany`.
- Les deux blocs proposent **quatre vues** : « Plan OSM », « Plan IGN », « Photo aérienne » et « Street View » (image de rue Panoramax / Commons, plein cadre, avec flèches et lien 360°). Le bloc localisation s'ouvre sur le plan OSM, le bloc bâtiment sur la photo aérienne ; le choix est transmis dans `loc_vue` / `loc_batiment_vue` (`plan osm`, `plan ign`, `vue aerienne`, `rue`).
- Fonds de carte sans clé : OpenStreetMap France, WMTS IGN `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` (data.geopf.fr) et Esri World Imagery, avec repli automatique sur Esri World Street Map. « Street View » n'utilise pas Google (clé payante, images non réutilisables) : l'image de rue vient de Panoramax et de Wikimedia Commons.

- Aucune clé d'API : OpenStreetMap (Leaflet embarqué dans `vendor/leaflet/`), Base Adresse Nationale via `data.geopf.fr`, Photon pour l'Europe, Panoramax et Wikimedia Commons pour les photos, Esri World Imagery pour la vue aérienne.
- Champs `loc_*` ajoutés au payload CRM et au Google Sheet, plus un récapitulatif dans `autre_info_fj`. Le script Apps Script doit exposer les nouvelles colonnes s'il filtre les paramètres.
- La validation est obligatoire par défaut ; un lien de poursuite évite de bloquer un lead lorsque les sources ouvertes ne couvrent pas l'adresse (`requireValidation: false` pour désactiver).
- Données conservées en `localStorage` (`cpro_loc_entreprise_v1`) uniquement pour ne pas perdre la saisie, purgées 15 s après l'envoi.
- Hôtes externes supplémentaires appelés par la page : `data.geopf.fr`, `photon.komoot.io`, `api.panoramax.xyz`, `commons.wikimedia.org`, `server.arcgisonline.com`, `tile.openstreetmap.fr` (repli). À déclarer dans la CSP et à vérifier côté DPO.
- Fond de carte : Esri World Street Map par défaut (le serveur `tile.openstreetmap.org` renvoyait des tuiles 403 « Access blocked »), repli automatique sur OpenStreetMap France puis message « Fond de carte indisponible ». Pour un trafic important, configurer `tiles.street` avec un fournisseur sous contrat.
- Tests : 45 cas (`npm ci --prefix tests && npm test --prefix tests`), dont 17 tests DOM jsdom à réseau simulé. Le parcours réel (navigation entre étapes, géocodage, photos, CRM) reste à valider manuellement.

Tests : `npm ci --prefix tests && npm test --prefix tests`. Ils simulent les réponses réseau ; vérifier également les parcours complets, tous les champs et la réception réelle avant publication. Un résultat local n'est pas une preuve de réception côté CRM, Sheets ou SMS.
