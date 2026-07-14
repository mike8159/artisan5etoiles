// ============================================================
// API /api/verify-license — Vérifie une clé de licence Gumroad
//
// Appelé quand un client entre sa clé dans l'extension ("Activer").
// Vérifie la clé auprès de Gumroad et confirme qu'elle correspond
// bien à un achat réel du produit.
//
// PRÉREQUIS (voir GUIDE-LICENCE.md) :
//   1. Sur Gumroad, activer "Generate a unique license key per sale"
//      dans les réglages du produit
//   2. Copier le "Product ID" affiché à cet endroit
//   3. Dans Vercel > Settings > Environment Variables, ajouter :
//        GUMROAD_PRODUCT_ID = <le product id>
// ============================================================

const ORIGINES_AUTORISEES = [
  "https://artisan5etoiles.fr",
  "https://www.artisan5etoiles.fr",
];

// Anti-brute-force : limite les tentatives d'activation par IP
const MAX_TENTATIVES_PAR_HEURE = 10;
const tentatives = new Map(); // ip -> { count, resetAt }

function origineAutorisee(origin) {
  if (!origin) return false;
  if (ORIGINES_AUTORISEES.includes(origin)) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return false;
}

function extraireIP(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "ip-inconnue";
}

function tropDeTentatives(ip) {
  const maintenant = Date.now();
  const info = tentatives.get(ip);
  if (!info || info.resetAt < maintenant) {
    tentatives.set(ip, { count: 1, resetAt: maintenant + 60 * 60 * 1000 });
    return false;
  }
  if (info.count >= MAX_TENTATIVES_PAR_HEURE) return true;
  info.count++;
  return false;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  if (origineAutorisee(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  if (!origineAutorisee(origin)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }

  const ip = extraireIP(req);
  if (tropDeTentatives(ip)) {
    return res.status(429).json({
      error: "Trop de tentatives d'activation. Réessayez dans une heure.",
    });
  }

  const { licence } = req.body || {};

  if (!licence || typeof licence !== "string" || licence.trim().length < 8) {
    return res.status(400).json({ error: "Clé de licence manquante ou invalide." });
  }

  const productId = process.env.GUMROAD_PRODUCT_ID;
  if (!productId) {
    console.error("GUMROAD_PRODUCT_ID non configuré dans Vercel");
    return res.status(500).json({ error: "Configuration serveur incomplète." });
  }

  try {
    const body = new URLSearchParams();
    body.append("product_id", productId);
    body.append("license_key", licence.trim());
    // increment_uses_count = false : on ne veut PAS gonfler le compteur Gumroad
    // à chaque vérification. On gère nos propres quotas côté serveur.
    body.append("increment_uses_count", "false");

    const r = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      body,
    });

    const data = await r.json();

    if (!r.ok || !data.success) {
      return res.status(403).json({
        error: "Clé de licence invalide. Vérifiez la clé reçue dans votre e-mail Gumroad.",
      });
    }

    // Achat remboursé, annulé ou contesté → licence révoquée
    const achat = data.purchase || {};
    if (achat.refunded || achat.chargebacked || achat.disputed) {
      return res.status(403).json({
        error: "Cette licence n'est plus active (achat remboursé ou annulé).",
      });
    }

    return res.status(200).json({
      ok: true,
      email: achat.email || null,
    });
  } catch (e) {
    console.error("Erreur vérification Gumroad:", e);
    return res.status(502).json({ error: "Vérification indisponible. Réessayez dans un instant." });
  }
}
