// api/desinscription.js
// ============================================================
// AGENT COMMERCIAL A5E — Désinscription en 1 clic (obligation LCEN)
//
// GET /api/desinscription?e=<email>&t=<hmac>
// Le jeton HMAC (signé avec BADGE_SECRET) empêche un tiers de
// désinscrire quelqu'un d'autre en masse ou de sonder des adresses.
// L'e-mail est ajouté au set Redis prospection:optout — qui n'est
// JAMAIS vidé (obligation de conservation de la liste d'opposition).
// ============================================================

import { createHmac, timingSafeEqual } from "crypto";

async function redis(...cmd) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  return (await r.json()).result;
}

function page(titre, message) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>${titre} — Artisan 5 Étoiles</title>
<style>body{font-family:system-ui,sans-serif;background:#F6F4EF;color:#1B2A4A;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.carte{background:#fff;border:3px solid #1B2A4A;box-shadow:8px 8px 0 #F5B301;
padding:36px;max-width:460px;text-align:center}
h1{font-size:22px;margin:0 0 12px}p{font-size:15px;line-height:1.6;color:#444}</style></head>
<body><div class="carte"><h1>${titre}</h1><p>${message}</p></div></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée" });

  const email = String(req.query.e || "").toLowerCase().trim();
  const token = String(req.query.t || "");

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).send(page("Lien invalide",
      "Ce lien de désinscription est incomplet. Répondez simplement « STOP » à l'e-mail reçu et nous vous retirerons manuellement."));
  }

  try {
    const attendu = Buffer.from(
      createHmac("sha256", process.env.BADGE_SECRET).update(`optout|${email}`).digest("hex"), "hex");
    const recu = Buffer.from(token, "hex");
    if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) {
      return res.status(403).send(page("Lien invalide",
        "Ce lien de désinscription n'est pas valide. Répondez « STOP » à l'e-mail reçu et nous vous retirerons manuellement."));
    }

    await redis("SADD", "prospection:optout", email);
    return res.status(200).send(page("C'est fait ✔",
      `L'adresse <strong>${email}</strong> ne recevra plus aucun message de notre part. ` +
      "Merci de votre attention, et bonne continuation dans votre activité."));
  } catch (e) {
    console.error("Désinscription erreur:", e.message);
    return res.status(500).send(page("Erreur temporaire",
      "Impossible d'enregistrer votre demande pour le moment. Répondez « STOP » à l'e-mail reçu : nous vous retirerons manuellement."));
  }
}
