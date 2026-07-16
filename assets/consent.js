// assets/consent.js — Consentement cookies (CNIL) + chargement conditionnel du pixel Meta
//
// Le pixel Meta ne se charge QUE si le visiteur a cliqué "Accepter".
// Le choix est mémorisé 6 mois (recommandation CNIL) dans localStorage.
// Les appels fbq(...) dans les pages sont tous gardés par
// `typeof fbq === "function"` : sans consentement, ils sont ignorés sans erreur.
//
// Pour retirer son consentement : lien dans les mentions légales
// (appelle window.a5eRetirerConsentement()).

(function () {
  var PIXEL_ID = "3230732657316523";
  var CLE = "a5e_consent_meta";           // "oui" | "non"
  var CLE_DATE = "a5e_consent_date";      // horodatage du choix
  var VALIDITE_MS = 182 * 24 * 60 * 60 * 1000; // ~6 mois

  function lireChoix() {
    try {
      var choix = localStorage.getItem(CLE);
      var quand = parseInt(localStorage.getItem(CLE_DATE) || "0", 10);
      if (!choix) return null;
      if (Date.now() - quand > VALIDITE_MS) return null; // choix expiré → redemander
      return choix;
    } catch (e) { return null; }
  }

  function memoriser(choix) {
    try {
      localStorage.setItem(CLE, choix);
      localStorage.setItem(CLE_DATE, String(Date.now()));
    } catch (e) {}
  }

  function chargerPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  // Exposé pour les mentions légales : retirer/changer son choix
  window.a5eRetirerConsentement = function () {
    try {
      localStorage.removeItem(CLE);
      localStorage.removeItem(CLE_DATE);
    } catch (e) {}
    location.reload();
  };

  function afficherBanniere() {
    var b = document.createElement("div");
    b.id = "a5e-consent";
    b.setAttribute("role", "dialog");
    b.setAttribute("aria-label", "Consentement aux cookies");
    b.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#1B2A4A;color:#FFFFFF;" +
      "padding:16px 20px;font-family:Archivo,system-ui,sans-serif;font-size:14px;line-height:1.5;" +
      "box-shadow:0 -4px 18px rgba(0,0,0,.25)";
    b.innerHTML =
      '<div style="max-width:1040px;margin:0 auto;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between">' +
        '<div style="flex:1 1 320px;min-width:260px">' +
          'Nous utilisons un cookie de mesure publicitaire (Meta) pour savoir si nos annonces sont utiles. ' +
          'Aucun autre traceur. ' +
          '<a href="/mentions-legales.html" style="color:#F5B301;font-weight:700">En savoir plus</a>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button id="a5e-refuser" type="button" style="background:transparent;color:#FFFFFF;border:2px solid #FFFFFF;' +
            'padding:10px 18px;font-weight:700;font-family:inherit;font-size:14px;cursor:pointer">Refuser</button>' +
          '<button id="a5e-accepter" type="button" style="background:#F5B301;color:#1B2A4A;border:2px solid #F5B301;' +
            'padding:10px 18px;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer">Accepter</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(b);

    document.getElementById("a5e-accepter").addEventListener("click", function () {
      memoriser("oui");
      b.remove();
      chargerPixel();
    });
    document.getElementById("a5e-refuser").addEventListener("click", function () {
      memoriser("non");
      b.remove();
    });
  }

  var choix = lireChoix();
  if (choix === "oui") {
    chargerPixel();
  } else if (choix === null) {
    if (document.body) afficherBanniere();
    else document.addEventListener("DOMContentLoaded", afficherBanniere);
  }
  // choix === "non" → rien : aucun traceur
})();
