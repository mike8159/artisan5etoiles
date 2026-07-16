// api/sentinel-check.js — Vérification périodique des fiches surveillées (cron)
//
// Appelé chaque jour par Vercel Cron (voir vercel.json + GUIDE-SENTINELLE.md).
// Chaque fiche est vérifiée au maximum une fois par semaine : le cron quotidien
// ne traite que celles qui sont "dues", ce qui étale la charge et borne le coût.
//
// Détection : comparaison du nombre d'avis (userRatingCount) avec le dernier
// compte enregistré. Si ça a augmenté → e-mail d'alerte Brevo avec lien vers
// le générateur de réponses (c'est le moment de conversion parfait).
//
// Coût par vérification : ~0,035 $ (SKU Place Details Enterprise), en pratique
// gratuit sous ~1000 vérifications/mois grâce au palier gratuit du SKU.
// 30 sentinelles × ~4,3 vérifications/mois ≈ 130 appels/mois → gratuit.
//
// Variables d'environnement requises (Vercel) :
//   CRON_SECRET            (nouvelle — Vercel l'envoie automatiquement en header)
//   GOOGLE_PLACES_API_KEY  (déjà configurée)
//   BREVO_API_KEY          (déjà configurée)
//   + intégration Redis Upstash (KV_REST_API_URL / KV_REST_API_TOKEN)

const INTERVALLE_JOURS = 7;      // vérification hebdomadaire par fiche
const MAX_PAR_EXECUTION = 10;    // borne le travail d'un run (timeout Vercel Hobby)
const BUDGET_MS = 8000;          // marge sous le timeout de la fonction

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
  if (!r.ok) throw new Error(`Redis ${args[0]}: ${r.status} ${await r.text()}`);
  return (await r.json()).result;
}

function joursDepuis(dateIso) {
  const alors = new Date(dateIso + "T00:00:00Z").getTime();
  if (Number.isNaN(alors)) return Infinity; // date corrompue → considérer comme dû
  return (Date.now() - alors) / 86400000;
}

async function compterAvis(placeId) {
  // Field mask minimal : userRatingCount + rating (tous deux SKU Enterprise,
  // en ajouter un ne change pas le palier — PAS de reviews, qui coûterait plus)
  const r = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "userRatingCount,rating"
      }
    }
  );
  if (!r.ok) throw new Error(`Places: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return { compte: data.userRatingCount || 0, note: data.rating || 0 };
}

async function envoyerAlerte({ email, nom, nouveaux, total, note }) {
  const pluriel = nouveaux > 1;
  const sujet = `⭐ ${nouveaux} ${pluriel ? "nouveaux avis Google" : "nouvel avis Google"} pour ${nom}`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#22262B">
  <div style="background:#1B2A4A;padding:22px 26px">
    <span style="color:#FFFFFF;font-weight:800;font-size:16px">ARTISAN <span style="color:#F5B301">5 ÉTOILES</span></span>
  </div>
  <div style="padding:26px;background:#F6F4EF;border:2px solid #1B2A4A;border-top:0">
    <h1 style="font-size:19px;color:#1B2A4A;margin:0 0 14px">Vous avez ${nouveaux} ${pluriel ? "nouveaux avis" : "nouvel avis"} sur Google</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 8px">
      Notre surveillance a détecté ${pluriel ? "de nouveaux avis" : "un nouvel avis"} sur la fiche
      <b>${nom}</b>. Votre fiche compte désormais <b>${total} avis</b>${note ? ` (note actuelle : <b>${note.toFixed(1)} ★</b>)` : ""}.
    </p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px">
      Répondre vite — surtout aux avis négatifs — protège votre réputation et envoie
      un signal d'activité que Google récompense. Votre réponse est prête en 10 secondes :
    </p>
    <div style="text-align:center;margin:0 0 20px">
      <a href="https://artisan5etoiles.fr/#outil"
         style="display:inline-block;background:#F5B301;color:#1B2A4A;font-weight:800;font-size:15px;
                text-decoration:none;padding:14px 24px;border:2px solid #1B2A4A">
        GÉNÉRER MA RÉPONSE
      </a>
    </div>
    <p style="font-size:12.5px;color:#5C6470;line-height:1.5;margin:0">
      Vous recevez cette alerte car vous avez activé la surveillance gratuite lors de votre
      audit sur artisan5etoiles.fr. Pour la désactiver, répondez simplement à cet e-mail.
    </p>
  </div>
</div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: "Artisan 5 Étoiles", email: "contact@artisan5etoiles.fr" },
      to: [{ email }],
      subject: sujet,
      htmlContent: html
    })
  });
  if (!r.ok) throw new Error(`Brevo: ${r.status} ${await r.text()}`);
}

export default async function handler(req, res) {
  // Sécurité : seul Vercel Cron (ou toi avec le secret) peut déclencher.
  // Vercel envoie automatiquement "Authorization: Bearer CRON_SECRET".
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (!redisUrl() || !redisToken() || !process.env.GOOGLE_PLACES_API_KEY || !process.env.BREVO_API_KEY) {
    return res.status(500).json({ error: "Configuration incomplète" });
  }

  const debut = Date.now();
  const bilan = { examinees: 0, verifiees: 0, alertes: 0, erreurs: 0 };

  try {
    const placeIds = (await redisCmd("SMEMBERS", "sentinelles:liste")) || [];

    for (const placeId of placeIds) {
      if (bilan.verifiees >= MAX_PAR_EXECUTION || Date.now() - debut > BUDGET_MS) break;
      bilan.examinees++;

      try {
        const brut = await redisCmd("GET", `sentinelle:${placeId}`);
        if (!brut) { // enregistrement orphelin → nettoyage
          await redisCmd("SREM", "sentinelles:liste", placeId);
          continue;
        }
        const rec = JSON.parse(brut);
        if (joursDepuis(rec.dernierCheck) < INTERVALLE_JOURS) continue; // pas encore dû

        const { compte, note } = await compterAvis(placeId);
        bilan.verifiees++;

        const nouveaux = compte - (rec.dernierCompte || 0);
        if (nouveaux > 0 && rec.email) {
          await envoyerAlerte({
            email: rec.email,
            nom: rec.nom || "votre entreprise",
            nouveaux,
            total: compte,
            note
          });
          bilan.alertes++;
        }

        rec.dernierCompte = compte;
        rec.dernierCheck = new Date().toISOString().slice(0, 10);
        await redisCmd("SET", `sentinelle:${placeId}`, JSON.stringify(rec));
      } catch (e) {
        // Une fiche en erreur ne doit jamais bloquer les autres
        console.error(`sentinel-check [${placeId}]:`, e.message);
        bilan.erreurs++;
      }
    }

    return res.status(200).json(bilan);
  } catch (e) {
    console.error("sentinel-check:", e);
    return res.status(500).json({ error: e.message, bilan });
  }
}
