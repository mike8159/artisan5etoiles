# Déploiement v3 — pas à pas (16 juillet 2026)

## Ce que contient cette version

**Correctifs :**
1. `api/badge.js` **RECRÉÉ** — il était absent du dépôt : tous les badges renvoyaient un 404. Testé : signature HMAC compatible avec celle émise par `audit.js`, falsification et injection XML bloquées.
2. `assets/consent.js` **NOUVEAU** — bannière de consentement CNIL. Le pixel Meta ne se charge qu'après clic « Accepter ». Choix mémorisé 6 mois. Sans ça, vous étiez en infraction RGPD au moment de lancer de la pub.
3. Pixel Meta désormais présent (via consent.js) sur **toutes** les pages : blog, métiers, merci, mentions légales, pages locales — plus seulement index et audit. Vos audiences de retargeting se rempliront enfin avec le trafic SEO.
4. `vercel.json` : `maxDuration: 25` pour `api/audit.js` (avant : timeout par défaut 10 s → risque d'erreur pour l'artisan qui vient de donner son e-mail).
5. `index.html` : évènement `InitiateCheckout` ajouté sur le bouton d'achat (il n'existait que sur audit.html).
6. `api/subscribe.js` : le compteur anti-spam se remet à zéro chaque jour (avant : blocage à vie par instance) ; une adresse réellement refusée par Brevo renvoie une erreur (avant : faux succès sur tout code 400).
7. `api/audit.js` : le quota « recherche » n'est plus consommé si Google est en panne (même logique que pour l'audit).
8. `mentions-legales.html` : la phrase « pas de cookies publicitaires » (devenue fausse) est remplacée par la déclaration du pixel Meta + lien de retrait du consentement.
9. `sitemap.xml` : `audit.html` enfin déclaré + les 120 nouvelles pages.
10. `llms.txt` : l'audit gratuit y est décrit (il était invisible pour ChatGPT/Perplexity — votre meilleur aimant à prospects manquait à votre stratégie GEO).

**Nouveau système de prospects (gratuit, automatique) :**
- `/local/` : **120 pages locales** métier × ville (10 métiers × 12 grandes villes), chacune ciblant des recherches longue traîne du type « avis google plombier lyon », avec contenu spécifique au métier, CTA vers l'audit, et maillage interne complet.
- `scripts/generer-pages-locales.js` : le générateur. Pour couvrir plus de villes, ajoutez-les dans la liste `VILLES` en haut du fichier puis relancez `node scripts/generer-pages-locales.js` — pages, maillage et sitemap se régénèrent tout seuls.

## Étapes de déploiement (15 min)

### 1. Pousser sur GitHub
Remplacez le contenu du dépôt `mike8159/artisan5etoiles` par le contenu de ce dossier
(glisser-déposer sur github.com ou `git add -A && git commit -m "v3" && git push`).
Vercel redéploie automatiquement.

### 2. Vérifier le badge (2 min)
Faites un audit sur artisan5etoiles.fr/audit.html : le badge doit maintenant s'afficher
(image « Score X/100 » aux couleurs du site). Si l'image est cassée, dites-le-moi.

### 3. Vérifier la bannière (1 min)
Ouvrez le site en navigation privée : la bannière de consentement doit apparaître en bas.
« Accepter » → dans l'onglet Réseau du navigateur, `fbevents.js` se charge.
« Refuser » → il ne se charge pas.

### 4. Pixel côté Gumroad — évènement Purchase (2 min, IMPORTANT)
Gumroad → votre produit → Settings (ou Checkout) → section third-party analytics /
Facebook Pixel → collez l'ID : `3230732657316523`.
Sans ça, Meta ne verra jamais les ventes : impossible de mesurer le retour sur dépense pub.

### 5. Google Search Console (5 min — c'est le moteur du nouveau système)
1. search.google.com/search-console → propriété `artisan5etoiles.fr`
   (la balise de vérification `googleddd667d9ef0739ed.html` est déjà dans le dépôt).
2. Sitemaps → soumettre `https://artisan5etoiles.fr/sitemap.xml`.
3. C'est tout : Google découvrira et indexera les 120 pages locales en 1 à 4 semaines.

### 6. Reprendre la campagne Meta Prospects là où elle s'est arrêtée
Section « Conversion » de l'ensemble de publicités → ensemble de données =
« Artisan5Etoiles Pixel » → évènement = « Lead » → URL de destination =
`https://artisan5etoiles.fr/audit.html` → publier.

## À savoir (honnêteté commerciale)

- **Les pages locales ne produiront rien avant 4 à 12 semaines.** C'est la vitesse
  d'indexation et de classement de Google, personne n'y échappe. En contrepartie :
  zéro coût, zéro maintenance, et ça s'additionne mois après mois. C'est un actif,
  pas une campagne.
- Le consentement va réduire le volume d'évènements vus par Meta (seuls les visiteurs
  qui acceptent sont tracés — en France, comptez 50-70 % d'acceptation). C'est le prix
  de la légalité ; tous vos concurrents sérieux ont la même contrainte.
- Les quotas API restent en mémoire (par instance serverless) : ce n'est pas un vrai
  verrou, votre filet de sécurité reste le budget d'alerte Google Cloud. Le jour où le
  trafic décolle, on migrera les quotas vers Upstash Redis (déjà en place pour la
  sentinelle) — 30 minutes de travail, pas urgent.
