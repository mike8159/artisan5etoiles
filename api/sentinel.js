// api/sentinel.js — Inscription à la sentinelle de veille d'avis
//
// POST { placeId, nom, email, metier, currentCount, token }
//   → le "token" est émis par api/audit.js à la fin d'un audit réel (HMAC),
//     ce qui empêche de créer des sentinelles sans passer par l'audit
//     (donc sans passer par ses quotas et son coût contrôlé).
//
// Le stockage se fait dans Upstash Redis (intégration Vercel Marketplace),
// via son API REST — aucune librairie npm nécessaire.
//
// Variables d'environnement requises (Vercel) :
//   BADGE_SECRET  (déjà configurée — réutilisée pour signer le jeton d'audit)
//   Une intégration Redis (Upstash) installée sur le projet, qui injecte
//   automatiquement KV_REST_API_URL / KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL /
//   UPSTASH_REDIS_REST_TOKEN selon la version de l'intégration) — voir GUIDE-SENTINELLE.md

import { createHmac, timingSafeEqual } from "crypto";

const MAX_SENTINELLES = 30; // plafond dur : borne le coût mensuel maximum (~5 €/mois à ce niveau)

const ORIGINES_AUTORISEES = [
  "https://artisan5etoiles.fr",
  "https://www.artisan5etoiles.fr"
];

// ---------- Upstash Redis via REST (pas de dépendance npm) ----------
function redisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
}
function redisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
}
async function redisCmd(...args) {
  const r = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Redis ${args[0]} a échoué: ${r.status} ${t}`);
  }
  const data = await r.json();
  return data.result;
}

function jetonValide(placeId, email, token) {
  try {
    const attendu = Buffer.from(
      createHmac("sha256", process.env.BADGE_SECRET).update(`sentinel|${placeId}|${email}`).digest("hex"),
      "hex"
    );
    const recu = Buffer.from(String(token || ""), "hex");
    if (attendu.length !== recu.length || recu.length === 0) return false;
    return timingSafeEqual(attendu, recu);
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (ORIGINES_AUTORISEES.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  if (!ORIGINES_AUTORISEES.includes(origin)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  if (!ua || /curl|wget|python|httpie|postman|go-http|node-fetch|axios/.test(ua)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }

  if (!process.env.BADGE_SECRET) {
    return res.status(500).json({ error: "Service de surveillance non configuré." });
  }
  if (!redisUrl() || !redisToken()) {
    return res.status(500).json({ error: "Stockage non configuré côté serveur." });
  }

  const placeId = String(req.body?.placeId || "").trim();
  const nom = String(req.body?.nom || "").slice(0, 80).trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const metier = String(req.body?.metier || "").slice(0, 60).trim();
  const currentCount = parseInt(req.body?.currentCount, 10);
  const token = req.body?.token;

  if (!placeId || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Requête invalide." });
  }
  if (!jetonValide(placeId, email, token)) {
    return res.status(403).json({ error: "Vérification impossible. Relancez un audit puis réessayez." });
  }

  try {
    const cle = `sentinelle:${placeId}`;
    const dejaInscrit = await redisCmd("SISMEMBER", "sentinelles:liste", placeId);

    if (!dejaInscrit) {
      const total = await redisCmd("SCARD", "sentinelles:liste");
      if (total >= MAX_SENTINELLES) {
        return res.status(429).json({
          error: "La surveillance gratuite est actuellement complète. Écrivez à contact@artisan5etoiles.fr pour être prévenu quand une place se libère."
        });
      }
    }

    const enregistrement = {
      nom,
      email,
      metier,
      dernierCompte: Number.isInteger(currentCount) ? currentCount : 0,
      dernierCheck: new Date().toISOString().slice(0, 10),
      creeLe: new Date().toISOString().slice(0, 10)
    };

    await redisCmd("SET", cle, JSON.stringify(enregistrement));
    await redisCmd("SADD", "sentinelles:liste", placeId);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("sentinel.js:", e);
    return res.status(500).json({ error: "Impossible d'activer la surveillance pour le moment." });
  }
}
