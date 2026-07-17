// lib/prospection.js
// ============================================================
// AGENT COMMERCIAL A5E — Bibliothèque partagée
// Tout tourne côté Vercel : aucune action manuelle requise.
// ============================================================

import nodemailer from "nodemailer";
import { createHmac } from "crypto";

// ---------- Redis (Upstash, déjà en place) ----------
export async function redis(...cmd) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${await r.text()}`);
  return (await r.json()).result;
}

// ---------- Cibles (mêmes que les 120 pages locales) ----------
export const METIERS = [
  { slug: "plombier",     naf: "43.22A", libelle: "plomberie" },
  { slug: "chauffagiste", naf: "43.22B", libelle: "chauffage / génie climatique" },
  { slug: "electricien",  naf: "43.21A", libelle: "installation électrique" },
  { slug: "peintre",      naf: "43.34Z", libelle: "peinture en bâtiment" },
  { slug: "menuisier",    naf: "43.32A", libelle: "menuiserie" },
  { slug: "macon",        naf: "43.99C", libelle: "maçonnerie générale" },
  { slug: "couvreur",     naf: "43.91B", libelle: "couverture" },
  { slug: "paysagiste",   naf: "81.30Z", libelle: "aménagement paysager" },
  { slug: "garagiste",    naf: "45.20A", libelle: "entretien / réparation auto" },
  { slug: "carreleur",    naf: "43.33Z", libelle: "revêtement sols et murs" }
];

export const VILLES = [
  { slug: "paris",       nom: "Paris",       codeCommune: "75056" },
  { slug: "marseille",   nom: "Marseille",   codeCommune: "13055" },
  { slug: "lyon",        nom: "Lyon",        codeCommune: "69123" },
  { slug: "toulouse",    nom: "Toulouse",    codeCommune: "31555" },
  { slug: "nice",        nom: "Nice",        codeCommune: "06088" },
  { slug: "nantes",      nom: "Nantes",      codeCommune: "44109" },
  { slug: "bordeaux",    nom: "Bordeaux",    codeCommune: "33063" },
  { slug: "lille",       nom: "Lille",       codeCommune: "59350" },
  { slug: "strasbourg",  nom: "Strasbourg",  codeCommune: "67482" },
  { slug: "rennes",      nom: "Rennes",      codeCommune: "35238" },
  { slug: "montpellier", nom: "Montpellier", codeCommune: "34172" },
  { slug: "grenoble",    nom: "Grenoble",    codeCommune: "38185" }
];

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// ÉTAPE A — SOURCING SIRENE (open data État, gratuit, légal)
// Appelée par tranches pour tenir dans le temps d'exécution
// Vercel : un couple métier×ville par appel, curseur en Redis.
// ============================================================
export async function sourcerProchainCouple() {
  const curseur = parseInt(await redis("GET", "prospection:curseur") || "0", 10);
  const total = METIERS.length * VILLES.length;
  if (curseur >= total) return { fini: true, curseur, total };

  const m = METIERS[Math.floor(curseur / VILLES.length)];
  const v = VILLES[curseur % VILLES.length];

  let ajoutes = 0;
  // v2.1 — Sourcing intelligent : on récupère jusqu'à 3 pages puis on TRIE.
  // Les sociétés (SARL, SAS, EURL... nature juridique 5xxx) ont un site web
  // bien plus souvent que les auto-entrepreneurs en nom propre ("MONSIEUR X"),
  // dont la découverte de domaine échoue presque toujours. On garde les
  // personnes physiques en fin de liste (certaines ont un site), mais les
  // sociétés passent d'abord → taux d'e-mails trouvés nettement supérieur.
  const bruts = [];
  for (let page = 1; page <= 3; page++) {
    const url = `https://recherche-entreprises.api.gouv.fr/search?code_naf=${m.naf}` +
      `&code_commune=${v.codeCommune}&etat_administratif=A&per_page=25&page=${page}`;
    const r = await fetch(url, { headers: { "User-Agent": "A5E/1.0 (+https://artisan5etoiles.fr)" } });
    if (!r.ok) break;
    const data = await r.json();
    bruts.push(...(data.results || []));
    if (!data.results || data.results.length < 25) break;
  }
  const estPersonnePhysique = (e) => {
    const nom = (e.nom_complet || e.nom_raison_sociale || "");
    const nature = String(e.nature_juridique || "");
    return /^(monsieur|madame|m\.|mme)\s/i.test(nom) || nature.startsWith("1");
  };
  const tries = [
    ...bruts.filter(e => !estPersonnePhysique(e)),   // sociétés d'abord
    ...bruts.filter(e => estPersonnePhysique(e))      // personnes physiques ensuite
  ];
  {
    for (const e of tries.slice(0, 25)) {
      const nom = e.nom_complet || e.nom_raison_sociale;
      const siret = e.siege?.siret;
      if (!nom || !siret) continue;
      const existe = await redis("GET", `prospection:p:${siret}`);
      if (existe) continue;
      await redis("SET", `prospection:p:${siret}`, JSON.stringify({
        siret, nom,
        metier: m.slug, metierLibelle: m.libelle,
        ville: v.nom, villeSlug: v.slug,
        dateCreation: e.date_creation || "",
        pageLocale: `https://artisan5etoiles.fr/local/${m.slug}-${v.slug}.html`,
        email: "", siteWeb: "",
        etape: 0, dernierEnvoi: null, statut: "a_enrichir"
      }));
      await redis("RPUSH", "prospection:a-enrichir", siret);
      ajoutes++;
    }
  }
  await redis("SET", "prospection:curseur", String(curseur + 1));
  return { fini: false, couple: `${m.slug}×${v.slug}`, ajoutes, curseur: curseur + 1, total };
}

