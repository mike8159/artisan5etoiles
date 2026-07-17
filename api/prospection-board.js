// api/prospection-board.js
// ============================================================
// AGENT COMMERCIAL A5E — TABLEAU DE BORD
//
// GET /api/prospection-board?s=<CRON_SECRET>
// Page HTML lisible sur téléphone : état de la machine, compteurs,
// derniers envois, prospects sans e-mail. Lecture seule.
// ============================================================

import { redis, METIERS, VILLES, PLAFOND_JOUR } from "../lib/prospection.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée" });
  if (String(req.query.s || "") !== process.env.CRON_SECRET) {
    return res.status(401).send("Accès refusé");
  }

  try {
    const [curseur, aEnrichir, file, sansEmail, optouts, journalBrut, envoyesAuj] = await Promise.all([
      redis("GET", "prospection:curseur"),
      redis("LLEN", "prospection:a-enrichir"),
      redis("LLEN", "prospection:file"),
      redis("LLEN", "prospection:sans-email"),
      redis("SCARD", "prospection:optout"),
      redis("LRANGE", "prospection:journal", 0, 29),
      redis("GET", `prospection:envoyes:${new Date().toISOString().slice(0, 10)}`)
    ]);

    const total = METIERS.length * VILLES.length;
    const pct = Math.min(100, Math.round((parseInt(curseur || "0", 10) / total) * 100));
    const actif = process.env.PROSPECTION_ACTIVE === "oui";
    const journal = (journalBrut || []).map(j => { try { return JSON.parse(j); } catch { return null; } }).filter(Boolean);

    const lignesJournal = journal.map(j =>
      `<tr><td>${new Date(j.quand).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>` +
      `<td>${j.nom}</td><td>${j.ville}</td><td>e-mail ${j.etape}/3</td></tr>`
    ).join("") || `<tr><td colspan="4" style="color:#888">Aucun envoi pour le moment</td></tr>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>Agent Commercial A5E</title>
<style>
body{font-family:system-ui,sans-serif;background:#F6F4EF;color:#1B2A4A;margin:0;padding:16px}
h1{font-size:20px;margin:0 0 4px} .sous{color:#5C6470;font-size:13px;margin-bottom:16px}
.etat{display:inline-block;padding:4px 12px;font-weight:800;font-size:13px;border:2px solid #1B2A4A;
${""}background:${"" /* couleur dynamique injectée plus bas */}}
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}
.carte{background:#fff;border:3px solid #1B2A4A;box-shadow:5px 5px 0 #F5B301;padding:14px}
.carte .n{font-size:26px;font-weight:800} .carte .l{font-size:12px;color:#5C6470}
.barre{background:#e5e1d8;height:12px;border:2px solid #1B2A4A;margin:6px 0 2px}
.barre>div{background:#F5B301;height:100%;width:${pct}%}
table{width:100%;border-collapse:collapse;background:#fff;border:3px solid #1B2A4A;font-size:13px}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid #eee} th{background:#1B2A4A;color:#fff}
h2{font-size:15px;margin:22px 0 8px}
</style></head><body>
<h1>⚡ Agent Commercial A5E</h1>
<div class="sous">Mise à jour : ${new Date().toLocaleString("fr-FR")}</div>
<span class="etat" style="background:${actif ? "#C8E6C9" : "#FFE0B2"}">
  ${actif ? "✅ ENVOIS ACTIFS" : "⏸ EN PAUSE (warm-up) — sourcing et enrichissement tournent quand même"}
</span>

<div class="grille">
  <div class="carte"><div class="n">${aEnrichir || 0}</div><div class="l">prospects à enrichir</div></div>
  <div class="carte"><div class="n">${file || 0}</div><div class="l">prêts à contacter (avec e-mail)</div></div>
  <div class="carte"><div class="n">${envoyesAuj || 0}/${PLAFOND_JOUR}</div><div class="l">e-mails envoyés aujourd'hui</div></div>
  <div class="carte"><div class="n">${sansEmail || 0}</div><div class="l">sans e-mail trouvable (archivés)</div></div>
  <div class="carte"><div class="n">${optouts || 0}</div><div class="l">désinscrits (respectés à vie)</div></div>
</div>

<h2>Balayage SIRENE du mois</h2>
<div class="barre"><div></div></div>
<div class="sous">${curseur || 0} / ${total} couples métier×ville explorés (${pct}%) — se relance automatiquement le 1er de chaque mois</div>

<h2>30 derniers e-mails envoyés</h2>
<table><tr><th>Quand</th><th>Entreprise</th><th>Ville</th><th>Étape</th></tr>${lignesJournal}</table>

<div class="sous" style="margin-top:18px">
Rappel : les réponses des artisans arrivent dans votre boîte ${process.env.REPLY_TO || process.env.SMTP_USER || "(SMTP non configuré)"}.
Arrêt d'urgence : variable PROSPECTION_ACTIVE → "non" dans Vercel.
</div>
</body></html>`);
  } catch (e) {
    console.error("Board erreur:", e.message);
    return res.status(500).send("Erreur de lecture du tableau de bord : " + e.message);
  }
}
