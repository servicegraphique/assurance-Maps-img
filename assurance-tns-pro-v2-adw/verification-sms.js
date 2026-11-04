/**
 * =====================================================================
 *  Verification du numero de telephone par SMS (SMS Partner / HelloLead)
 *  Module commun aux landing pages — a charger APRES lead-handler.js
 *
 *  Fonctionnement (identique a la LP de reference) :
 *  - saisie d'un mobile francais (10 chiffres, 06 ou 07) ;
 *  - « Recevoir le code » : POST action=envoyer_code + telephone
 *    (URLSearchParams, jamais de JSON brut) ;
 *  - le champ code s'affiche quand l'envoi reussit ; code a 6 chiffres,
 *    valable 10 minutes, usage unique, un nouveau code remplace l'ancien ;
 *  - « Verifier » : POST action=verifier_code + telephone + code ;
 *  - succes : badge « ✓ Numéro vérifié » + champ cache telephone_verifie=oui ;
 *  - renvoi desactive 120 s avec compte a rebours (memes regles serveur ;
 *    en cas de 429, le delai restant renvoye par l'API est affiche) ;
 *  - la reponse JSON est lue meme en erreur HTTP et son message est affiche
 *    (422 invalide, 404 aucun code, 410 expire, 409 deja utilise,
 *     429 trop rapide, 502 echec d'envoi SMS).
 *
 *  Le gestionnaire de leads (lead-handler.js) bloque l'envoi tant que le
 *  numero saisi n'est pas verifie, via window.smsVerification.estVerifie().
 *
 *  Surcharge possible avant chargement :
 *    window.SMS_VERIFICATION_CONFIG = { apiUrl: '...', cooldown: 120 };
 * =====================================================================
 */
