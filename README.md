# Artisan 5 Étoiles — Guide de mise en ligne (pas à pas, sans coder)

Temps total : environ 1 heure. Coût : 0 € pour démarrer (hébergement gratuit), ~10 €/an pour le nom de domaine, ~5-10 €/mois d'API selon le trafic.

## Étape 1 — Mettre le site en ligne (gratuit, 15 min)

1. Créez un compte gratuit sur **vercel.com** (connectez-vous avec GitHub ou un email).
2. Créez un compte gratuit sur **github.com** si vous n'en avez pas.
3. Sur GitHub : « New repository » → nommez-le `artisan5etoiles` → créez-le → « uploading an existing file » → glissez-déposez le contenu de ce dossier (`index.html`, le dossier `api/`, `vercel.json`) → « Commit ».
4. Sur Vercel : « Add New Project » → importez le dépôt `artisan5etoiles` → « Deploy ».
5. Votre site est en ligne sur une adresse du type `artisan5etoiles.vercel.app`.

## Étape 2 — Activer l'IA (10 min)

1. Créez un compte sur **console.anthropic.com** → « API Keys » → créez une clé.
2. Ajoutez du crédit (5 € suffisent largement pour commencer : chaque réponse générée coûte une fraction de centime avec le modèle Haiku).
3. Sur Vercel : votre projet → « Settings » → « Environment Variables » → ajoutez :
   - Nom : `ANTHROPIC_API_KEY`
   - Valeur : votre clé
4. « Deployments » → « Redeploy ». Testez le générateur sur votre site : il doit fonctionner.

## Étape 3 — Vendre le kit en automatique (20 min)

1. Créez un compte gratuit sur **gumroad.com** (ou Payhip, équivalent).
2. « New product » → type « Digital » → uploadez le fichier `Artisan-5-Etoiles-Kit-Avis-Google.pdf`.
3. Prix : 29 €. Rédigez la description (reprenez les puces de la section « kit » du site).
4. Ajoutez vos informations de paiement (virement bancaire) pour recevoir l'argent.
5. Copiez le lien du produit Gumroad.
6. Dans `index.html`, remplacez `LIEN_GUMROAD_ICI` par ce lien (2 endroits possibles : cherchez le texte). Remplacez aussi `VOTRE-EMAIL@exemple.fr` par votre email de contact. Re-uploadez le fichier sur GitHub → Vercel redéploie automatiquement.

À partir de là, la vente est 100 % automatique : paiement, livraison du PDF, facturation — Gumroad gère tout.

## Étape 4 — Nom de domaine (optionnel mais recommandé, 10 min, ~10 €/an)

1. Achetez un domaine (ex. `artisan5etoiles.fr`) chez OVH, Gandi ou Namecheap.
2. Sur Vercel : projet → « Settings » → « Domains » → ajoutez le domaine et suivez les instructions DNS.

## Étape 5 — Avant de vendre : le PDF

Ouvrez le PDF et sur la dernière page, remplacez `[VOTRE-SITE.fr]` par l'adresse réelle de votre site (demandez à Claude de régénérer le PDF avec votre URL, ou éditez le fichier source `build_pdf.py`).

## Obligations légales (France) — à ne pas sauter

- Pour encaisser des revenus, déclarez une **micro-entreprise** (gratuit, en ligne sur formalites.entreprises.gouv.fr, activité « vente de produits numériques / services numériques »).
- Ajoutez des **mentions légales** et **CGV** sur le site (des générateurs gratuits existent ; votre statut micro-entrepreneur, SIRET, contact).
- Gumroad collecte la TVA européenne à votre place sur les ventes de produits numériques : un souci en moins.

## Maîtriser les coûts de l'API

- Le modèle utilisé (Haiku) est le moins cher ; une génération ≈ 0,001-0,003 €.
- Sur console.anthropic.com, fixez une **limite de dépense mensuelle** (ex. 10 €).
- Si un jour l'outil est massivement utilisé : bonne nouvelle, c'est du trafic — ajoutez alors une limite de générations par visiteur ou une version Pro payante.
