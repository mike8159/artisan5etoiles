// scripts/generer-pages-locales.js
// ============================================================
// GÉNÉRATEUR DE PAGES LOCALES (SEO longue traîne, coût zéro)
//
// Produit une page par couple métier × ville dans /local/,
// met à jour le maillage interne et régénère sitemap.xml.
//
// Usage :  node scripts/generer-pages-locales.js
// Puis  :  commit + push → Vercel déploie, Google indexe.
//
// Pour étendre : ajoutez des villes dans VILLES ci-dessous
// et relancez le script. Rien d'autre à toucher.
// ============================================================

const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..");
const DOSSIER = path.join(RACINE, "local");
const DOMAINE = "https://artisan5etoiles.fr";
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

// ---------- Villes (extensible à volonté) ----------
const VILLES = [
  { nom: "Paris",       slug: "paris",       dep: "Paris (75)",              region: "Île-de-France" },
  { nom: "Marseille",   slug: "marseille",   dep: "les Bouches-du-Rhône (13)", region: "Provence-Alpes-Côte d'Azur" },
  { nom: "Lyon",        slug: "lyon",        dep: "le Rhône (69)",           region: "Auvergne-Rhône-Alpes" },
  { nom: "Toulouse",    slug: "toulouse",    dep: "la Haute-Garonne (31)",   region: "Occitanie" },
  { nom: "Nice",        slug: "nice",        dep: "les Alpes-Maritimes (06)", region: "Provence-Alpes-Côte d'Azur" },
  { nom: "Nantes",      slug: "nantes",      dep: "la Loire-Atlantique (44)", region: "Pays de la Loire" },
  { nom: "Bordeaux",    slug: "bordeaux",    dep: "la Gironde (33)",         region: "Nouvelle-Aquitaine" },
  { nom: "Lille",       slug: "lille",       dep: "le Nord (59)",            region: "Hauts-de-France" },
  { nom: "Strasbourg",  slug: "strasbourg",  dep: "le Bas-Rhin (67)",        region: "Grand Est" },
  { nom: "Rennes",      slug: "rennes",      dep: "l'Ille-et-Vilaine (35)",  region: "Bretagne" },
  { nom: "Montpellier", slug: "montpellier", dep: "l'Hérault (34)",          region: "Occitanie" },
  { nom: "Grenoble",    slug: "grenoble",    dep: "l'Isère (38)",            region: "Auvergne-Rhône-Alpes" }
];

