// api/prospection-daily.js
// ============================================================
// AGENT COMMERCIAL A5E — ORCHESTRATEUR QUOTIDIEN (LA machine)
//
// UN SEUL cron Vercel, chaque matin. À chaque exécution :
//   1. SOURCING     : avance dans la grille SIRENE (quelques
//                     couples métier×ville par jour, en continu —
//                     la grille se recharge toute seule chaque mois)
//   2. ENRICHISSEMENT: pour un lot de prospects, devine leur site
//                     web, vérifie l'identité, extrait l'e-mail.
//                     Avec e-mail → file d'envoi. Sans → archivé.
//   3. ENVOI        : jusqu'à 20 e-mails/jour ouvré, séquence
//                     J0 → J+4 → J+10 (si PROSPECTION_ACTIVE=oui)
//
// AUCUNE action manuelle. Jamais. Le tableau de bord
// (/api/prospection-board?s=CRON_SECRET) montre tout.
//
// vercel.json : { "path": "/api/prospection-daily", "schedule": "30 9 * * *" }
// maxDuration recommandé : 60 (Hobby max)
// ============================================================

import { redis, sourcerProchainCouple, enrichirProspect, envoyerLot, METIERS, VILLES } from "../lib/prospection.js";
import { gabarits } from "../templates/emails-prospection.js";

const BUDGET_TOTAL_MS = 50 * 1000;      // marge sous la limite Vercel (60 s)
const COUPLES_SOURCING_PAR_JOUR = 6;    // 120 couples → grille complète en ~20 jours
const ENRICHIR_PAR_JOUR = 25;           // lot d'enrichissement quotidien

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const debut = Date.now();
  const bilan = { sourcing: [], enrichis: 0, sansEmail: 0, envoi: null };
  const jour = new Date().getUTCDay(); // 0 dim, 6 sam

  try {
    // ---------- 1. SOURCING (tous les jours, par petites tranches) ----------
    for (let i = 0; i < COUPLES_SOURCING_PAR_JOUR && Date.now() - debut < BUDGET_TOTAL_MS * 0.3; i++) {
      const r = await sourcerProchainCouple();
      if (r.fini) {
        // Grille terminée : on la relancera le 1er du mois prochain
        const dernierReset = await redis("GET", "prospection:dernier-reset") || "";
        const moisActuel = new Date().toISOString().slice(0, 7);
        if (dernierReset !== moisActuel && new Date().getUTCDate() === 1) {
          await redis("SET", "prospection:curseur", "0");
          await redis("SET", "prospection:dernier-reset", moisActuel);
          bilan.sourcing.push("grille relancée (nouveau mois)");
        } else {
          bilan.sourcing.push("grille complète — relance auto le 1er du mois");
        }
        break;
      }
      bilan.sourcing.push(`${r.couple}: +${r.ajoutes}`);
    }

    // ---------- 2. ENRICHISSEMENT (découverte site + e-mail) ----------
    for (let i = 0; i < ENRICHIR_PAR_JOUR && Date.now() - debut < BUDGET_TOTAL_MS * 0.6; i++) {
      const siret = await redis("LPOP", "prospection:a-enrichir");
      if (!siret) break;
      const brut = await redis("GET", `prospection:p:${siret}`);
      if (!brut) continue;
      const p = JSON.parse(brut);

      const { email, siteWeb } = await enrichirProspect(p);
      if (email && (await redis("SISMEMBER", "prospection:optout", email)) !== 1) {
        p.email = email; p.siteWeb = siteWeb; p.statut = "en_attente";
        await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
        await redis("RPUSH", "prospection:file", siret);
        bilan.enrichis++;
      } else {
        p.statut = "sans_email";
        await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
        await redis("RPUSH", "prospection:sans-email", siret);
        bilan.sansEmail++;
      }
    }

    // ---------- 3. ENVOI (jours ouvrés uniquement) ----------
    if (jour !== 0 && jour !== 6) {
      const budgetRestant = BUDGET_TOTAL_MS - (Date.now() - debut);
      bilan.envoi = await envoyerLot(gabarits, Math.max(budgetRestant, 5000));
    } else {
      bilan.envoi = { weekend: true };
    }

    bilan.dureeMs = Date.now() - debut;
    console.log("Prospection quotidienne:", JSON.stringify(bilan));
    return res.status(200).json({ ok: true, ...bilan });
  } catch (e) {
    console.error("Orchestrateur erreur:", e.message);
    bilan.erreur = e.message;
    return res.status(500).json({ ok: false, ...bilan });
  }
}
