# AGENT COMMERCIAL A5E — Mode d'emploi complet

Système de prospection sortante automatisée : sourcing SIRENE → enrichissement
e-mail → séquence de 3 e-mails → réponses dans votre boîte. Coût : ~12 €/an
(le domaine dédié). Tout le reste tourne sur votre infra existante.

## Architecture

```
SIRENE (open data État)          [extraire-prospects.js]
        ↓ prospects.csv
Sites des artisans               [enrichir-emails.js]
        ↓ prospects-enrichis.csv
Redis Upstash (file d'attente)   [charger-file.js]
        ↓
Cron Vercel quotidien 20/jour    [api/prospection-cron.js]
        ↓ e-mails J0 / J+4 / J+10
Réponses → contact@artisan5etoiles.fr (reply-to)
Désinscriptions → api/desinscription.js → liste d'opposition Redis
```

## ⚠️ AVANT TOUT ENVOI — checklist non négociable

1. **Domaine dédié acheté** (ex. `a5e-conseil.fr`) — JAMAIS artisan5etoiles.fr.
   Le cron REFUSE d'ailleurs techniquement d'envoyer depuis le domaine principal.
2. **Boîte mail créée** dessus chez IONOS (ex. `mike@a5e-conseil.fr`).
3. **SPF / DKIM / DMARC configurés** : IONOS → Domaines → E-mail → ces trois
   enregistrements DNS s'activent en quelques clics. Sans eux, 100 % spam.
4. **Warm-up 3 à 4 semaines** : depuis la nouvelle boîte, envoyez chaque jour
   quelques e-mails NORMAUX à des adresses réelles qui répondent (la vôtre,
   des proches, des partenaires). Semaine 1 : 3-5/jour. Semaine 2 : 8-10.
   Semaine 3 : 15. Semaine 4 : premiers envois de prospection.
   PROSPECTION_ACTIVE reste sur "non" pendant tout le warm-up.
5. **Redirection des réponses** : reply-to configuré vers
   contact@artisan5etoiles.fr (variable REPLY_TO) — vous répondez comme d'habitude.

## Installation (une fois)

1. Copier les fichiers dans le dépôt :
   - `api/prospection-cron.js`, `api/desinscription.js`
   - `templates/emails-prospection.js`
   - `scripts/prospection/*.js`
   - `package.json` (dépendance nodemailer)
2. Ajouter dans `vercel.json` → "crons" :
   `{ "path": "/api/prospection-cron", "schedule": "30 9 * * 1-5" }`
   ⚠️ Plan Hobby Vercel = 1 seul cron/jour autorisé par projet en plus de
   l'existant : vérifier que les 2 crons cohabitent, sinon passer le
   sentinel-check et la prospection dans le même créneau horaire (9h-10h UTC, OK).
3. Variables d'environnement Vercel (Production) :
   ```
   PROSPECTION_ACTIVE = non        ← passer à "oui" seulement après warm-up
   SMTP_HOST          = smtp.ionos.fr
   SMTP_USER          = mike@VOTRE-DOMAINE-DEDIE.fr
   SMTP_PASS          = (mot de passe de la boîte)
   REPLY_TO           = contact@artisan5etoiles.fr
   ```

## Cycle mensuel (routine)

1. `node scripts/prospection/extraire-prospects.js`
   → data/prospects.csv (artisans actifs, 10 métiers × 12 villes, dédoublonnés)
2. Remplir la colonne `siteWeb` pour les prospects qui ont un site :
   le plus efficace = déléguer à une session **Cowork** : "pour chaque ligne du
   CSV sans siteWeb, cherche '<nom> <ville>' sur le web et colle l'URL du site
   officiel s'il existe". (~1 h de Cowork pour 200 lignes)
3. `node scripts/prospection/enrichir-emails.js`
   → extrait les contact@ publiés sur leurs propres sites
4. `KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/prospection/charger-file.js`
   → charge la file Redis (ignore automatiquement doublons et désinscrits)
5. Le cron fait le reste : 20 e-mails/jour ouvré, séquence J0 → J+4 → J+10,
   arrêt automatique par prospect au bout de 3 e-mails.

## Votre seule tâche quotidienne (5 min)

Ouvrir contact@artisan5etoiles.fr et **répondre aux artisans qui répondent**.
Si quelqu'un répond « STOP » ou négativement : cliquer son lien de
désinscription vous-même OU l'ajouter à la main dans Redis
(`SADD prospection:optout email@...`). Sa séquence s'arrête immédiatement.

## Conformité (ce qui est déjà intégré)

- Régime opt-out B2B français respecté : cibles professionnelles, message en
  lien avec leur activité, identité complète de l'expéditeur
- Source des données mentionnée dans chaque e-mail (répertoire SIRENE public)
- Lien de désinscription 1 clic + en-tête List-Unsubscribe
- Liste d'opposition permanente (jamais purgée)
- 3 e-mails maximum par prospect, puis silence définitif
- Adresses génériques (contact@) privilégiées par l'enrichisseur
- AUCUNE donnée Google Places utilisée pour le sourcing

## KPIs à surveiller (réalistes)

| Indicateur | Bon | Alerte |
|---|---|---|
| Taux d'ouverture | 40-60 % | < 25 % → problème délivrabilité, STOP et vérifier DNS |
| Taux de réponse | 3-10 % | < 1 % après 200 envois → revoir le message |
| Désinscriptions | < 2 % | > 5 % → ciblage trop large |
| Plaintes spam | 0 | 1 seule → PROSPECTION_ACTIVE=non immédiatement |

## Arrêt d'urgence

Vercel → Settings → Environment Variables → `PROSPECTION_ACTIVE` → `non`
→ effet au prochain run (aucun redéploiement nécessaire).