// ---------- Métiers : contenu spécifique (pas de page "vide") ----------
const METIERS = [
  {
    slug: "plombier", nom: "plombier", article: "un plombier", pluriel: "plombiers",
    urgence: "une fuite d'eau ou un chauffe-eau en panne",
    requete: "plombier",
    probleme: "En plomberie, la majorité des appels sont des urgences : le client compare 3 fiches Google en 2 minutes et appelle celui qui inspire confiance immédiatement. Une note moyenne ou des avis sans réponse font perdre l'appel avant même qu'il ait lieu.",
    conseils: [
      "Répondez en priorité aux avis qui mentionnent une urgence (fuite, dépannage) : ce sont ceux que lisent vos futurs clients paniqués.",
      "Ajoutez des photos avant/après de vos interventions — une salle de bain refaite parle plus qu'un logo.",
      "Demandez l'avis juste après le dépannage, quand le soulagement du client est au maximum."
    ]
  },
  {
    slug: "electricien", nom: "électricien", article: "un électricien", pluriel: "électriciens",
    urgence: "une panne de courant ou un tableau à remettre aux normes",
    requete: "électricien",
    probleme: "Pour l'électricité, le client cherche avant tout une garantie de sérieux : normes, sécurité, conformité. Les avis qui mentionnent un travail « propre » et « aux normes » sont vos meilleurs commerciaux, à condition d'y répondre pour les faire vivre.",
    conseils: [
      "Dans vos réponses aux avis, reprenez naturellement les mots « aux normes », « sécurité », « Consuel » quand ils sont pertinents : ils rassurent les lecteurs suivants.",
      "Photographiez vos tableaux électriques terminés : c'est le porno du BTP, tout le monde regarde.",
      "Un avis négatif sur un délai ? Répondez en expliquant calmement, sans vous justifier : le lecteur juge votre réponse, pas le reproche."
    ]
  },
  {
    slug: "peintre", nom: "peintre en bâtiment", article: "un peintre", pluriel: "peintres",
    urgence: "un rafraîchissement avant vente ou une façade défraîchie",
    requete: "peintre en bâtiment",
    probleme: "En peinture, le résultat est 100 % visuel : les photos de vos réalisations pèsent autant que la note. Une fiche avec 4,8★ mais trois photos fait moins de devis qu'une fiche 4,6★ avec vingt chantiers photographiés.",
    conseils: [
      "Publiez systématiquement une photo avant/après par chantier — avec l'accord du client, mentionnez le quartier dans la légende.",
      "Répondez aux avis positifs en citant le type de travaux (« ravalement », « pièce à vivre ») : cela nourrit votre référencement local.",
      "Proposez l'avis Google au moment de la levée de réserves, jamais par e-mail trois semaines après."
    ]
  },
  {
    slug: "menuisier", nom: "menuisier", article: "un menuisier", pluriel: "menuisiers",
    urgence: "une fenêtre à remplacer ou un aménagement sur mesure",
    requete: "menuisier",
    probleme: "Le sur-mesure se vend sur la confiance : le client confie son intérieur et son budget. Les avis détaillés qui racontent le projet (« dressing sous pente », « escalier chêne ») convainquent bien plus qu'une note seule — et vos réponses montrent votre exigence.",
    conseils: [
      "Encouragez les clients à décrire leur projet dans l'avis : un avis détaillé vaut trois avis « super travail merci ».",
      "Répondez en mentionnant l'essence de bois ou le type d'ouvrage : c'est bon pour le lecteur et pour Google.",
      "Les photos de détails (assemblages, finitions) crédibilisent votre niveau de gamme."
    ]
  },
  {
    slug: "macon", nom: "maçon", article: "un maçon", pluriel: "maçons",
    urgence: "une extension, un mur porteur ou une terrasse",
    requete: "maçon",
    probleme: "En maçonnerie, les montants sont élevés et les chantiers longs : le client épluche les avis à la recherche du moindre signal d'abandon de chantier ou de malfaçon. Une fiche irréprochable et des réponses posées sont votre meilleure assurance anti-devis-fantôme.",
    conseils: [
      "Répondez à chaque avis, même ancien : une fiche « vivante » rassure sur la pérennité de votre entreprise.",
      "Face à un avis mentionnant un retard, reconnaissez le fait, expliquez la cause (météo, approvisionnement) et montrez la solution apportée.",
      "Vos photos de chantiers terminés doivent montrer la propreté du site : c'est un critère de choix décisif."
    ]
  },
  {
    slug: "couvreur", nom: "couvreur", article: "un couvreur", pluriel: "couvreurs",
    urgence: "une fuite de toiture ou des tuiles envolées après une tempête",
    requete: "couvreur",
    probleme: "La couverture est le métier le plus touché par le démarchage abusif : les clients se méfient. Une fiche Google solide avec de vrais avis localisés et des réponses signées est ce qui vous distingue immédiatement des « couvreurs » de passage.",
    conseils: [
      "Signez chaque réponse du nom de votre entreprise et de votre ville : vous ancrez votre légitimité locale face aux démarcheurs.",
      "Après chaque intervention post-tempête, demandez l'avis dans la foulée : ces avis datés « prouvent » votre réactivité.",
      "Ne laissez jamais un avis évoquant un acompte sans réponse détaillée : c'est le sujet n°1 de méfiance dans votre métier."
    ]
  },
  {
    slug: "chauffagiste", nom: "chauffagiste", article: "un chauffagiste", pluriel: "chauffagistes",
    urgence: "une chaudière en panne en plein hiver ou une pompe à chaleur à installer",
    requete: "chauffagiste",
    probleme: "Entre dépannage d'urgence et gros projets (PAC, aides de l'État), votre clientèle vous cherche sur Google à deux moments très différents. Dans les deux cas, les avis mentionnant votre réactivité et votre transparence sur les prix font la décision.",
    conseils: [
      "Répondez aux avis en distinguant clairement dépannage et installation : le lecteur doit comprendre en 5 secondes que vous faites les deux.",
      "Les avis citant les aides (MaPrimeRénov', CEE) attirent les projets rentables : remerciez-les en détail.",
      "En période de chauffe (octobre-janvier), vérifiez vos avis chaque semaine : c'est là que tout se joue."
    ]
  },
  {
    slug: "paysagiste", nom: "paysagiste", article: "un paysagiste", pluriel: "paysagistes",
    urgence: "un jardin à créer ou un entretien régulier à confier",
    requete: "paysagiste",
    probleme: "Le paysage se vend en images et en saisons : vos avis et photos de printemps travaillent pour vous toute l'année. Une fiche laissée en jachère l'hiver décroche dans le classement local au moment où les projets de jardin se décident.",
    conseils: [
      "Alimentez la fiche toute l'année : photos de réalisations au printemps, d'entretien en été, d'élagage en automne.",
      "Répondez aux avis en nommant le type de prestation (création, entretien, clôture) : chaque réponse est une micro-page de vente.",
      "Proposez l'avis à la fin du premier entretien saisonnier, pas seulement après la création initiale."
    ]
  },
  {
    slug: "garagiste", nom: "garagiste", article: "un garagiste", pluriel: "garagistes",
    urgence: "une panne, un contrôle technique à préparer ou un devis à comparer",
    requete: "garage auto",
    probleme: "Le garage est le commerce local où la méfiance sur les prix est la plus forte : les avis mentionnant l'honnêteté du devis sont de l'or. Une réponse professionnelle à un avis accusant une « facture gonflée » peut littéralement sauver des dizaines de clients.",
    conseils: [
      "Répondez à tout avis évoquant un prix avec des faits calmes (devis accepté, pièces, main-d'œuvre) et une invitation à repasser.",
      "Les avis citant une marque de véhicule améliorent votre visibilité sur « garage + marque + ville » : remerciez en reprenant la marque.",
      "Affichez un QR code d'avis Google à la caisse : le moment de la restitution des clés est le pic de satisfaction."
    ]
  },
  {
    slug: "carreleur", nom: "carreleur", article: "un carreleur", pluriel: "carreleurs",
    urgence: "une salle de bain, une crédence ou un sol à poser",
    requete: "carreleur",
    probleme: "Le carrelage ne pardonne rien : un joint irrégulier se voit dix ans. Vos clients potentiels zooment sur vos photos d'avis avant de vous appeler. La combinaison photos nettes + avis détaillés + réponses soignées est votre vitrine permanente.",
    conseils: [
      "Photographiez vos poses terminées en lumière naturelle, joints visibles : c'est votre argument n°1.",
      "Répondez aux avis en citant le format ou le matériau posé (grès cérame, faïence, XXL) : cela capte les recherches précises.",
      "Un avis mitigé sur un délai de séchage ou une reprise ? Expliquez la contrainte technique : le lecteur retiendra votre pédagogie."
    ]
  }
];

