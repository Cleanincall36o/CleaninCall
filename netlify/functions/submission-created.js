// Déclenchée automatiquement par Netlify à chaque soumission de formulaire.
// Génère le devis en PDF et l'envoie par e-mail.
// Fonctionne avec Brevo ou avec Resend : le service utilisé est celui dont
// la clé est présente dans les variables d'environnement (Brevo prioritaire).
const { genererDevisPdf, assainir } = require('./devis-pdf');

const DESTINATAIRE = process.env.DEVIS_EMAIL_TO || 'cleanincall@gmail.com';
const NOM_EXPEDITEUR = process.env.DEVIS_EMAIL_NOM || "L'Auto-Mobile";
const ADRESSE_EXPEDITEUR = process.env.DEVIS_EMAIL_FROM || 'cleanincall@gmail.com';

const LIBELLES = {
  gamme: 'Formule',
  options_choisies: 'Options',
  total_estime: 'Total estimé',
  type_vehicule: 'Type de véhicule',
  modele: 'Marque et modèle',
  prenom: 'Prénom',
  nom: 'Nom',
  email: 'E-mail',
  telephone: 'Téléphone',
  adresse: 'Adresse',
  date: 'Date souhaitée',
  horaire: 'Créneau',
  message: 'Précisions',
};

function echapper(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function corpsHtml(donnees) {
  const lignes = Object.keys(LIBELLES)
    .filter((cle) => donnees[cle] !== undefined && donnees[cle] !== '' && donnees[cle] !== null)
    .map((cle) => `<tr>
        <td style="padding:6px 14px 6px 0;color:#6b7680;font-size:13px;white-space:nowrap;vertical-align:top">${LIBELLES[cle]}</td>
        <td style="padding:6px 0;color:#1a2433;font-size:13px">${echapper(donnees[cle])}</td>
      </tr>`)
    .join('');

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">
    <p style="font-size:15px;color:#1a2433;margin:0 0 4px">Nouvelle demande de devis</p>
    <p style="font-size:13px;color:#6b7680;margin:0 0 18px">Le PDF joint est prêt à être transféré au client.</p>
    <table style="border-collapse:collapse;width:100%">${lignes}</table>
  </div>`;
}

const TELEPHONE = '06 27 82 39 81';
const SITE = 'https://lauto-mobile-nettoyage.com';

function adresseValide(adresse) {
  return typeof adresse === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(adresse.trim());
}

// E-mail de confirmation envoyé au client
function corpsConfirmationClient(donnees) {
  const recap = ['gamme', 'options_choisies', 'type_vehicule', 'modele', 'adresse', 'date', 'horaire']
    .filter((cle) => donnees[cle] !== undefined && donnees[cle] !== '' && donnees[cle] !== null)
    .map((cle) => `<tr>
        <td style="padding:6px 14px 6px 0;color:#6b7680;font-size:13px;white-space:nowrap;vertical-align:top">${LIBELLES[cle]}</td>
        <td style="padding:6px 0;color:#1a2433;font-size:13px">${echapper(donnees[cle])}</td>
      </tr>`)
    .join('');
  const total = donnees.total_estime
    ? `<p style="font-size:13px;color:#1a2433;margin:16px 0 0">Estimation indicative : <strong>${echapper(donnees.total_estime)}</strong><br>
       <span style="color:#6b7680">Le tarif définitif vous sera confirmé selon l'état du véhicule.</span></p>`
    : '';
  const prenom = donnees.prenom ? ` ${echapper(donnees.prenom)}` : '';

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1a2433">
    <p style="font-size:15px;margin:0 0 14px">Bonjour${prenom},</p>
    <p style="font-size:14px;line-height:1.55;margin:0 0 14px">Merci pour votre demande de devis, je l'ai bien reçue.
      Je reviens vers vous rapidement pour confirmer le rendez-vous et le tarif.</p>
    <p style="font-size:13px;color:#6b7680;margin:18px 0 6px">Récapitulatif de votre demande</p>
    <table style="border-collapse:collapse;width:100%">${recap}</table>
    ${total}
    <p style="font-size:14px;line-height:1.55;margin:22px 0 0">Pour toute question, répondez simplement à cet e-mail
      ou appelez-moi au ${TELEPHONE}.</p>
    <p style="font-size:14px;margin:18px 0 0">À bientôt,<br><strong>Axel — L'Auto-Mobile</strong><br>
      <a href="${SITE}" style="color:#2e7d32">lauto-mobile-nettoyage.com</a></p>
  </div>`;
}

// --- Brevo ---
async function envoyerViaBrevo(cle, { destinataire, sujet, html, repondreA, nomFichier, pdfBase64 }) {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': cle,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: NOM_EXPEDITEUR, email: ADRESSE_EXPEDITEUR },
      to: [{ email: destinataire }],
      replyTo: repondreA ? { email: repondreA } : undefined,
      subject: sujet,
      htmlContent: html,
      attachment: pdfBase64 ? [{ name: nomFichier, content: pdfBase64 }] : undefined,
    }),
  });
}

// --- Resend ---
async function envoyerViaResend(cle, { destinataire, sujet, html, repondreA, nomFichier, pdfBase64 }) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cle}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${NOM_EXPEDITEUR} <${ADRESSE_EXPEDITEUR}>`,
      to: [destinataire],
      reply_to: repondreA ? [repondreA] : undefined,
      subject: sujet,
      html,
      attachments: pdfBase64 ? [{ filename: nomFichier, content: pdfBase64 }] : undefined,
    }),
  });
}

