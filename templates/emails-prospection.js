// templates/emails-prospection.js
// ============================================================
// AGENT COMMERCIAL A5E — Les 3 e-mails de la séquence
//
// Règles appliquées :
//   - Texte brut uniquement (meilleure délivrabilité qu'HTML en cold)
//   - 60-120 mots par e-mail, UN seul appel à l'action
//   - Personnalisation par les données SIRENE (métier, ville, ancienneté)
//   - Lien vers la PAGE LOCALE correspondante (pas la home) → cohérence
//   - Pied conforme CNIL/LCEN : identité, source des données (registre
//     SIRENE public), lien de désinscription 1 clic
//
// p = { nom, metierLibelle, ville, dateCreation, pageLocale, ... }
// ============================================================

function anciennete(dateCreation) {
  if (!dateCreation) return "";
  const annees = Math.floor((Date.now() - new Date(dateCreation).getTime()) / (365.25 * 86400000));
  if (annees >= 2) return `en ${annees} ans d'activité, `;
  return "";
}

function pied(lienOptout) {
  return `
—
Mike · Artisan 5 Étoiles · Bordeaux
artisan5etoiles.fr · contact@artisan5etoiles.fr

Vous recevez cet e-mail professionnel car votre entreprise figure au
répertoire public SIRENE (INSEE) dans un secteur concerné par nos services.
Pour ne plus recevoir de message : ${lienOptout}`;
}

export const gabarits = [

  // ---------- E-MAIL 1 (J0) : le constat local + l'audit ----------
  (p, lienOptout) => ({
    objet: `${p.ville} : vos avis Google vous coûtent peut-être des chantiers`,
    texte: `Bonjour,

${anciennete(p.dateCreation)}vous avez sûrement remarqué que vos clients arrivent
de plus en plus par Google — et qu'ils comparent 3 fiches avant d'appeler.

À ${p.ville}, la plupart des artisans en ${p.metierLibelle} laissent leurs avis
sans réponse. C'est précisément là que se perdent (ou se gagnent) des appels.

J'ai créé un outil gratuit qui note votre fiche Google sur 100 en 30 secondes,
et vous dit exactement quoi corriger en priorité :

${p.pageLocale}

Aucune inscription pour tester le score. Si le sujet ne vous concerne pas,
ignorez simplement ce message.

Bonne journée,
Mike
${pied(lienOptout)}`
  }),

  // ---------- E-MAIL 2 (J+4) : preuve concrète, angle différent ----------
  (p, lienOptout) => ({
    objet: `Re: vos avis Google (${p.ville})`,
    texte: `Bonjour,

Je me permets une relance courte.

Un chiffre concret : un client qui cherche « ${p.metierLibelle} ${p.ville.toLowerCase()} »
lit en moyenne les 3 derniers avis ET vos réponses avant de décider qui appeler.
Pas de réponse = il appelle le concurrent qui, lui, a répondu.

L'audit gratuit vous montre en 30 secondes où vous en êtes vraiment
(note, volume d'avis, réponses, photos... 7 critères notés sur 100) :

${p.pageLocale}

Si vous préférez ne plus être contacté, le lien en bas de ce message
suffit — sans rancune.

Mike
${pied(lienOptout)}`
  }),

  // ---------- E-MAIL 3 (J+10) : dernier message, porte ouverte ----------
  (p, lienOptout) => ({
    objet: `Dernier message — ${p.nom}`,
    texte: `Bonjour,

Dernier message de ma part, promis.

Si la gestion de vos avis Google n'est pas une priorité en ce moment,
c'est tout à fait entendable — je ne vous relancerai plus.

Si un jour un avis négatif tombe et que vous ne savez pas quoi répondre,
gardez cette adresse dans un coin : notre générateur rédige une réponse
professionnelle en 10 secondes, gratuitement.

${p.pageLocale}

Bonne continuation à ${p.ville},
Mike
${pied(lienOptout)}`
  })
];
