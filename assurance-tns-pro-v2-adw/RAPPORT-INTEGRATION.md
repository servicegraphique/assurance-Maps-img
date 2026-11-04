# Intégration de assurance-tns-pro-v2-adw

Le formulaire et le design de la page sont conservés. Le wrapper de capture n'utilise plus le handler Webflow de soumission ; l'ancien SMS concurrent et la simulation locale des appels ont été retirés de ce dossier. `lead-handler.js` et `verification-sms.js` assurent la capture et la vérification SMS. Le conteneur GTM `GTM-53SH7D7F` est rétabli après le Consent Mode par défaut.

- Identité CRM : `ADW_LP_ASSURANCE_TNS_PRO` (à valider/enregistrer côté CRM).
- Source de secours : `LP TNS PRO`.
- CRM : URL et mode dans `lead-handler.js` (`UBE_CONFIG`, surcharge possible par `window.UBE_CONFIG_OVERRIDE`). Le mode par défaut `nocors` ne confirme pas la réception.
- Google Sheets : URL Apps Script dans `lead-handler.js` ; confirmer la feuille et ses droits.
- SMS : URL et délai dans `verification-sms.js` ; confirmer CORS et tester un vrai SMS sur le domaine final.
- En cas de réponses non confirmées ou d'échec des deux destinations, le formulaire reste disponible ; un beacon CRM accepté peut néanmoins avoir été reçu, la déduplication serveur est recommandée.

Tests : `npm ci --prefix tests && npm test --prefix tests`. Ils simulent les réponses réseau ; vérifier également les parcours complets, tous les champs et la réception réelle avant publication. Un résultat local n'est pas une preuve de réception côté CRM, Sheets ou SMS.
