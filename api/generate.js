// ============================================================
// API /api/generate — VERSION SÉCURISÉE
// Protections ajoutées :
//   1. CORS restreint (site + extension Chrome uniquement)
//   2. Limite par IP : 3 générations gratuites AU TOTAL (définitif)
//   3. Plafond global : 400 générations / jour (protège la facture)
//   4. Blocage des User-Agents de scripts évidents (curl, python…)
// Aucune dépendance externe : déployable tel quel sur Vercel.
//
// IMPORTANT — limite "définitive" et mémoire serverless :
// Les compteurs sont en mémoire. Vercel redémarre parfois ses
// instances (cold start), ce qui remet les compteurs à zéro côté
// serveur. Pour rendre la limite vraiment tenace, ce fichier
// fonctionne EN TANDEM avec le blocage localStorage ajouté dans
// index.html (le navigateur du visiteur retient lui-même qu'il a
// épuisé ses 3 essais, même si le serveur a oublié).
// Un visiteur très technique peut contourner (navigation privée +
// cold start), mais c'est marginal. Pour un verrou absolu :
// Upstash Redis (gratuit) — à faire si le trafic devient important.
// ============================================================

// ---------- Configuration ----------
const LIMITE_PAR_IP = 3; // 3 générations gratuites par IP, DÉFINITIF (pas de remise à zéro)
const PLAFOND_GLOBAL_JOUR = 400;      // générations max/jour toutes IP confondues
                                      // (400 × ~0,002€ ≈ moins de 1€/jour de risque max)

const ORIGINES_AUTORISEES = [
  "https://artisan5etoiles.fr",
  "https://www.artisan5etoiles.fr",
];

// ---------- Compteurs en mémoire ----------
const compteurIP = new Map(); // ip -> nombre total de générations (jamais remis à zéro)
let compteurGlobal = { count: 0, jour: "" };

function jourActuel() {
  return new Date().toISOString().slice(0, 10); // "2026-07-13"
}

function verifierRateLimitIP(ip) {
  const count = compteurIP.get(ip) || 0;

  if (count >= LIMITE_PAR_IP) {
    return { ok: false };
  }

  compteurIP.set(ip, count + 1);
  return { ok: true };
}

function verifierPlafondGlobal() {
  const jour = jourActuel();
  if (compteurGlobal.jour !== jour) {
    compteurGlobal = { count: 0, jour };
  }
  if (compteurGlobal.count >= PLAFOND_GLOBAL_JOUR) return false;
  compteurGlobal.count++;
  return true;
}

function origineAutorisee(origin) {
  if (!origin) return false;
  if (ORIGINES_AUTORISEES.includes(origin)) return true;
  // L'extension Chrome envoie une origine du type chrome-extension://<id>
  if (origin.startsWith("chrome-extension://")) return true;
  return false;
}

function extraireIP(req) {
  // Vercel place l'IP réelle du visiteur dans x-forwarded-for (première valeur)
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "ip-inconnue";
}

// ---------- Handler principal ----------
export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // --- CORS : uniquement le site et l'extension, plus jamais "*" ---
  if (origineAutorisee(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // --- Refus des appels hors site/extension ---
  // (Un navigateur envoie toujours l'en-tête Origin sur un fetch POST cross-context.
  //  Les scripts curl/python ne l'envoient pas → bloqués ici.)
  if (!origineAutorisee(origin)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }

  // --- Blocage des user-agents de scripts évidents ---
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  if (!ua || /curl|wget|python|httpie|postman|go-http|node-fetch|axios/.test(ua)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }

  // --- Plafond global journalier (protège la facture API) ---
  if (!verifierPlafondGlobal()) {
    return res.status(429).json({
      error: "L'outil a atteint sa capacité du jour. Revenez demain, ou découvrez le Système complet.",
    });
  }

  // --- Limite définitive par IP : 3 générations gratuites, point final ---
  const ip = extraireIP(req);
  const rl = verifierRateLimitIP(ip);
  if (!rl.ok) {
    return res.status(429).json({
      error: `Vous avez utilisé vos ${LIMITE_PAR_IP} générations gratuites. Pour continuer en illimité, obtenez le Système complet (extension Chrome + 50 modèles) pour 29 €.`,
    });
  }

  // --- Validation des entrées (inchangée, avec bornes) ---
  const { avis, metier, ville, ton } = req.body || {};

  if (!avis || typeof avis !== "string" || avis.trim().length < 10) {
    return res.status(400).json({ error: "Avis manquant ou trop court" });
  }
  const avisClean = avis.slice(0, 1500);
  const villeClean = (ville || "").slice(0, 60);
  const metierClean = (metier || "artisan").slice(0, 60);
  const tonClean = ["chaleureux", "professionnel", "bref et direct"].includes(ton)
    ? ton
    : "chaleureux";

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