// ---------- Gabarit HTML ----------
function majuscule(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// 3 accroches tournantes pour éviter le boilerplate identique sur 120 pages
function accroche(m, v, i) {
  const variantes = [
    `À ${v.nom}, quand un particulier a ${m.urgence}, son premier réflexe est de taper « ${m.requete} ${v.nom.toLowerCase()} » sur Google. Ce qu'il voit alors — votre note, vos avis, vos réponses — décide s'il vous appelle ou s'il appelle votre concurrent.`,
    `Chercher « ${m.requete} ${v.nom.toLowerCase()} » sur Google : c'est le point de départ de la quasi-totalité de vos futurs clients à ${v.nom} et dans ${v.dep}. Avant même de comparer les devis, ils comparent les fiches — la vôtre est-elle à la hauteur ?`,
    `Dans ${v.dep}, un ${m.nom} se choisit d'abord sur Google : note, nombre d'avis, et surtout la manière dont l'artisan répond. À ${v.nom}, où l'offre est dense, ces trois signaux font la différence entre un téléphone qui sonne et un téléphone muet.`
  ];
  return variantes[i % variantes.length];
}

function pageHtml(m, v, indexVariante, autresVilles) {
  const titre = `Avis Google ${m.nom} à ${v.nom} — audit gratuit de votre fiche`;
  const desc = `${majuscule(m.nom)} à ${v.nom} : découvrez la note de votre fiche Google sur 100 (audit gratuit en 30 s), répondez à vos avis en 10 secondes et passez devant vos concurrents locaux.`;
  const url = `${DOMAINE}/local/${m.slug}-${v.slug}.html`;
  const liensVilles = autresVilles
    .map(av => `<a href="/local/${m.slug}-${av.slug}.html">${m.nom} à ${av.nom}</a>`)
    .join(" · ");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titre}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${titre}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="article">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Archivo+Black&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/blog.css">
<script src="/assets/consent.js" defer></script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": ${JSON.stringify(titre)},
  "description": ${JSON.stringify(desc)},
  "url": ${JSON.stringify(url)},
  "inLanguage": "fr-FR",
  "isPartOf": { "@type": "WebSite", "name": "Artisan 5 Étoiles", "url": "${DOMAINE}" }
}
</script>
</head>
<body>
<header>
  <div class="wrap nav">
    <a class="logo" href="/">ARTISAN <span>5 ÉTOILES</span></a>
    <nav class="navlinks">
      <a href="/audit.html">Audit gratuit</a>
      <a href="/blog/">Blog</a>
      <a class="cta" href="/#kit">Le Système — 29 €</a>
    </nav>
  </div>