// ============================================================
// ÉTAPE B — DÉCOUVERTE DU SITE + EXTRACTION E-MAIL (automatique)
// Stratégie : deviner le domaine depuis le nom (slug.fr, slug.com…),
// VÉRIFIER que le site parle bien de cette entreprise (anti-homonyme),
// puis extraire l'e-mail publié (priorité contact@ / mailto:).
// ============================================================
const MOTS_JURIDIQUES = /\b(sarl|sas|sasu|eurl|ei|sa|sci|scop|monsieur|madame|m\.|mme|entreprise|ets|societe|société)\b/gi;

export function candidatsDomaines(nom) {
  const base = nom.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // accents
    .replace(MOTS_JURIDIQUES, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim().replace(/\s+/g, " ");
  if (!base) return [];
  const colle = base.replace(/[\s-]/g, "");
  const tirets = base.replace(/\s/g, "-");
  const variantes = [...new Set([colle, tirets])].filter(s => s.length >= 5 && s.length <= 40);
  const domaines = [];
  for (const s of variantes) for (const tld of [".fr", ".com"]) domaines.push(s + tld);
  return domaines.slice(0, 4); // 4 essais max par prospect (budget temps)
}

const REGEX_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAILS_EXCLUS = /(example|exemple|wixpress|sentry|\.(png|jpg|jpeg|gif|svg|webp)$|noreply|no-reply|godaddy|domain|@[0-9])/i;

async function chercherPage(url, timeoutMs = 6000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; A5E/1.0; +https://artisan5etoiles.fr)" }
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!type.includes("text/html")) return null;
    return (await r.text()).slice(0, 400000);
  } catch { return null; }
}

