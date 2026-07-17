// scripts/prospection/enrichir-emails.js
// ============================================================
// AGENT COMMERCIAL A5E — Étape 2 : ENRICHISSEMENT E-MAIL
//
// Pour chaque prospect du CSV qui a un site web renseigné,
// visite les pages usuelles du site (accueil, contact,
// mentions légales) et extrait l'adresse e-mail publiée.
//
// D'où vient la colonne siteWeb ?
//   → Remplie à la main (recherche du nom sur un moteur), OU
//   → Remplie par une session Cowork qui navigue et colle les URLs.
//   L'API SIRENE ne fournit pas les sites web ; c'est l'étape
//   qui demande un peu d'humain (ou Cowork) — assumé.
//
// Priorité aux adresses génériques (contact@, info@) : la CNIL
// ne les considère pas comme des données personnelles.
//
// Usage :   node scripts/prospection/enrichir-emails.js
// Entrée :  data/prospects.csv   (colonne siteWeb remplie quand connue)
// Sortie :  data/prospects-enrichis.csv
// ============================================================

const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..", "..");
const ENTREE = path.join(RACINE, "data", "prospects.csv");
const SORTIE = path.join(RACINE, "data", "prospects-enrichis.csv");

const PAGES_A_TESTER = ["", "/contact", "/contact.html", "/mentions-legales",
  "/mentions-legales.html", "/contactez-nous", "/a-propos"];
const REGEX_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Adresses à ignorer (techniques, exemples, images)
const EXCLUS = /(example|exemple|wixpress|sentry|@(png|jpg|jpeg|gif|svg|webp)|noreply|no-reply|godaddy|domain)/i;

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

function lireCsv(fichier) {
  const brut = fs.readFileSync(fichier, "utf-8").replace(/^\uFEFF/, "");
  const lignes = brut.split("\n").filter(l => l.trim());
  const colonnes = lignes[0].split(";");
  return { colonnes, lignes: lignes.slice(1).map(l => {
    // parse CSV simple avec guillemets
    const valeurs = [];
    let cur = "", dansGuillemets = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (dansGuillemets && l[i+1] === '"') { cur += '"'; i++; }
        else dansGuillemets = !dansGuillemets;
      } else if (c === ";" && !dansGuillemets) { valeurs.push(cur); cur = ""; }
      else cur += c;
    }
    valeurs.push(cur);
    const obj = {};
    colonnes.forEach((c, i) => obj[c] = valeurs[i] || "");
    return obj;
  })};
}

function champCsv(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[",;\n]/.test(s) ? `"${s}"` : s;
}

function choisirMeilleurEmail(emails, domaineSite) {
  const uniques = [...new Set(emails.map(e => e.toLowerCase()))]
    .filter(e => !EXCLUS.test(e));
  if (!uniques.length) return "";
  // 1. Priorité : générique sur le domaine du site (contact@leur-site.fr)
  const generiques = uniques.filter(e =>
    /^(contact|info|bonjour|hello|accueil|contact\.|secretariat)@/i.test(e));
  const surDomaine = (liste) => liste.find(e => domaineSite && e.endsWith("@" + domaineSite))
    || liste.find(e => domaineSite && e.includes(domaineSite.replace(/^www\./, "")));
  return surDomaine(generiques) || generiques[0] || surDomaine(uniques) || uniques[0];
}

async function extraireEmailDuSite(siteWeb) {
  let base = siteWeb.trim();
  if (!base) return { email: "", note: "pas de site" };
  if (!/^https?:\/\//i.test(base)) base = "https://" + base;
  let domaine = "";
  try { domaine = new URL(base).hostname.replace(/^www\./, ""); } catch { return { email: "", note: "URL invalide" }; }

  const trouves = [];
  for (const page of PAGES_A_TESTER) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(base.replace(/\/$/, "") + page, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; A5E/1.0; +https://artisan5etoiles.fr)" },
        redirect: "follow"
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const html = await r.text();
      // mailto: d'abord (les plus fiables), puis texte brut
      const mailtos = [...html.matchAll(/mailto:([^"'?&\s>]+)/gi)].map(m => m[1]);
      trouves.push(...mailtos, ...(html.match(REGEX_EMAIL) || []));
      if (trouves.length) break; // premier hit suffit, on limite les requêtes
    } catch { /* page absente ou timeout : suivante */ }
    await attendre(400);
  }
  const email = choisirMeilleurEmail(trouves, domaine);
  return { email, note: email ? "trouvé sur le site" : "aucun email public" };
}

(async () => {
  if (!fs.existsSync(ENTREE)) {
    console.error("❌ data/prospects.csv introuvable. Lancez d'abord extraire-prospects.js");
    process.exit(1);
  }
  const { colonnes, lignes } = lireCsv(ENTREE);
  if (!colonnes.includes("noteEnrichissement")) colonnes.push("noteEnrichissement");

  let avecSite = 0, avecEmail = 0;
  for (const p of lignes) {
    if (!p.siteWeb) { p.noteEnrichissement = "site inconnu"; continue; }
    if (p.email) { avecSite++; avecEmail++; continue; } // déjà fait
    avecSite++;
    process.stdout.write(`${p.nom} (${p.siteWeb})... `);
    const { email, note } = await extraireEmailDuSite(p.siteWeb);
    p.email = email;
    p.noteEnrichissement = note;
    if (email) avecEmail++;
    console.log(email || "—");
    await attendre(600); // politesse inter-sites
  }

  const csv = [colonnes.join(";")]
    .concat(lignes.map(p => colonnes.map(c => champCsv(p[c])).join(";")))
    .join("\n");
  fs.writeFileSync(SORTIE, "\uFEFF" + csv, "utf-8");
  console.log(`\n✅ ${lignes.length} prospects | ${avecSite} avec site | ${avecEmail} avec e-mail`);
  console.log(`→ ${SORTIE}`);
  console.log("Prochaine étape : node scripts/prospection/charger-file.js (charge la file d'envoi Redis)");
})();