(function () {
  'use strict';

  var CONFIG = Object.assign({
    apiUrl: 'https://mc.hellolead.pro/mon_compte/api/smspartner/envoi_code_verification.php',
    cooldown: 120
  }, window.SMS_VERIFICATION_CONFIG || {});

  var VERSION = '2026-10-26-sms1';
  var MOBILE_RE = /^0[67]\d{8}$/;

  function normalizePhone(value) {
    var p = String(value || '').trim().replace(/[\s().-]/g, '');
    if (/^\+?0033/.test(p)) return '0' + p.replace(/^\+?0033/, '').replace(/\D/g, '');
    if (/^\+33/.test(p)) return '0' + p.slice(3).replace(/\D/g, '');
    if (/^33\d{9}$/.test(p)) return '0' + p.slice(2);
    return p.replace(/\D/g, '');
  }

  function normalizeResult(response) {
    // Lire le corps (JSON si possible) meme pour les reponses HTTP 4xx/5xx :
    // il peut contenir le message utile a afficher.
    return response.text().then(function (text) {
      var data = {};
      if (text) {
        try { data = JSON.parse(text); }
        catch (e) { return { status: response.status, ok: response.ok, data: { message: String(text).slice(0, 500) }, validJson: false }; }
      }
      var validJson = !!text && !!data && typeof data === 'object' &&
        !Array.isArray(data) && Object.keys(data).length > 0;
      if (!data || typeof data !== 'object') data = {};
      return { status: response.status, ok: response.ok, data: data, validJson: validJson };
    }, function () {
      return { status: response.status, ok: response.ok, data: {} };
    });
  }

  function statusCode(result) {
    if (result.status >= 400) return result.status;
    var data = result.data || {};
    var code = parseInt(data.http_status || data.status_code || data.error_code, 10);
    return code >= 400 && code <= 599 ? code : result.status;
  }

  function succeeded(result) {
    if (!result.ok || !result.validJson || statusCode(result) >= 400) return false;
    var data = result.data || {};
    if (data.ok === false || data.success === false || data.error === true) return false;
    var state = String(data.status || data.statut || '').toLowerCase();
    return !/^(error|erreur|ko|failed|fail)$/.test(state);
  }

  function errorText(result) {
    var fallback = {
      422: 'Numéro ou code invalide.',
      404: 'Aucun code envoyé pour ce numéro. Cliquez sur « Recevoir le code ».',
      410: 'Le code a expiré. Demandez-en un nouveau.',
      409: 'Ce code a déjà été utilisé. Demandez-en un nouveau.',
      429: 'Veuillez patienter avant de redemander un code.',
      502: 'L’envoi du SMS a échoué. Réessayez dans un instant.'
    };
    var status = statusCode(result);
    if (result.ok && !result.validJson) return 'Réponse invalide du service SMS. Réessayez.';
    return (result.data && (result.data.message || result.data.error)) ||
      fallback[status] || 'Une erreur est survenue.';
  }

  function smsRequest(params) {
    var body = new URLSearchParams();
    body.set('action', String(params.action || ''));
    body.set('telephone', String(params.telephone || ''));
    if (params.code != null) body.set('code', String(params.code));
    return fetch(CONFIG.apiUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      body: body
    }).then(normalizeResult);
  }

  function injecterStyles() {
    if (document.getElementById('sms-verification-styles')) return;
    var style = document.createElement('style');
    style.id = 'sms-verification-styles';
    style.textContent =
      '.sms-verification{margin:10px 0 4px;font-size:14px;line-height:1.45}' +
      '.sms-verification .sms-send,.sms-verification .sms-check{appearance:none;border:0;cursor:pointer;' +
        'border-radius:6px;padding:10px 16px;font-size:14px;font-weight:600;line-height:1}' +
      '.sms-verification .sms-send{background:#1b5fd9;color:#fff}' +
      '.sms-verification .sms-check{background:#eef3fb;color:#1b5fd9;border:1px solid #1b5fd9}' +
      '.sms-verification button[disabled]{opacity:.55;cursor:not-allowed}' +
      '.sms-verification .sms-help{margin:6px 0 0;color:#5b6675;font-size:12.5px}' +
      '.sms-verification .sms-code-wrap{margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.sms-verification .sms-code-wrap[hidden]{display:none}' +
      '.sms-verification .sms-code{width:170px;max-width:60vw;padding:10px 12px;border:1px solid #b9c2cf;' +
        'border-radius:6px;font-size:16px;letter-spacing:3px}' +
      '.sms-verification .sms-message{margin:8px 0 0;min-height:1em}' +
      '.sms-verification .sms-message.is-error{color:#c62828}' +
      '.sms-verification .sms-message.is-success{color:#137333;font-weight:600}';
    document.head.appendChild(style);
  }

  function init() {
    var phone = (function () {
      var inputs = document.querySelectorAll('input[name]');
      for (var i = 0; i < inputs.length; i++) {
        var n = String(inputs[i].name || '').toLowerCase().replace(/[\s_-]+/g, '');
        if (n === 'telephone' || n === 'phone' || n === 'tel' || /^telephone\d+$/.test(n)) return inputs[i];
      }
      return document.querySelector('input[type="tel"]');
    })();
    if (!phone) return;
    var form = phone.form || (phone.closest ? phone.closest('form') : null);
    if (!form || form.querySelector('.sms-verification')) return;

    injecterStyles();

    var box = document.createElement('div');
    box.className = 'sms-verification';
    box.innerHTML =
      '<button type="button" class="sms-send">Recevoir le code</button>' +
      '<p class="sms-help">Code à 6 chiffres, valable 10 minutes et à usage unique. Un nouveau code remplace le précédent.</p>' +
      '<div class="sms-code-wrap" hidden>' +
        '<input type="text" class="sms-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="Code à 6 chiffres" aria-label="Code de vérification SMS"> ' +
        '<button type="button" class="sms-check">Vérifier</button>' +
      '</div>' +
      '<p class="sms-message" role="status" aria-live="polite"></p>';
    var phoneLabel = phone.closest ? phone.closest('label') : null;
    (phoneLabel || phone).insertAdjacentElement('afterend', box);

    var sendButton = box.querySelector('.sms-send');
    var checkButton = box.querySelector('.sms-check');
    var codeWrap = box.querySelector('.sms-code-wrap');
    var codeInput = box.querySelector('.sms-code');
    var message = box.querySelector('.sms-message');

    var flag = form.querySelector('input[name="telephone_verifie"]');
    if (!flag) {
      flag = document.createElement('input');
      flag.type = 'hidden';
      flag.name = 'telephone_verifie';
      form.appendChild(flag);
    }
    flag.value = 'non';

    var requestedPhone = '';
    var verifiedPhone = '';
    var countdownTimer = null;
    var requestGeneration = 0;

    function currentPhone() { return normalizePhone(phone.value); }

    function say(text, success) {
      message.textContent = text || '';
      message.classList.toggle('is-success', !!success);
      message.classList.toggle('is-error', !!text && !success);
    }

    function stopCountdown() {
      if (countdownTimer) window.clearInterval(countdownTimer);
      countdownTimer = null;
    }

    function countdown(seconds) {
      stopCountdown();
      sendButton.disabled = true;
      function tick() {
        if (seconds <= 0) {
          stopCountdown();
          sendButton.disabled = false;
          sendButton.textContent = 'Renvoyer le code';
          return;
        }
        sendButton.textContent = 'Renvoyer le code (' + seconds + ' s)';
        seconds -= 1;
      }
      tick();
      countdownTimer = window.setInterval(tick, 1000);
    }

    function resetAll(note) {
      requestGeneration += 1;
      verifiedPhone = '';
      requestedPhone = '';
      flag.value = 'non';
      stopCountdown();
      codeWrap.hidden = true;
      codeInput.value = '';
      checkButton.disabled = false;
      sendButton.hidden = false;
      sendButton.disabled = false;
      sendButton.textContent = 'Recevoir le code';
      if (note) say(note);
    }

    sendButton.addEventListener('click', function () {
      var number = currentPhone();
      if (!MOBILE_RE.test(number)) {
        say('Saisissez un mobile français valide (10 chiffres, 06 ou 07).');
        return;
      }
      requestedPhone = number;
      var generation = ++requestGeneration;
      sendButton.disabled = true;
      say('Envoi en cours…', true);
      smsRequest({ action: 'envoyer_code', telephone: number }).then(function (result) {
        if (generation !== requestGeneration || currentPhone() !== number || requestedPhone !== number) return;
        if (succeeded(result)) {
          codeWrap.hidden = false;
          codeInput.value = '';
          codeInput.focus();
          say('Code envoyé par SMS.', true);
          countdown(CONFIG.cooldown || 120);
        } else if (statusCode(result) === 429) {
          var data = result.data || {};
          var wait = parseInt(data.retry_after || data.retryAfter || data.delai || data.delai_restant ||
            data.restant || data.remaining || data.seconds_remaining, 10);
          if (!wait) {
            var match = errorText(result).match(/\d+/);
            wait = match ? parseInt(match[0], 10) : (CONFIG.cooldown || 120);
          }
          say(errorText(result) + ' Délai restant : ' + wait + ' s.');
          countdown(wait);
        } else {
          say(errorText(result));
          sendButton.disabled = false;
          sendButton.textContent = 'Recevoir le code';
        }
      }).catch(function () {
        if (generation !== requestGeneration || currentPhone() !== number || requestedPhone !== number) return;
        say('Connexion impossible au service SMS. Vérifiez votre connexion puis réessayez.');
        sendButton.disabled = false;
        sendButton.textContent = 'Recevoir le code';
      });
    });

    function verifyCode() {
      var number = currentPhone();
      var code = String(codeInput.value || '').replace(/\D/g, '');
      if (!MOBILE_RE.test(number)) return say('Vérifiez le numéro de téléphone saisi.');
      if (number !== requestedPhone) return say('Le numéro a changé. Demandez un nouveau code.');
      if (code.length !== 6) return say('Le code comporte 6 chiffres.');
      var generation = requestGeneration;
      checkButton.disabled = true;
      smsRequest({ action: 'verifier_code', telephone: number, code: code }).then(function (result) {
        if (generation !== requestGeneration || currentPhone() !== number || requestedPhone !== number) return;
        checkButton.disabled = false;
        if (succeeded(result)) {
          verifiedPhone = number;
          flag.value = 'oui';
          stopCountdown();
          codeWrap.hidden = true;
          sendButton.hidden = true;
          say('✓ Numéro vérifié.', true);
          try {
            form.dispatchEvent(new window.CustomEvent('sms-verifie', { bubbles: true, detail: { telephone: number } }));
          } catch (e) {}
        } else {
          say(errorText(result));
          if (statusCode(result) === 404) {
            // Aucun code cote serveur : revenir a l'etape d'envoi.
            stopCountdown();
            sendButton.disabled = false;
            sendButton.textContent = 'Recevoir le code';
          }
        }
      }).catch(function () {
        if (generation !== requestGeneration || currentPhone() !== number || requestedPhone !== number) return;
        checkButton.disabled = false;
        say('Connexion impossible au service de vérification. Réessayez.');
      });
    }

    checkButton.addEventListener('click', verifyCode);
    codeInput.addEventListener('input', function () {
      codeInput.value = String(codeInput.value || '').replace(/\D/g, '').slice(0, 6);
    });
    codeInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        verifyCode();
      }
    });

    phone.addEventListener('input', function () {
      var number = currentPhone();
      if ((verifiedPhone && number !== verifiedPhone) || (requestedPhone && number !== requestedPhone)) {
        resetAll('Le numéro a changé. Demandez un nouveau code.');
      }
    });

    /**
     * API publique utilisee par lead-handler.js pour bloquer l'envoi du
     * lead tant que le numero saisi n'est pas verifie.
     */
    window.smsVerification = Object.freeze({
      version: VERSION,
      estVerifie: function (number) {
        var n = number != null ? normalizePhone(number) : currentPhone();
        return !!verifiedPhone && currentPhone() === verifiedPhone && n === verifiedPhone;
      },
      numeroVerifie: function () { return verifiedPhone; },
      afficher: function () {
        if (box.scrollIntoView) {
          try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        }
      },
      reinitialiser: function () { resetAll(''); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
