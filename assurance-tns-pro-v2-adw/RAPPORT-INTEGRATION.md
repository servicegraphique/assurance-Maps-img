# Intégration de assurance-tns-pro-v2-adw

Le formulaire et le design de la page sont conservés. Le wrapper de capture n'utilise plus le handler Webflow de soumission ; l'ancien SMS concurrent et la simulation locale des appels ont été retirés de ce dossier. `lead-handler.js` et `verification-sms.js` assurent la capture et la vérification SMS. Le conteneur GTM `GTM-53SH7D7F` est rétabli après le Consent Mode par défaut.

- Identité CRM : `ADW_LP_ASSURANCE_TNS_PRO` (à valider/enregistrer côté CRM).
- Source de secours : `LP TNS PRO`.
- CRM : URL et mode dans `lead-handler.js` (`UBE_CONFIG`, surcharge possible par `window.UBE_CONFIG_OVERRIDE`). Le mode par défaut `nocors` ne confirme pas la réception.
- Google Sheets : URL Apps Script dans `lead-handler.js` ; confirmer la feuille et ses droits.
- SMS : URL et délai dans `verification-sms.js` ; confirmer CORS et tester un vrai SMS sur le domaine final.
- En cas de réponses non confirmées ou d'échec des deux destinations, le formulaire reste disponible ; un beacon CRM accepté peut néanmoins avoir été reçu, la déduplication serveur est recommandée.


## Étape « Localisez votre entreprise » — localisateur intégré (2026-11-05)

L'ancien module de localisation (`localisation.js`, `localisation-core.js`,
`localisation.css`, `vendor/leaflet/`) a été **retiré**. L'étape située entre
« Quelle est la société concernée ? » et « Votre société existe-t-elle déjà ? »
intègre désormais le **localisateur d'entreprises** (`../company-locator/`)
dans une iframe, en mode `?embed=1`. Voir `LOCALISATEUR.md`.

- L'étape « société » ne demande plus la **rue** ni la **ville** : seuls le nom
  de société et le code postal sont saisis. Les champs cachés `adresse` et
  `ville` sont remplis par le localisateur pour les colonnes historiques.
- Le localisateur se charge à l'affichage de l'étape avec le nom et le code
  postal déjà saisis, puis renvoie l'établissement choisi par `postMessage`
  (`locator:ready`, `locator:results`, `locator:selected`, `locator:error`).
- Le visiteur retrouve la carte (Plan OSM, Plan IGN, photo aérienne, vue de rue
  Panoramax), la fiche de l'établissement et sa position GPS. Bouton
  « Utiliser cette entreprise » pour confirmer.
- Champs `loc_*` transmis au CRM et au Google Sheet : `loc_entreprise`,
  `loc_siret`, `loc_siren`, `loc_adresse`, `loc_code_postal`, `loc_commune`,
  `loc_latitude`, `loc_longitude`, `loc_precision`, `loc_source`, `loc_naf`,
  `loc_page`, `loc_telephone`, `loc_mobile`, `loc_email`, `loc_contact`,
  plus un récapitulatif dans `autre_info_fj`. Les colonnes
  `loc_batiment_*` de l'ancienne version ne sont plus alimentées.
- Les quatre champs de contact proviennent du bloc « Coordonnées de
  contact » de la fiche : l'API officielle ne publie ni téléphone ni e-mail,
  ces valeurs sont donc saisies par le visiteur et stockées sur son appareil
  (elles restent vides s'il ne les renseigne pas).
- Sans sélection, « Suivant » affiche une explication et un lien de poursuite :
  aucun lead n'est bloqué, même si le localisateur est injoignable.
- Le localisateur exige une origine `http(s)://` (modules ES). En local :
  `Lancer-Formulaire-TNS.bat` ou `./lancer-formulaire.sh` (serveur
  `company-locator/server.js` avec `STATIC_ROOT=.` et relais d'API). En
  production, déposer `company-locator/` à côté du formulaire, ou pointer
  `data-src` / `LOCALISATEUR_CONFIG.frameSrc` vers l'URL hébergée.
- Hôtes externes appelés : ceux du localisateur (`recherche-entreprises.api.gouv.fr`
  via le relais local, `data.geopf.fr`, `api.panoramax.xyz`, `graph.mapillary.com`
  si un jeton est configuré, `server.arcgisonline.com`, `tile.openstreetmap.fr`,
  `data.geopf.fr` pour les tuiles IGN). À déclarer dans la CSP ; prévoir
  `frame-src` pour l'iframe et `connect-src` pour ces hôtes.
- Tests : 8 cas (`npm ci --prefix tests && npm test --prefix tests`) sur la
  structure, la suppression des champs, le pont `postMessage`, le garde-fou et
  le repli. Le parcours réel (navigation complète, réception CRM) reste à
  valider manuellement, localisateur inclus.

Tests : `npm ci --prefix tests && npm test --prefix tests`. Ils simulent les réponses réseau ; vérifier également les parcours complets, tous les champs et la réception réelle avant publication. Un résultat local n'est pas une preuve de réception côté CRM, Sheets ou SMS.
