# ⚡ AGENT COMMERCIAL A5E — v2 "machine de guerre"

## Ce qui change par rapport à la v1
TOUT tourne désormais sur Vercel. Plus jamais de terminal, plus de CSV,
plus de scripts à lancer. Un seul cron quotidien fait tout :

1. **Sourcing** : balaye la grille SIRENE (120 couples métier×ville) en
   continu, ~6 couples/jour, et se RELANCE SEUL le 1er de chaque mois
2. **Enrichissement** : pour chaque artisan, devine son site web
   (plomberiemartin.fr, plomberie-martin.com...), VÉRIFIE que le site
   parle bien de lui (garde anti-homonyme), extrait l'e-mail publié
3. **Envoi** : 20 e-mails/jour ouvré max, séquence J0 → J+4 → J+10,
   compteur global en Redis (aucun dépassement possible même si le
   cron tourne deux fois)

## Tableau de bord (depuis votre téléphone)
https://artisan5etoiles.fr/api/prospection-board?s=VOTRE_CRON_SECRET
→ compteurs, progression du balayage, 30 derniers envois, état ACTIF/PAUSE.
(Remplacez VOTRE_CRON_SECRET par la valeur de la variable CRON_SECRET
dans Vercel. Gardez ce lien en favori, ne le partagez pas.)

## Fichiers
```
api/prospection-daily.js    ← l'orchestrateur (remplace prospection-cron.js)
api/prospection-board.js    ← le tableau de bord
api/desinscription.js       ← désinscription 1 clic (inchangé)
lib/prospection.js          ← moteur partagé
templates/emails-prospection.js
package.json                ← dépendance nodemailer
```
Les anciens fichiers à SUPPRIMER du dépôt : api/prospection-cron.js
et le dossier scripts/prospection/ (remplacés par la version serveur).

## vercel.json
```
"functions": {
  "api/generate.js": { "maxDuration": 15 },
  "api/audit.js": { "maxDuration": 25 },
  "api/prospection-daily.js": { "maxDuration": 60 }
},
"crons": [
  { "path": "/api/sentinel-check", "schedule": "0 9 * * *" },
  { "path": "/api/prospection-daily", "schedule": "30 9 * * *" }
]
```

## Variables d'environnement (Vercel → Settings → Environment Variables)
```
PROSPECTION_ACTIVE = non          ← "oui" après le warm-up (3-4 semaines)
SMTP_HOST          = smtp.ionos.fr
SMTP_USER          = contact@a5e-conseil.fr
SMTP_PASS          = (mot de passe de la boîte IONOS)
REPLY_TO           = contact@a5e-conseil.fr
```
Les autres (CRON_SECRET, BADGE_SECRET, KV_*) existent déjà.

## Ce qui reste humain (et le restera)
- Le warm-up de la boîte (3-4 semaines d'e-mails normaux) — incompressible
- Passer PROSPECTION_ACTIVE à "oui" quand le warm-up est fini
- Répondre aux artisans qui répondent (c'est le but !)

## Honnêteté sur les chiffres
La découverte automatique de sites par déduction du nom trouve un e-mail
pour environ 20-40 % des prospects (beaucoup d'artisans n'ont pas de site,
ou un site sans e-mail). Les autres sont archivés, visibles sur le board.
Même à 25 %, la grille mensuelle SIRENE alimente largement les
20 envois/jour. La machine privilégie la SÛRETÉ (anti-homonyme strict)
au volume : mieux vaut rater un prospect que d'écrire au mauvais.
