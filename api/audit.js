// api/audit.js — Audit de fiche Google Business pour artisans (v2, auditée)
// Deux actions :
//   POST { action: "search", entreprise, ville }
//     → cherche la fiche Google, renvoie jusqu'à 3 candidats (id, nom, adresse)
//   POST { action: "analyze", placeId, repondAvis, email, metier }
//     → récupère la fiche complète, calcule le score, génère le rapport via Claude,
//       inscrit l'e-mail dans Brevo, renvoie le rapport complet
//
// Variables d'environnement requises (Vercel) :
//   GOOGLE_PLACES_API_KEY  (voir GUIDE-AUDIT.md)
//   ANTHROPIC_API_KEY      (déjà configurée)
//   BREVO_API_KEY          (déjà configurée)
//   BREVO_LIST_ID          (déjà configurée)

// ---------- Quotas anti-abus (en mémoire, comme api/generate.js) ----------
// Audits complets (coût ~0,04 $ Google + Claude) :
const AUDIT_IP_JOUR = 3;        // 3 audits max par IP et par jour
const AUDIT_GLOBAL_JOUR = 100;  // plafond global
// Recherches (coût ~0,032 $ Google) — quota séparé, sinon exposition de coût :
const SEARCH_IP_JOUR = 10;      // marge pour fautes de frappe / plusieurs essais
const SEARCH_GLOBAL_JOUR = 150; // reste dans les 5000 gratuites/mois de Google

const auditIp = new Map();      // ip -> { jour, count }
const searchIp = new Map();
let auditGlobal = { jour: "", count: 0 };
let searchGlobal = { jour: "", count: 0 };

// Cache des fiches déjà récupérées (24 h) : re-audit = pas de double facturation
const cacheFiches = new Map(); // placeId -> { jour, fiche }

function jourActuel() {
  return new Date().toISOString().slice(0, 10);
}
function verifierQuota(map, globalRef, ip, limIp, limGlobal) {
  const jour = jourActuel();
  if (globalRef.jour !== jour) { globalRef.jour = jour; globalRef.count = 0; }
  if (globalRef.count >= limGlobal) return { ok: false, raison: "global" };
  const rec = map.get(ip);
  if (rec && rec.jour === jour && rec.count >= limIp) return { ok: false, raison: "ip" };
  return { ok: true };
}
function consommerQuota(map, globalRef, ip) {
  const jour = jourActuel();
  const rec = map.get(ip);
  if (rec && rec.jour === jour) rec.count += 1;
  else map.set(ip, { jour, count: 1 });
  if (globalRef.jour !== jour) { globalRef.jour = jour; globalRef.count = 0; }
  globalRef.count += 1;
}

// ---------- CORS restreint ----------
const ORIGINES_AUTORISEES = [
  "https://artisan5etoiles.fr",
  "https://www.artisan5etoiles.fr"
];
function appliquerCors(req, res) {
  const origin = req.headers.origin || "";
  if (ORIGINES_AUTORISEES.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------- Google Places API (New) ----------
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

async function rechercherFiche(entreprise, ville) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY,
      // Field mask minimal (tier Pro) : juste de quoi confirmer la fiche
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress"
    },
    body: JSON.stringify({
      textQuery: `${entreprise} ${ville}`,
      languageCode: "fr",
      regionCode: "FR",
      pageSize: 3
    })
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("Places searchText:", r.status, t);
    throw new Error("La recherche Google a échoué. Réessayez dans un instant.");
  }
  const data = await r.json();
  return (data.places || []).map(p => ({
    placeId: p.id,
    nom: p.displayName?.text || "",
    adresse: p.formattedAddress || ""
  }));
}

