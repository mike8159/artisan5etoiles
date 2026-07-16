// api/badge.js — Badge SVG partageable "Score X/100" (signé HMAC)
//
// GET /api/badge?n=<nom>&s=<score>&d=<AAAA-MM-JJ>&t=<signature hex>
//
// La signature est émise par api/audit.js à la fin d'un audit réel :
//   HMAC-SHA256(BADGE_SECRET, `${nom}|${score}|${date}`)
// → falsification impossible sans le secret, et AUCUN appel Google au rendu
//   (coût zéro, cache long).
//
// Variables d'environnement requises (Vercel) :
//   BADGE_SECRET  (déjà configurée)

import { createHmac, timingSafeEqual } from "crypto";

// Échappement XML : le nom vient de Google mais on ne fait JAMAIS confiance
// à une valeur injectée dans du SVG (le SVG est du XML exécuté par le navigateur).
function echapperXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function signatureValide(nom, score, date, token) {
  try {
    const attendu = Buffer.from(
      createHmac("sha256", process.env.BADGE_SECRET)
        .update(`${nom}|${score}|${date}`)
        .digest("hex"),
      "hex"
    );
    const recu = Buffer.from(String(token || ""), "hex");
    if (attendu.length !== recu.length || recu.length === 0) return false;
    return timingSafeEqual(attendu, recu);
  } catch (e) {
    return false;
  }
}

// Nom raccourci pour tenir sur le badge sans déborder
function nomAffiche(nom) {
  return nom.length > 34 ? nom.slice(0, 33).trimEnd() + "…" : nom;
}

function dateFr(iso) {
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

function svgBadge(nom, score, date) {
  // Couleur du score selon le niveau (mêmes seuils que audit.html)
  const couleurScore = score >= 80 ? "#2E7D32" : score >= 60 ? "#F5B301" : score >= 40 ? "#E67E22" : "#C0392B";
  const nomX = echapperXml(nomAffiche(nom));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100" role="img" aria-label="Score de fiche Google : ${score} sur 100">
  <rect width="300" height="100" fill="#F6F4EF"/>
  <rect x="1.5" y="1.5" width="297" height="97" fill="none" stroke="#1B2A4A" stroke-width="3"/>
  <rect x="0" y="0" width="88" height="100" fill="#1B2A4A"/>
  <text x="44" y="46" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="800" fill="${couleurScore}" text-anchor="middle">${score}</text>
  <text x="44" y="66" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="#FFFFFF" text-anchor="middle">/ 100</text>
  <text x="44" y="84" font-family="Arial,Helvetica,sans-serif" font-size="8.5" fill="#C7D0E0" text-anchor="middle">FICHE GOOGLE</text>
  <text x="100" y="30" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="#1B2A4A">${nomX}</text>
  <text x="100" y="50" font-family="Arial,Helvetica,sans-serif" font-size="10.5" fill="#5C6470">Score de fiche Google Business</text>
  <text x="100" y="66" font-family="Arial,Helvetica,sans-serif" font-size="10.5" fill="#5C6470">audité le ${echapperXml(dateFr(date))}</text>
  <text x="100" y="86" font-family="Arial,Helvetica,sans-serif" font-size="9.5" font-weight="700" fill="#1B2A4A">ARTISAN <tspan fill="#B8860B">5 ÉTOILES</tspan> — artisan5etoiles.fr</text>
</svg>`;
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  if (!process.env.BADGE_SECRET) {
    return res.status(500).json({ error: "Badge non configuré côté serveur." });
  }

  // Vercel décode automatiquement les paramètres de query string
  const nom = String(req.query.n || "").slice(0, 60);
  const scoreBrut = String(req.query.s || "");
  const date = String(req.query.d || "");
  const token = String(req.query.t || "");

  // Validation stricte AVANT toute vérification crypto
  const score = parseInt(scoreBrut, 10);
  if (
    !nom ||
    !Number.isInteger(score) || score < 0 || score > 100 || String(score) !== scoreBrut ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^[0-9a-f]{64}$/.test(token)
  ) {
    return res.status(400).send("Paramètres invalides");
  }

  if (!signatureValide(nom, score, date, token)) {
    return res.status(403).send("Signature invalide");
  }

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // Contenu signé et figé à la date de l'audit → cache long sans risque
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(svgBadge(nom, score, date));
}
