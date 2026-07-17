// api/prospection-cron.js
// ============================================================
// AGENT COMMERCIAL A5E — Étape 4 : ENVOI QUOTIDIEN (cron Vercel)
//
// Chaque jour : envoie au maximum PLAFOND_JOUR e-mails de
// prospection depuis le domaine DÉDIÉ (jamais artisan5etoiles.fr),
// en respectant la séquence J0 → J+4 → J+10, la liste
// d'opposition, et un arrêt d'urgence par variable d'env.
//
// GARDE-FOUS :
//   - PROSPECTION_ACTIVE doit valoir "oui" sinon le cron ne fait RIEN
//     (permet de tout stopper en 10 s depuis Vercel sans redéployer)
//   - Plafond dur de 20 envois/jour (délivrabilité)
//   - Un prospect désinscrit n'est JAMAIS recontacté
//   - 3 e-mails maximum par prospect, puis statut "termine"
//
// Variables d'environnement requises (Vercel) :
//   CRON_SECRET            (déjà là — même mécanisme que la sentinelle)
//   KV_REST_API_URL/TOKEN  (déjà là — Upstash)
//   BADGE_SECRET           (déjà là — signe les liens de désinscription)
//   PROSPECTION_ACTIVE     ("oui" pour activer — NOUVEAU)
//   SMTP_HOST              (ex: smtp.ionos.fr — NOUVEAU)
//   SMTP_USER              (ex: mike@VOTRE-DOMAINE-DEDIE.fr — NOUVEAU)
//   SMTP_PASS              (mot de passe de la boîte — NOUVEAU)
//   REPLY_TO               (ex: contact@artisan5etoiles.fr — NOUVEAU)
//
// vercel.json : ajouter { "path": "/api/prospection-cron", "schedule": "30 9 * * 1-5" }
// (9h30 UTC, du lundi au vendredi — on ne prospecte pas le week-end)
// ============================================================

import nodemailer from "nodemailer";
import { createHmac } from "crypto";
import { gabarits } from "../templates/emails-prospection.js";

const PLAFOND_JOUR = 20;                       // NE PAS AUGMENTER avant 2 mois de warm-up
const DELAIS_ETAPES = [0, 4, 10];              // J0, J+4, J+10 (jours entre étapes)
const ENTRE_ENVOIS_MS = 45 * 1000;             // 45 s entre chaque e-mail (comportement humain)

async function redis(...cmd) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  return (await r.json()).result;
}

function lienDesinscription(email) {
  const t = createHmac("sha256", process.env.BADGE_SECRET)
    .update(`optout|${email}`).digest("hex");
  return `https://artisan5etoiles.fr/api/desinscription?e=${encodeURIComponent(email)}&t=${t}`;
}

const joursDepuis = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity;
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  // Auth cron (même mécanisme que sentinel-check)
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  // ARRÊT D'URGENCE : sans ce feu vert explicite, on ne fait rien.
  if (process.env.PROSPECTION_ACTIVE !== "oui") {
    return res.status(200).json({ ok: true, message: "Prospection désactivée (PROSPECTION_ACTIVE ≠ oui)" });
  }
  for (const v of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (!process.env[v]) return res.status(500).json({ error: `Variable ${v} manquante` });
  }
  // Sécurité anti-erreur de config : refus d'envoyer depuis le domaine principal
  if (/artisan5etoiles\.fr$/i.test(process.env.SMTP_USER)) {
    return res.status(500).json({
      error: "SMTP_USER pointe vers artisan5etoiles.fr — interdit. Utilisez le domaine dédié."
    });
  }

  const transporteur = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 465,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const taille = await redis("LLEN", "prospection:file");
  const stats = { examines: 0, envoyes: 0, termines: 0, optouts: 0, pasEncore: 0, erreurs: 0 };
  const budget = Math.min(Number(taille) || 0, 120); // on n'examine pas toute la file à chaque fois

  for (let i = 0; i < budget && stats.envoyes < PLAFOND_JOUR; i++) {
    // Rotation : on prend en tête, on remettra en queue si pas encore dû
    const siret = await redis("LPOP", "prospection:file");
    if (!siret) break;
    stats.examines++;

    try {
      const brut = await redis("GET", `prospection:p:${siret}`);
      if (!brut) continue;
      const p = JSON.parse(brut);

      // Désinscrit entre-temps ? On archive et on ne remet PAS en file.
      const optout = await redis("SISMEMBER", "prospection:optout", p.email);
      if (optout === 1 || p.statut === "optout") {
        p.statut = "optout";
        await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
        stats.optouts++;
        continue;
      }

      // Séquence terminée (3 e-mails envoyés) : on archive.
      if (p.etape >= 3) {
        p.statut = "termine";
        await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
        stats.termines++;
        continue;
      }

      // Pas encore l'heure de l'étape suivante ? Retour en fin de file.
      const delaiRequis = p.etape === 0 ? 0 : DELAIS_ETAPES[p.etape];
      if (p.etape > 0 && joursDepuis(p.dernierEnvoi) < delaiRequis) {
        await redis("RPUSH", "prospection:file", siret);
        stats.pasEncore++;
        continue;
      }

      // ---- ENVOI ----
      const gabarit = gabarits[p.etape](p, lienDesinscription(p.email));
      await transporteur.sendMail({
        from: `"Mike — Artisan 5 Étoiles" <${process.env.SMTP_USER}>`,
        to: p.email,
        replyTo: process.env.REPLY_TO || process.env.SMTP_USER,
        subject: gabarit.objet,
        text: gabarit.texte,
        headers: { "List-Unsubscribe": `<${lienDesinscription(p.email)}>` }
      });

      p.etape += 1;
      p.dernierEnvoi = new Date().toISOString();
      p.statut = p.etape >= 3 ? "termine" : "en_cours";
      await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
      if (p.etape < 3) await redis("RPUSH", "prospection:file", siret);
      stats.envoyes++;
      console.log(`Envoyé étape ${p.etape} → ${p.nom} (${p.ville})`);

      await attendre(ENTRE_ENVOIS_MS);
    } catch (e) {
      console.error(`Erreur prospect ${siret}:`, e.message);
      await redis("RPUSH", "prospection:file", siret); // on réessaiera demain
      stats.erreurs++;
    }
  }

  console.log("Bilan prospection:", JSON.stringify(stats));
  return res.status(200).json({ ok: true, ...stats });
}