exports.handler = async (event) => {
  let donnees = {};
  let dateSoumission = null;

  try {
    const corps = JSON.parse(event.body || '{}');
    const charge = corps.payload || corps;
    donnees = charge.data || {};
    dateSoumission = charge.created_at || null;
  } catch (erreur) {
    console.error('Charge utile illisible :', erreur);
    return { statusCode: 400, body: 'Charge utile invalide' };
  }

  const cleBrevo = process.env.BREVO_API_KEY;
  const cleResend = process.env.RESEND_API_KEY;
  if (!cleBrevo && !cleResend) {
    console.error("Aucune clé API : renseigner BREVO_API_KEY ou RESEND_API_KEY dans les variables d'environnement Netlify.");
    return { statusCode: 500, body: 'Clé API manquante' };
  }
  const service = cleBrevo ? 'Brevo' : 'Resend';

  try {
    const { pdf, numero, nomClient } = await genererDevisPdf(donnees, dateSoumission);

    const envoyer = (message) => (cleBrevo ? envoyerViaBrevo(cleBrevo, message) : envoyerViaResend(cleResend, message));

    // 1. Le devis PDF pour Axel
    const reponse = await envoyer({
      destinataire: DESTINATAIRE,
      sujet: `Devis ${numero} — ${assainir(nomClient)}`,
      html: corpsHtml(donnees),
      repondreA: adresseValide(donnees.email) ? donnees.email.trim() : null,
      nomFichier: `Devis_${numero}_${assainir(nomClient).replace(/\s+/g, '_') || 'client'}.pdf`,
      pdfBase64: pdf.toString('base64'),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error(`Refus de ${service} (devis) :`, reponse.status, detail);
      return { statusCode: 502, body: 'Envoi refusé' };
    }
    console.log(`Devis ${numero} envoyé à ${DESTINATAIRE} via ${service}`);

    // 2. La confirmation pour le client (un échec ici ne bloque pas le devis)
    if (adresseValide(donnees.email)) {
      try {
        const confirmation = await envoyer({
          destinataire: donnees.email.trim(),
          sujet: "Votre demande de devis a bien été reçue — L'Auto-Mobile",
          html: corpsConfirmationClient(donnees),
          repondreA: DESTINATAIRE,
        });
        if (confirmation.ok) {
          console.log(`Confirmation envoyée au client (${donnees.email.trim()})`);
        } else {
          console.error(`Refus de ${service} (confirmation client) :`, confirmation.status, await confirmation.text());
        }
      } catch (erreurConfirmation) {
        console.error('Échec de la confirmation client :', erreurConfirmation);
      }
    } else {
      console.log('Pas d\'adresse e-mail client valide : aucune confirmation envoyée');
    }

    return { statusCode: 200, body: 'Devis envoyé' };
  } catch (erreur) {
    console.error("Échec de la génération ou de l'envoi :", erreur);
    return { statusCode: 500, body: 'Erreur interne' };
  }
};