async function recupererFiche(placeId) {
  // Cache 24 h : évite de payer deux fois la même fiche
  const enCache = cacheFiches.get(placeId);
  if (enCache && enCache.jour === jourActuel()) return { fiche: enCache.fiche, depuisCache: true };

  const champs = [
    "id", "displayName", "formattedAddress",
    "rating", "userRatingCount", "reviews",
    "photos", "websiteUri", "nationalPhoneNumber", "regularOpeningHours"
  ].join(",");
  const r = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`,
    {
      headers: {
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": champs
      }
    }
  );
  if (!r.ok) {
    const t = await r.text();
    console.error("Places details:", r.status, t);
    throw new Error("Impossible de récupérer la fiche. Réessayez dans un instant.");
  }
  const fiche = await r.json();
  cacheFiches.set(placeId, { jour: jourActuel(), fiche });
  return { fiche, depuisCache: false };
}

// ---------- Calcul du score (déterministe, côté serveur) ----------
function calculerScore(fiche, repondAvis) {
  const note = fiche.rating || 0;
  const nbAvis = fiche.userRatingCount || 0;
  const nbPhotos = (fiche.photos || []).length; // l'API en renvoie 10 max
  const aSite = !!fiche.websiteUri;
  const aTel = !!fiche.nationalPhoneNumber;
  const aHoraires = !!(fiche.regularOpeningHours && fiche.regularOpeningHours.periods && fiche.regularOpeningHours.periods.length);

  let pNote = 0;
  if (note >= 4.8) pNote = 25; else if (note >= 4.5) pNote = 22;
  else if (note >= 4.0) pNote = 18; else if (note >= 3.5) pNote = 12;
  else if (note >= 3.0) pNote = 6; else if (note > 0) pNote = 2;

  let pVolume = 0;
  if (nbAvis >= 100) pVolume = 25; else if (nbAvis >= 50) pVolume = 21;
  else if (nbAvis >= 25) pVolume = 17; else if (nbAvis >= 10) pVolume = 12;
  else if (nbAvis >= 5) pVolume = 7; else if (nbAvis >= 1) pVolume = 3;

  let pPhotos = 0;
  if (nbPhotos >= 10) pPhotos = 10; else if (nbPhotos >= 5) pPhotos = 7;
  else if (nbPhotos >= 1) pPhotos = 4;

  const pSite = aSite ? 10 : 0;
  const pTel = aTel ? 5 : 0;
  const pHoraires = aHoraires ? 10 : 0;

  let pReponses = 0;
  if (repondAvis === "toujours") pReponses = 15;
  else if (repondAvis === "parfois") pReponses = 7;

  const total = pNote + pVolume + pPhotos + pSite + pTel + pHoraires + pReponses;

  return {
    total,
    brut: { note, nbAvis, nbPhotos, aSite, aTel, aHoraires, pReponses },
    details: [
      { critere: "Note moyenne", points: pNote, max: 25, valeur: note ? note.toFixed(1) + " ★" : "aucune note" },
      { critere: "Nombre d'avis", points: pVolume, max: 25, valeur: String(nbAvis) },
      { critere: "Réponses aux avis", points: pReponses, max: 15, valeur: repondAvis === "toujours" ? "systématiques" : repondAvis === "parfois" ? "occasionnelles" : "aucune" },
      { critere: "Photos", points: pPhotos, max: 10, valeur: nbPhotos >= 10 ? "10 et plus" : String(nbPhotos) },
      { critere: "Site web renseigné", points: pSite, max: 10, valeur: aSite ? "oui" : "non" },
      { critere: "Horaires renseignés", points: pHoraires, max: 10, valeur: aHoraires ? "oui" : "non" },
      { critere: "Téléphone renseigné", points: pTel, max: 5, valeur: aTel ? "oui" : "non" }
    ]
  };
}

// ---------- Extraction JSON robuste ----------
function extraireJson(texte) {
  const propre = texte.replace(/```json|```/g, "").trim();
  try { return JSON.parse(propre); } catch (e) {}
  const debut = propre.indexOf("{"), fin = propre.lastIndexOf("}");
  if (debut !== -1 && fin > debut) {
    try { return JSON.parse(propre.slice(debut, fin + 1)); } catch (e) {}
  }
  return null;
}

// ---------- Rapport de secours (si la génération Claude échoue) ----------
// L'utilisateur a donné son e-mail et on a payé Google : il DOIT recevoir un audit.
function rapportSecours(score, repondAvis) {
  const b = score.brut;
  const priorites = [];
  if (repondAvis !== "toujours") priorites.push({
    titre: "Répondre à chaque avis, bon ou mauvais",
    detail: "C'est le critère le plus visible pour vos futurs clients et un signal d'activité que Google récompense dans le classement local. Visez une réponse sous 72 h pour chaque avis."
  });
  if (b.nbAvis < 25) priorites.push({
    titre: "Collecter plus d'avis clients",
    detail: "Demandez un avis en fin de chantier, par SMS ou QR code. Un volume d'avis plus élevé rassure et améliore votre visibilité locale."
  });
  if (!b.aSite) priorites.push({
    titre: "Renseigner votre site web sur la fiche",
    detail: "Une fiche sans site paraît moins établie et vous prive de clics. Même une page simple fait la différence."
  });
  if (!b.aHoraires) priorites.push({
    titre: "Renseigner vos horaires",
    detail: "Les fiches sans horaires perdent des appels : beaucoup de clients écartent une entreprise dont ils ne savent pas si elle est ouverte."
  });
  if (b.nbPhotos < 5) priorites.push({
    titre: "Ajouter des photos de vos réalisations",
    detail: "Des photos avant/après de chantiers réels inspirent confiance et augmentent les contacts depuis la fiche."
  });
  return {
    diagnostic: `Votre fiche obtient ${score.total}/100. Les points d'amélioration ci-dessous sont classés par impact : en les traitant dans l'ordre, vous améliorez à la fois la confiance des clients qui vous découvrent et votre position dans les résultats locaux.`,
    priorites: priorites.slice(0, 4),
    exempleReponse: null
  };
}

// ---------- Génération du diagnostic par Claude ----------
async function genererRapport(fiche, score, repondAvis, metier) {
  const avis = (fiche.reviews || []).map(r => ({
    note: r.rating,
    date: r.relativePublishTimeDescription || "",
    texte: (r.text && r.text.text ? r.text.text : "").slice(0, 500)
  }));

  // L'avis le plus utile pour l'exemple : le plus critique, sinon rien
  const avisCible = avis.filter(a => a.texte).sort((a, b) => a.note - b.note)[0] || null;

  const prompt = `Tu es un consultant en réputation en ligne spécialisé dans les artisans français.
Voici les données réelles de la fiche Google Business d'un artisan :

Nom : ${fiche.displayName?.text || "?"}
Métier déclaré : ${metier || "artisan"}
Note : ${fiche.rating || "aucune"} (${fiche.userRatingCount || 0} avis)
Photos : ${(fiche.photos || []).length}${(fiche.photos || []).length >= 10 ? " ou plus" : ""}
Site web : ${fiche.websiteUri ? "renseigné" : "absent"}
Horaires : ${fiche.regularOpeningHours ? "renseignés" : "absents"}
Répond aux avis : ${repondAvis === "toujours" ? "systématiquement" : repondAvis === "parfois" ? "parfois" : "jamais"}
Score calculé : ${score.total}/100

Derniers avis (max 5) :
${avis.length ? avis.map(a => `- ${a.note}★ (${a.date}) : "${a.texte}"`).join("\n") : "aucun avis textuel"}

${avisCible ? `Avis à traiter en exemple : ${avisCible.note}★ : "${avisCible.texte}"` : ""}

Réponds UNIQUEMENT avec un objet JSON valide, sans backticks, sans texte autour, au format exact :
{
  "diagnostic": "2 à 3 phrases directes en vouvoiement qui résument l'état de la fiche et l'impact concret sur les clients perdus ou gagnés. Ton factuel, pas alarmiste, pas de flatterie.",
  "priorites": [
    { "titre": "titre court de l'action", "detail": "1 à 2 phrases concrètes expliquant quoi faire et pourquoi ça compte" }
  ],
  "exempleReponse": ${avisCible ? `"une réponse professionnelle, chaleureuse et concrète à l'avis cité en exemple, signée du nom de l'entreprise, 3 à 5 phrases, en français"` : "null"}
}

Règles pour "priorites" : 3 à 4 actions maximum, classées par impact, adaptées aux données réelles ci-dessus (ne recommande pas d'ajouter des photos s'il y en a déjà 10). Si l'artisan ne répond pas ou peu aux avis, la réponse aux avis doit être la priorité n°1.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) {
      console.error("Anthropic:", r.status, await r.text());
      return rapportSecours(score, repondAvis);
    }
    const data = await r.json();
    const texte = (data.content || []).map(c => c.text || "").join("").trim();
    const rapport = extraireJson(texte);
    if (!rapport || !rapport.diagnostic || !Array.isArray(rapport.priorites)) {
      console.error("Rapport Claude invalide, bascule sur le rapport de secours");
      return rapportSecours(score, repondAvis);
    }
    return rapport;
  } catch (e) {
    console.error("genererRapport:", e.message);
    return rapportSecours(score, repondAvis);
  }
}

