// ============================================================
// API /api/subscribe — Capture d'emails (RGPD-conforme)
// Envoie le contact vers Brevo (gratuit, français, 300 emails/jour)
//
// PRÉREQUIS (voir GUIDE-SYSTEME.md) :
//   1. Créer un compte gratuit sur brevo.com
//   2. Créer une liste, noter son ID (un nombre, ex: 2)
//   3. Générer une clé API (Paramètres > Clés API)
//   4. Dans Vercel : Settings > Environment Variables, ajouter
//        BREVO_API_KEY  = xkeysib-....
//        BREVO_LIST_ID  = 2
//
// Si BREVO_API_KEY n'est pas configurée, l'endpoint accepte quand
// même l'inscription (l'utilisateur voit la page de remerciement)
// mais log l'email dans les logs Vercel — pratique pour démarrer.
// ============================================================

const ORIGINES_AUTORISEES = [
  "https://artisan5etoiles.fr",
  "https://www.artisan5etoiles.fr",
];

// Anti-spam : limite par IP et par JOUR (remise à zéro quotidienne —
// sinon un artisan légitime pouvait rester bloqué tant que l'instance vivait)
const LIMITE_PAR_IP_JOUR = 3;
const compteurIP = new Map(); // ip -> { jour, count }

function jourActuel() {
  return new Date().toISOString().slice(0, 10);
}

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

function emailValide(email) {
  return (
    typeof email === "string" &&
    email.length >= 5 &&
    email.length <= 200 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  );
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

  // Anti-spam basique par IP (quotidien)
  const ip = extraireIP(req);
  const jour = jourActuel();
  const rec = compteurIP.get(ip);
  if (rec && rec.jour === jour && rec.count >= LIMITE_PAR_IP_JOUR) {
    return res.status(429).json({ error: "Trop de tentatives aujourd'hui. Réessayez demain." });
  }
  if (rec && rec.jour === jour) rec.count += 1;
  else compteurIP.set(ip, { jour, count: 1 });

  const { email, metier, consentement } = req.body || {};

  if (!emailValide(email)) {
    return res.status(400).json({ error: "Adresse e-mail invalide." });
  }

  // RGPD : le consentement explicite est obligatoire
  if (consentement !== true) {
    return res.status(400).json({ error: "Merci de cocher la case de consentement." });
  }

  const cle = process.env.BREVO_API_KEY;
  const listeId = parseInt(process.env.BREVO_LIST_ID || "0", 10);

  // Mode démarrage : pas encore de clé Brevo configurée
  if (!cle) {
    console.log("[NOUVEL INSCRIT]", email, "| métier:", metier || "non précisé");
    return res.status(200).json({ ok: true, mode: "log" });
  }

  try {
    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cle,
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        attributes: {
          METIER: (metier || "").slice(0, 60),
          SOURCE: "artisan5etoiles.fr",
        },
        listIds: listeId ? [listeId] : undefined,
        updateEnabled: true, // ne plante pas si l'email existe déjà
      }),
    });

    // Brevo renvoie 400 "duplicate_parameter" si le contact existe déjà :
    // ce cas précis n'est pas une erreur pour l'utilisateur.
    // (Avant : TOUT code 400 était traité comme un succès — une adresse
    // réellement refusée par Brevo passait pour inscrite. Corrigé.)
    if (!r.ok) {
      const detail = await r.text();
      if (detail.includes("duplicate")) {
        console.log("Contact déjà existant ou déjà inscrit:", email);
        return res.status(200).json({ ok: true, mode: "existant" });
      }
      console.error("Brevo error:", r.status, detail);
      if (r.status === 400) {
        return res.status(400).json({ error: "Cette adresse e-mail est refusée. Vérifiez-la ou essayez-en une autre." });
      }
      return res.status(502).json({ error: "Inscription temporairement indisponible." });
    }

    return res.status(200).json({ ok: true, mode: "brevo" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur interne" });
  }
}
