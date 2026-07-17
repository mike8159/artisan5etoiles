// scripts/prospection/extraire-prospects.js
// ============================================================
// AGENT COMMERCIAL A5E — Étape 1 : SOURCING (base SIRENE)
//
// Interroge l'API officielle et gratuite de l'État
// (recherche-entreprises.api.gouv.fr, données SIRENE/INSEE)
// pour extraire les artisans actifs par métier × ville.
//
// Usage :   node scripts/prospection/extraire-prospects.js
// Sortie :  data/prospects.csv
//
// 100 % légal : données publiques open data. AUCUN appel à
// Google Places (interdit pour la prospection par les CGU EEA).
// Limite API : ~7 req/s → on throttle à 2 req/s par prudence.
// ============================================================

const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..", "..");
const SORTIE = path.join(RACINE, "data");
const API = "https://recherche-entreprises.api.gouv.fr/search";

// Métiers ciblés — code NAF (nomenclature INSEE) + slug des pages locales
const METIERS = [
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

// Villes — code commune INSEE (identique aux 120 pages locales)
const VILLES = [
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

// Nombre max de prospects par couple métier×ville (rester raisonnable :
// on ne peut en contacter que ~20/jour de toute façon)
const MAX_PAR_COUPLE = 25;

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

function champCsv(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[",;\n]/.test(s) ? `"${s}"` : s;
}

async function rechercher(metier, ville) {
  const resultats = [];
  let page = 1;
  while (resultats.length < MAX_PAR_COUPLE && page <= 3) {
    const url = `${API}?code_naf=${metier.naf}&code_commune=${ville.codeCommune}` +
      `&etat_administratif=A&per_page=25&page=${page}`;
    const r = await fetch(url, { headers: { "User-Agent": "A5E-prospection/1.0" } });
    if (r.status === 429) { await attendre(3000); continue; } // rate limit : on patiente
    if (!r.ok) {
      console.error(`  ⚠ API ${r.status} pour ${metier.slug}×${ville.slug} — on passe`);
      return resultats;
    }
    const data = await r.json();
    for (const e of data.results || []) {
      // Personne physique dont le nom est masqué (statut non-diffusible) :
      // l'API les exclut déjà, mais double sécurité
      const nom = e.nom_complet || e.nom_raison_sociale;
      if (!nom) continue;
      const siege = e.siege || {};
      resultats.push({
        metier: metier.slug,
        metierLibelle: metier.libelle,
        ville: ville.nom,
        villeSlug: ville.slug,
        nom: nom,
        siren: e.siren || "",
        siret: siege.siret || "",
        adresse: siege.adresse || "",
        codePostal: siege.code_postal || "",
        dateCreation: e.date_creation || "",
        effectif: e.tranche_effectif_salarie || "",
        // La page locale correspondante = page d'atterrissage de l'e-mail
        pageLocale: `https://artisan5etoiles.fr/local/${metier.slug}-${ville.slug}.html`,
        siteWeb: "",   // à remplir à l'étape enrichissement
        email: ""       // à remplir à l'étape enrichissement
      });
      if (resultats.length >= MAX_PAR_COUPLE) break;
    }
    if (!data.results || data.results.length < 25) break; // plus de pages
    page++;
    await attendre(500); // throttle
  }
  return resultats;
}

(async () => {
  if (!fs.existsSync(SORTIE)) fs.mkdirSync(SORTIE, { recursive: true });
  const tous = [];
  const vusSiren = new Set();

  for (const m of METIERS) {
    for (const v of VILLES) {
      process.stdout.write(`${m.slug} × ${v.nom}... `);
      const lot = await rechercher(m, v);
      let ajoutes = 0;
      for (const p of lot) {
        if (vusSiren.has(p.siren)) continue; // dédoublonnage inter-requêtes
        vusSiren.add(p.siren);
        tous.push(p);
        ajoutes++;
      }
      console.log(`${ajoutes} prospects`);
      await attendre(500);
    }
  }

  const colonnes = ["metier","metierLibelle","ville","villeSlug","nom","siren","siret",
    "adresse","codePostal","dateCreation","effectif","pageLocale","siteWeb","email"];
  const csv = [colonnes.join(";")]
    .concat(tous.map(p => colonnes.map(c => champCsv(p[c])).join(";")))
    .join("\n");
  const fichier = path.join(SORTIE, "prospects.csv");
  fs.writeFileSync(fichier, "\uFEFF" + csv, "utf-8"); // BOM pour Excel FR
  console.log(`\n✅ ${tous.length} prospects uniques → ${fichier}`);
  console.log("Prochaine étape : node scripts/prospection/enrichir-emails.js");
})();