</header>

<div class="wrap-narrow">
  <div class="breadcrumb">
    <a href="/">Accueil</a> › <a href="/metiers/${m.slug}.html">${majuscule(m.nom)}</a> › ${v.nom}
  </div>
</div>

<div class="wrap-narrow">
  <article>
    <span class="tag">${v.region}</span>
    <h1>Avis Google pour ${m.article} à ${v.nom}</h1>
    <p class="chapo">${accroche(m, v, indexVariante)}</p>

    <h2>Ce qui se joue sur votre fiche Google à ${v.nom}</h2>
    <p>${m.probleme}</p>
    <p>Le classement local de Google (le « pack » de 3 fiches affiché en haut des résultats pour
    « ${m.requete} ${v.nom.toLowerCase()} ») repose sur trois piliers : la pertinence de votre fiche, votre
    proximité avec le client, et votre notoriété — dont vos avis et vos <strong>réponses aux avis</strong> sont
    le cœur. À ${v.nom} comme partout en ${v.region}, la plupart des ${m.pluriel} laissent leurs avis sans
    réponse : c'est précisément votre opportunité.</p>

    <div class="convert">
      <div class="kicker">Gratuit · 30 secondes</div>
      <h2>Quel est le score de VOTRE fiche ?</h2>
      <p>Entrez le nom de votre entreprise : note sur 100, détail critère par critère,
      et vos priorités d'action personnalisées.</p>
      <div class="btnrow">
        <a class="btn solid" href="/audit.html">AUDITER MA FICHE GOOGLE</a>
      </div>
    </div>

    <h2>3 leviers concrets pour ${m.article} à ${v.nom}</h2>
    <ol>
      <li>${m.conseils[0]}</li>
      <li>${m.conseils[1]}</li>
      <li>${m.conseils[2]}</li>
    </ol>

    <h2>Répondre à chaque avis, sans y passer vos soirées</h2>
    <p>Notre générateur gratuit rédige une réponse professionnelle et personnalisée à n'importe quel avis
    — positif, négatif ou mitigé — en 10 secondes, adaptée à votre métier de ${m.nom} et à votre ville.
    Collez l'avis, choisissez le ton, publiez.</p>
    <div class="btnrow" style="margin-bottom:26px">
      <a class="btn" href="/#outil">Essayer le générateur (gratuit, sans inscription)</a>
    </div>

    <h2>Pour aller plus loin</h2>
    <ul>
      <li><a href="/metiers/${m.slug}.html">Gérer ses avis Google quand on est ${m.nom} : le guide complet</a></li>
      <li><a href="/blog/repondre-avis-google-negatif.html">Répondre à un avis négatif : 7 exemples pour artisans</a></li>
      <li><a href="/blog/referencement-local-artisan-google.html">Sortir 1er sur « ${m.requete} + ville » : le référencement local</a></li>
    </ul>

    <p style="font-size:14px;color:#5C6470;line-height:1.8"><strong>${majuscule(m.nom)} dans d'autres villes :</strong> ${liensVilles}</p>
  </article>
</div>

