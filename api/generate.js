export default async function handler(req, res) {
  // CORS : autorise le site ET l'extension Chrome à appeler cette API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { avis, metier, ville, ton, source, licenseKey } = req.body || {};

  // L'extension Chrome (produit payant) exige une licence Gumroad valide.
  // Le site web (version gratuite d'essai) reste libre d'accès.
  if (source === "extension") {
    if (!licenseKey || typeof licenseKey !== "string") {
      return res.status(401).json({ error: "LICENCE_REQUISE" });
    }
    try {
      const lv = await fetch("https://api.gumroad.com/v2/licenses/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          product_id: process.env.GUMROAD_PRODUCT_ID || "",
          license_key: licenseKey.trim(),
        }),
      });
      const lvData = await lv.json();
      if (!lvData.success || (lvData.purchase && lvData.purchase.refunded)) {
        return res.status(401).json({ error: "LICENCE_INVALIDE" });
      }
    } catch (e) {
      console.error("Gumroad license check failed:", e);
      return res.status(502).json({ error: "Vérification de licence indisponible" });
    }
  }

  if (!avis || typeof avis !== "string" || avis.trim().length < 10) {
    return res.status(400).json({ error: "Avis manquant ou trop court" });
  }
  const avisClean = avis.slice(0, 1500);
  const villeClean = (ville || "").slice(0, 60);
  const metierClean = (metier || "artisan").slice(0, 60);
  const tonClean = ["chaleureux", "professionnel", "bref et direct"].includes(ton) ? ton : "chaleureux";

  const prompt = `Tu es un expert en e-réputation pour les artisans français.

Rédige une réponse publique à cet avis Google reçu par un(e) ${metierClean}${villeClean ? " à " + villeClean : ""}.

L'avis du client :
"""
${avisClean}
"""

Règles impératives :
- Ton : ${tonClean}.
- En français impeccable, naturel, jamais robotique ni obséquieux.
- Structure : salutation avec le prénom si présent dans l'avis, remerciement, référence concrète à ce que dit l'avis, puis conclusion.
- Si l'avis est négatif : reconnaître calmement ce qui est fondé sans se justifier longuement, proposer une solution concrète et inviter à poursuivre en privé (téléphone/email, sans inventer de coordonnées : écrire [numéro] ou [email]).
- Si l'avis est positif : personnaliser avec un détail cité par le client.
- Mentionner naturellement le métier${villeClean ? " et la ville (" + villeClean + ")" : ""} une seule fois, pour le référencement local. Sans bourrage de mots-clés.
- Longueur : 40 à 90 mots. ${tonClean === "bref et direct" ? "Plutôt 30 à 50 mots." : ""}
- Ne jamais inventer de faits (dates, montants, prestations non mentionnées).
- Terminer par une signature générique : le prénom remplacé par [Prénom], puis [Nom de l'entreprise].

Réponds UNIQUEMENT avec le texte de la réponse, sans guillemets, sans commentaire.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Anthropic API error:", r.status, detail);
      return res.status(502).json({ error: "Service de génération indisponible" });
    }

    const data = await r.json();
    const texte = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!texte) return res.status(502).json({ error: "Réponse vide" });

    return res.status(200).json({ reponse: texte });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur interne" });
  }
}