// ---------- Inscription Brevo ----------
async function inscrireBrevo(email, metier) {
  try {
    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        email,
        attributes: { METIER: metier || "", SOURCE: "audit" },
        listIds: [parseInt(process.env.BREVO_LIST_ID, 10)],
        updateEnabled: true
      })
    });
    if (!r.ok && r.status !== 204) {
      console.error("Brevo:", r.status, await r.text());
    }
  } catch (e) {
    // L'inscription Brevo ne doit jamais faire échouer l'audit
    console.error("Brevo exception:", e.message);
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  appliquerCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  // Mêmes protections que api/generate.js : cet endpoint coûte de l'argent
  // (Google Places) à chaque appel, le CORS seul ne bloque pas curl & co.
  const origin = req.headers.origin || "";
  if (!ORIGINES_AUTORISEES.includes(origin)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  if (!ua || /curl|wget|python|httpie|postman|go-http|node-fetch|axios/.test(ua)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }

  if (!PLACES_KEY) {
    return res.status(500).json({ error: "Clé Google Places manquante côté serveur." });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "inconnue";
  const { action } = req.body || {};

  try {
    // -------- Action 1 : recherche de la fiche --------
    if (action === "search") {
      const entreprise = String(req.body.entreprise || "").trim().slice(0, 120);
      const ville = String(req.body.ville || "").trim().slice(0, 80);
      if (entreprise.length < 2 || ville.length < 2) {
        return res.status(400).json({ error: "Indiquez le nom de votre entreprise et votre ville." });
      }
      const q = verifierQuota(searchIp, searchGlobal, ip, SEARCH_IP_JOUR, SEARCH_GLOBAL_JOUR);
      if (!q.ok) {
        return res.status(429).json({
          error: q.raison === "ip"
            ? "Trop de recherches aujourd'hui depuis votre connexion. Revenez demain !"
            : "Le service d'audit est très demandé aujourd'hui. Revenez demain !"
        });
      }
      consommerQuota(searchIp, searchGlobal, ip);

      const candidats = await rechercherFiche(entreprise, ville);
      if (!candidats.length) {
        return res.status(404).json({ error: "Aucune fiche Google trouvée. Vérifiez l'orthographe du nom et de la ville." });
      }
      return res.status(200).json({ candidats });
    }

    // -------- Action 2 : audit complet --------
    if (action === "analyze") {
      const placeId = String(req.body.placeId || "").trim();
      const repondAvis = ["toujours", "parfois", "jamais"].includes(req.body.repondAvis) ? req.body.repondAvis : "jamais";
      const email = String(req.body.email || "").trim().toLowerCase();
      const metier = String(req.body.metier || "").trim().slice(0, 60);

      if (!placeId) return res.status(400).json({ error: "Fiche non sélectionnée." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return res.status(400).json({ error: "Adresse e-mail invalide." });
      }

      const q = verifierQuota(auditIp, auditGlobal, ip, AUDIT_IP_JOUR, AUDIT_GLOBAL_JOUR);
      if (!q.ok) {
        return res.status(429).json({
          error: q.raison === "ip"
            ? "Vous avez atteint la limite de 3 audits gratuits par jour."
            : "Le service d'audit est très demandé aujourd'hui. Revenez demain !"
        });
      }

      // On récupère la fiche D'ABORD : si Google échoue, l'utilisateur ne perd pas son quota
      const { fiche } = await recupererFiche(placeId);
      consommerQuota(auditIp, auditGlobal, ip);

      const score = calculerScore(fiche, repondAvis);
      const rapport = await genererRapport(fiche, score, repondAvis, metier);

      // Awaité : sur Vercel, une promesse non attendue peut être tuée au retour de la réponse
      await inscrireBrevo(email, metier);

      return res.status(200).json({
        fiche: {
          nom: fiche.displayName?.text || "",
          adresse: fiche.formattedAddress || "",
          note: fiche.rating || 0,
          nbAvis: fiche.userRatingCount || 0
        },
        score: { total: score.total, details: score.details },
        rapport
      });
    }

    return res.status(400).json({ error: "Action inconnue." });
  } catch (e) {
    console.error("audit.js:", e);
    return res.status(500).json({ error: e.message || "Une erreur est survenue. Réessayez dans un instant." });
  }
}