<footer>
  <div class="wrap">
    <div>© 2026 Artisan 5 Étoiles</div>
    <div>Contact : contact@artisan5etoiles.fr · <a href="/mentions-legales.html">Mentions légales</a></div>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- Génération ----------
if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER);

let compteur = 0;
const urlsLocales = [];
METIERS.forEach((m, im) => {
  VILLES.forEach((v, iv) => {
    const autres = VILLES.filter(x => x.slug !== v.slug);
    const html = pageHtml(m, v, im + iv, autres);
    const fichier = path.join(DOSSIER, `${m.slug}-${v.slug}.html`);
    fs.writeFileSync(fichier, html, "utf-8");
    urlsLocales.push(`${DOMAINE}/local/${m.slug}-${v.slug}.html`);
    compteur++;
  });
});
console.log(`${compteur} pages locales générées dans /local/`);

// ---------- Maillage : lien "villes" sur chaque page métier ----------
METIERS.forEach(m => {
  const fichierMetier = path.join(RACINE, "metiers", `${m.slug}.html`);
  if (!fs.existsSync(fichierMetier)) return;
  let src = fs.readFileSync(fichierMetier, "utf-8");
  const MARQUEUR_DEBUT = "<!-- villes:debut -->";
  const MARQUEUR_FIN = "<!-- villes:fin -->";
  const bloc =
    `${MARQUEUR_DEBUT}\n<section class="wrap" style="max-width:760px;margin:0 auto 40px;padding:0 20px">\n` +
    `<h2 style="font-family:'Archivo Black',sans-serif;font-size:20px;color:#1B2A4A;margin-bottom:10px">${majuscule(m.nom)} : conseils par ville</h2>\n` +
    `<p style="font-size:15px;line-height:1.7">` +
    VILLES.map(v => `<a href="/local/${m.slug}-${v.slug}.html">${v.nom}</a>`).join(" · ") +
    `</p>\n</section>\n${MARQUEUR_FIN}`;

  if (src.includes(MARQUEUR_DEBUT)) {
    // Régénération : on remplace le bloc existant
    src = src.replace(new RegExp(`${MARQUEUR_DEBUT}[\\s\\S]*?${MARQUEUR_FIN}`), bloc);
  } else {
    // Première insertion : juste avant le footer
    const ancre = src.lastIndexOf("<footer");
    if (ancre === -1) return;
    src = src.slice(0, ancre) + bloc + "\n" + src.slice(ancre);
  }
  fs.writeFileSync(fichierMetier, src, "utf-8");
});
console.log("Maillage interne ajouté sur les 10 pages métiers");

// ---------- Régénération complète du sitemap ----------
const urlsFixes = [
  { loc: `${DOMAINE}/`, prio: "1.0", freq: "weekly" },
  { loc: `${DOMAINE}/audit.html`, prio: "0.9", freq: "weekly" },
  { loc: `${DOMAINE}/blog/`, prio: "0.9", freq: "weekly" }
];
const urlsBlog = [
  "repondre-avis-google-negatif", "obtenir-plus-avis-google-artisan",
  "optimiser-fiche-google-business-artisan", "supprimer-faux-avis-google",
  "referencement-local-artisan-google"
].map(s => ({ loc: `${DOMAINE}/blog/${s}.html`, prio: "0.8", freq: "monthly", mod: "2026-07-13" }));
const urlsMetiers = METIERS.map(m =>
  ({ loc: `${DOMAINE}/metiers/${m.slug}.html`, prio: "0.8", freq: "monthly", mod: AUJOURDHUI }));
const urlsLoc = urlsLocales.map(u => ({ loc: u, prio: "0.6", freq: "monthly", mod: AUJOURDHUI }));

const toutes = [...urlsFixes, ...urlsBlog, ...urlsMetiers, ...urlsLoc];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  toutes.map(u =>
    `  <url><loc>${u.loc}</loc>` +
    (u.mod ? `<lastmod>${u.mod}</lastmod>` : "") +
    `<changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`
  ).join("\n") +
  `\n</urlset>\n`;
fs.writeFileSync(path.join(RACINE, "sitemap.xml"), sitemap, "utf-8");
console.log(`sitemap.xml régénéré : ${toutes.length} URLs (dont audit.html et ${urlsLocales.length} pages locales)`);
