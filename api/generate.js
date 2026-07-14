// ============================================================
// API /api/generate — VERSION AVEC LICENCE GUMROAD
//
// Deux publics, deux régimes :
//
//   • VISITEUR GRATUIT (site web, aucune licence)
//     → 3 générations AU TOTAL, définitif.
//
//   • CLIENT PAYANT (extension avec clé de licence valide)
//     → 200 générations / jour. C'est "illimité" en pratique
//       (aucun artisan ne répond à 200 avis par jour), mais ça
//       borne le risque en cas de clé partagée publiquement.
//
// La licence est vérifiée pour de vrai auprès de Gumroad
// (POST https://api.gumroad.com/v2/licenses/verify).
// Une clé remboursée / annulée est automatiquement rejetée.
//
// Le résultat de vérification est mis en cache 6 h en mémoire
// pour ne pas appeler Gumroad à chaque génération (latence + quota).
//
// PROTECTIONS CONSERVÉES :
//   - CORS restreint (site + extension uniquement)
//   - Blocage des User-Agents de scripts (curl, python…)
//   - Plafond global journalier = filet de sécurité facture
//
// VARIABLES D'ENVIRONNEMENT REQUISES (Vercel) :
//   ANTHROPIC_API_KEY   (déjà configurée)
//   GUMROAD_PRODUCT_ID  (à ajouter — voir GUIDE-LICENCE.md)
// ============================================================

// ---------- Configuration ----------
const LIMITE_GRATUIT = 3;          // visiteur web : 3 générations, DÉFINITIF
const LIMITE_CLIENT_JOUR = 200;    // client licencié : par jour, par clé
const PLAFOND_GLOBAL_JOUR = 1000;  // toutes sources confondues
                                   // (~1 $/jour ≈ 30 $/mois de risque max absolu)

const CACHE_LICENCE_MS = 6 * 60 * 60 * 1000; // revérifier une clé toutes les 6 h

const ORIGINES_AUTORISEES = [
  "https://artisan5etoiles.fr",
  "https://www.artisan5etoiles.fr",
];

// ---------- Compteurs & cache en mémoire ----------
const compteurGratuit = new Map();   // ip -> total (jamais remis à zéro)
const compteurLicence = new Map();   // clé -> { count, jour }
const cacheLicence = new Map();      // clé -> { valide, expire }
let compteurGlobal = { count: 0, jour: "" };

function jourActuel() {
  return new Date().toISOString().slice(0, 10);
}

function verifierQuotaGratuit(ip) {
  const count = compteurGratuit.get(ip) || 0;
  if (count >= LIMITE_GRATUIT) return false;
  compteurGratuit.set(ip, count + 1);
  return true;
}

function verifierQuotaLicence(cle) {
  const jour = jourActuel();
  const info = compteurLicence.get(cle);
  if (!info || info.jour !== jour) {
    compteurLicence.set(cle, { count: 1, jour });
    return true;
  }
  if (info.count >= LIMITE_CLIENT_JOUR) return false;
  info.count++;
  return true;
}

function verifierPlafondGlobal() {
  const jour = jourActuel();
  if (compteurGlobal.jour !== jour) compteurGlobal = { count: 0, jour };
  if (compteurGlobal.count >= PLAFOND_GLOBAL_JOUR) return false;
  compteurGlobal.count++;
  return true;
}

// ---------- Vérification de licence auprès de Gumroad ----------
async function licenceValide(cle) {
  const maintenant = Date.now();

  // Cache : évite d'appeler Gumroad à chaque génération
  const cache = cacheLicence.get(cle);
  if (cache && cache.expire > maintenant) {
    return cache.valide;
  }

  const productId = process.env.GUMROAD_PRODUCT_ID;
  if (!productId) {
    console.error("GUMROAD_PRODUCT_ID non configuré dans Vercel");
    return false;
  }

  try {
    const body = new URLSearchParams();
    body.append("product_id", productId);
    body.append("license_key", cle);
    // increment_uses_count = false : on ne gonfle pas le compteur Gumroad
    // à chaque génération. On gère nos propres quotas ici.
    body.append("increment_uses_count", "false");

    const r = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      body,
    });
    const data = await r.json();

    const achat = data.purchase || {};
    const valide =
      r.ok &&
      data.success === true &&
      !achat.refunded &&
      !achat.chargebacked &&
      !achat.disputed;

    cacheLicence.set(cle, { valide, expire: maintenant + CACHE_LICENCE_MS });
    return valide;
  } catch (e) {
    console.error("Erreur vérification Gumroad:", e);
    // Panne Gumroad : on ne punit pas un client déjà vérifié récemment,
    // mais on n'accorde rien à une clé jamais vue.
    return cache ? cache.valide : false;
  }
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

// ---------- Handler ----------
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

  const ua = (req.headers["user-agent"] || "").toLowerCase();
  if (!ua || /curl|wget|python|httpie|postman|go-http|node-fetch|axios/.test(ua)) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }

  // Filet de sécurité facture, appliqué à tout le monde
  if (!verifierPlafondGlobal()) {
    return res.status(429).json({
      error: "Le service a atteint sa capacité du jour. Réessayez demain.",
    });
  }

  const { avis, metier, ville, ton, licence } = req.body || {};

  // ---- Quota : licence valide → généreux ; sinon → gratuit limité ----
  const cle = typeof licence === "string" ? licence.trim() : "";
  let estClient = false;

  if (cle.length >= 8) {
    estClient = await licenceValide(cle);

    if (!estClient) {
      // Une clé a été fournie mais elle est rejetée : on le dit clairement
      return res.status(403).json({
        error:
          "Licence invalide ou expirée. Vérifiez la clé reçue par e-mail après votre achat.",
      });
    }

    if (!verifierQuotaLicence(cle)) {
      return res.status(429).json({
        error:
          "Limite quotidienne atteinte pour cette licence. Réessayez demain, ou écrivez à contact@artisan5etoiles.fr.",
      });
    }
  } else {
    // Aucun clé : régime gratuit
    const ip = extraireIP(req);
    if (!verifierQuotaGratuit(ip)) {
      return res.status(429).json({
        error: `Vous avez utilisé vos ${LIMITE_GRATUIT} générations gratuites. Pour un usage illimité, obtenez le Système complet (extension Chrome + 50 modèles) pour 29 €.`,
      });
    }
  }

  // ---- Validation des entrées ----
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