// Garde anti-homonyme : le site doit mentionner un mot significatif du nom
// de l'entreprise OU sa ville. Sinon on n'y touche pas.
function siteCorrespond(html, nom, ville) {
  const h = html.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const motsNom = nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(MOTS_JURIDIQUES, " ").split(/[\s-]+/).filter(w => w.length >= 4);
  const nomOk = motsNom.some(w => h.includes(w));
  const villeOk = h.includes(ville.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  return nomOk || villeOk;
}

function choisirEmail(candidats, domaine) {
  const uniques = [...new Set(candidats.map(e => e.toLowerCase()))].filter(e => !EMAILS_EXCLUS.test(e));
  if (!uniques.length) return "";
  const generiques = uniques.filter(e => /^(contact|info|bonjour|hello|accueil|secretariat|commercial)@/.test(e));
  const surDomaine = (l) => l.find(e => e.endsWith("@" + domaine)) || l.find(e => e.includes(domaine.replace(/^www\./, "")));
  return surDomaine(generiques) || generiques[0] || surDomaine(uniques) || uniques[0];
}

export async function enrichirProspect(p) {
  for (const domaine of candidatsDomaines(p.nom)) {
    const accueil = await chercherPage(`https://${domaine}`);
    if (!accueil) continue;
    if (!siteCorrespond(accueil, p.nom, p.ville)) continue; // homonyme probable → on passe

    const pages = [accueil];
    for (const chemin of ["/contact", "/mentions-legales"]) {
      const pg = await chercherPage(`https://${domaine}${chemin}`, 5000);
      if (pg) pages.push(pg);
      if (pages.some(x => x.includes("mailto:"))) break;
    }
    const trouves = [];
    for (const html of pages) {
      trouves.push(...[...html.matchAll(/mailto:([^"'?&\s>]+)/gi)].map(x => x[1]));
      trouves.push(...(html.match(REGEX_EMAIL) || []));
    }
    const email = choisirEmail(trouves, domaine);
    if (email) return { email, siteWeb: `https://${domaine}` };
  }
  return { email: "", siteWeb: "" };
}

// ============================================================
// ÉTAPE C — ENVOI SÉQUENCÉ (J0 → J+4 → J+10, 3 e-mails max)
// ============================================================
export const PLAFOND_JOUR = 20;
const DELAIS = [0, 4, 10];

export function lienDesinscription(email) {
  const t = createHmac("sha256", process.env.BADGE_SECRET).update(`optout|${email}`).digest("hex");
  return `https://artisan5etoiles.fr/api/desinscription?e=${encodeURIComponent(email)}&t=${t}`;
}

const joursDepuis = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity;

export async function envoyerLot(gabarits, budgetMs) {
  const debut = Date.now();
  const stats = { envoyes: 0, optouts: 0, termines: 0, pasEncore: 0, erreurs: 0 };
  if (process.env.PROSPECTION_ACTIVE !== "oui") return { ...stats, inactif: true };
  for (const v of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (!process.env[v]) return { ...stats, erreurConfig: `Variable ${v} manquante` };
  }
  if (/artisan5etoiles\.fr$/i.test(process.env.SMTP_USER)) {
    return { ...stats, erreurConfig: "SMTP_USER = domaine principal : interdit." };
  }

  const transporteur = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: 465, secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const dejaEnvoyes = parseInt(await redis("GET", `prospection:envoyes:${new Date().toISOString().slice(0,10)}`) || "0", 10);
  let restant = PLAFOND_JOUR - dejaEnvoyes;

  const taille = Math.min(Number(await redis("LLEN", "prospection:file")) || 0, 120);
  for (let i = 0; i < taille && restant > 0 && Date.now() - debut < budgetMs; i++) {
    const siret = await redis("LPOP", "prospection:file");
    if (!siret) break;
    try {
      const brut = await redis("GET", `prospection:p:${siret}`);
      if (!brut) continue;
      const p = JSON.parse(brut);

      if ((await redis("SISMEMBER", "prospection:optout", p.email)) === 1) {
        p.statut = "optout";
        await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
        stats.optouts++; continue;
      }
      if (p.etape >= 3) {
        p.statut = "termine";
        await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
        stats.termines++; continue;
      }
      if (p.etape > 0 && joursDepuis(p.dernierEnvoi) < DELAIS[p.etape]) {
        await redis("RPUSH", "prospection:file", siret);
        stats.pasEncore++; continue;
      }

      const g = gabarits[p.etape](p, lienDesinscription(p.email));
      await transporteur.sendMail({
        from: `"Mike — Artisan 5 Étoiles" <${process.env.SMTP_USER}>`,
        to: p.email,
        replyTo: process.env.REPLY_TO || process.env.SMTP_USER,
        subject: g.objet, text: g.texte,
        headers: { "List-Unsubscribe": `<${lienDesinscription(p.email)}>` }
      });

      p.etape += 1;
      p.dernierEnvoi = new Date().toISOString();
      p.statut = p.etape >= 3 ? "termine" : "en_cours";
      await redis("SET", `prospection:p:${siret}`, JSON.stringify(p));
      if (p.etape < 3) await redis("RPUSH", "prospection:file", siret);
      await redis("INCR", `prospection:envoyes:${new Date().toISOString().slice(0,10)}`);
      await redis("LPUSH", "prospection:journal",
        JSON.stringify({ quand: p.dernierEnvoi, nom: p.nom, ville: p.ville, etape: p.etape, email: p.email }));
      await redis("LTRIM", "prospection:journal", 0, 199);
      stats.envoyes++; restant--;
      await attendre(3000); // espacement (budget serverless oblige : 3 s)
    } catch (e) {
      console.error(`Envoi ${siret}:`, e.message);
      await redis("RPUSH", "prospection:file", siret);
      stats.erreurs++;
    }
  }
  return stats;
}
