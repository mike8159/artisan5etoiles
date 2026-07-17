// scripts/prospection/charger-file.js
// ============================================================
// AGENT COMMERCIAL A5E — Étape 3 : CHARGEMENT DE LA FILE
//
// Pousse les prospects enrichis (avec e-mail) dans Redis
// (Upstash, déjà utilisé pour la sentinelle). Le cron d'envoi
// (api/prospection-cron.js) piochera dedans chaque jour.
//
// Usage :
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/prospection/charger-file.js
//   (mêmes valeurs que dans les variables d'environnement Vercel)
//
// Structure Redis :
//   prospection:file            → liste des SIRET en attente
//   prospection:p:<siret>       → fiche JSON du prospect + état de séquence
//   prospection:optout          → set des e-mails désinscrits (NE JAMAIS vider)
// ============================================================

const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..", "..");
const ENTREE = path.join(RACINE, "data", "prospects-enrichis.csv");

const URL_REDIS = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function redis(...cmd) {
  const r = await fetch(URL_REDIS, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${await r.text()}`);
  return (await r.json()).result;
}

function lireCsv(fichier) {
  const brut = fs.readFileSync(fichier, "utf-8").replace(/^\uFEFF/, "");
  const lignes = brut.split("\n").filter(l => l.trim());
  const colonnes = lignes[0].split(";");
  return lignes.slice(1).map(l => {
    const valeurs = [];
    let cur = "", g = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (g && l[i+1] === '"') { cur += '"'; i++; } else g = !g; }
      else if (c === ";" && !g) { valeurs.push(cur); cur = ""; }
      else cur += c;
    }
    valeurs.push(cur);
    const obj = {};
    colonnes.forEach((c, i) => obj[c] = valeurs[i] || "");
    return obj;
  });
}

(async () => {
  if (!URL_REDIS || !TOKEN) {
    console.error("❌ Variables KV_REST_API_URL / KV_REST_API_TOKEN manquantes.");
    console.error("   Copiez-les depuis Vercel → Settings → Environment Variables.");
    process.exit(1);
  }
  if (!fs.existsSync(ENTREE)) {
    console.error("❌ data/prospects-enrichis.csv introuvable. Lancez d'abord enrichir-emails.js");
    process.exit(1);
  }

  const prospects = lireCsv(ENTREE).filter(p => p.email && p.siret);
  let charges = 0, dejaVus = 0, optouts = 0;

  for (const p of prospects) {
    // Jamais recharger quelqu'un qui s'est désinscrit
    const estOptout = await redis("SISMEMBER", "prospection:optout", p.email.toLowerCase());
    if (estOptout === 1) { optouts++; continue; }

    const cle = `prospection:p:${p.siret}`;
    const existe = await redis("GET", cle);
    if (existe) { dejaVus++; continue; }

    await redis("SET", cle, JSON.stringify({
      siret: p.siret, nom: p.nom, email: p.email.toLowerCase(),
      metier: p.metier, metierLibelle: p.metierLibelle,
      ville: p.ville, villeSlug: p.villeSlug,
      dateCreation: p.dateCreation, pageLocale: p.pageLocale,
      etape: 0,                 // 0 = jamais contacté, 1/2/3 = e-mails envoyés
      dernierEnvoi: null,
      statut: "en_attente"      // en_attente | en_cours | termine | optout
    }));
    await redis("RPUSH", "prospection:file", p.siret);
    charges++;
  }

  const taille = await redis("LLEN", "prospection:file");
  console.log(`✅ ${charges} prospects chargés | ${dejaVus} déjà présents | ${optouts} désinscrits ignorés`);
  console.log(`File d'envoi actuelle : ${taille} prospects`);
})();
