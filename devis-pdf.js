// Génération du PDF de devis L'Auto-Mobile à partir d'une soumission Netlify Forms.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO_BASE64 = require('./logo');

const VERT = rgb(0.078, 0.616, 0.467);   // #149d77
const ENCRE = rgb(0.10, 0.14, 0.20);
const GRIS = rgb(0.42, 0.47, 0.53);
const TRAIT = rgb(0.85, 0.87, 0.89);

const ENTREPRISE = {
  nom: "L'Auto-Mobile",
  activite: 'Nettoyage auto à domicile · Île-de-France',
  adresse: 'Meudon-la-Forêt (92360)',
  siret: 'SIRET 103 998 696 00019',
  tel: '06 27 82 39 81',
  email: 'contact@lauto-mobile-nettoyage.com',
  site: 'lauto-mobile-nettoyage.com',
};

const LIBELLES_HORAIRE = {
  matin: 'Matin (8h – 12h)',
  midi: 'Milieu de journée (12h – 14h)',
  'apres-midi': 'Après-midi (14h – 18h)',
  soiree: 'Soirée (18h – 20h)',
};

// pdf-lib + Helvetica encode en WinAnsi : on remplace ce qui n'y figure pas.
function assainir(valeur) {
  if (valeur === undefined || valeur === null) return '';
  return String(valeur)
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF\u20AC]/g, '')
    .trim();
}

function couper(texte, police, taille, largeurMax) {
  const lignes = [];
  for (const paragraphe of assainir(texte).split('\n')) {
    let courante = '';
    for (const mot of paragraphe.split(/\s+/)) {
      const essai = courante ? courante + ' ' + mot : mot;
      if (police.widthOfTextAtSize(essai, taille) > largeurMax && courante) {
        lignes.push(courante);
        courante = mot;
      } else {
        courante = essai;
      }
    }
    lignes.push(courante);
  }
  return lignes;
}

function numeroDevis(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `DEV-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

function dateFr(valeur) {
  if (!valeur) return '';
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return assainir(valeur);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function genererDevisPdf(donnees, dateSoumission) {
  const d = donnees || {};
  const emis = dateSoumission ? new Date(dateSoumission) : new Date();
  const numero = numeroDevis(emis);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);

  const MARGE = 48;
  const LARGEUR = width - MARGE * 2;
  let y = height - MARGE;

  const ecrire = (texte, { x = MARGE, taille = 10, police = normal, couleur = ENCRE } = {}) => {
    page.drawText(assainir(texte), { x, y, size: taille, font: police, color: couleur });
  };

  // --- En-tête : logo + coordonnées ---
  const logo = await pdf.embedPng(Buffer.from(LOGO_BASE64, 'base64'));
  const hLogo = 62;
  const wLogo = (logo.width / logo.height) * hLogo;
  page.drawImage(logo, { x: MARGE, y: y - hLogo + 16, width: wLogo, height: hLogo });
  const xTxt = MARGE + wLogo + 14;
  ecrire(ENTREPRISE.nom, { x: xTxt, taille: 20, police: gras, couleur: ENCRE });
  y -= 15;
  ecrire(ENTREPRISE.activite, { x: xTxt, taille: 9, couleur: GRIS });
  y -= 12;
  ecrire(`${ENTREPRISE.adresse} · ${ENTREPRISE.tel}`, { x: xTxt, taille: 9, couleur: GRIS });
  y -= 12;
  ecrire(`${ENTREPRISE.email} · ${ENTREPRISE.siret}`, { x: xTxt, taille: 9, couleur: GRIS });

  const yTitre = height - MARGE;
  const titre = 'DEVIS';
  page.drawText(titre, {
    x: width - MARGE - gras.widthOfTextAtSize(titre, 20),
    y: yTitre, size: 20, font: gras, color: ENCRE,
  });
  const sousTitre = `${numero}`;
  page.drawText(sousTitre, {
    x: width - MARGE - normal.widthOfTextAtSize(sousTitre, 9),
    y: yTitre - 15, size: 9, font: normal, color: GRIS,
  });
  const ligneDate = `Émis le ${emis.toLocaleDateString('fr-FR')}`;
  page.drawText(assainir(ligneDate), {
    x: width - MARGE - normal.widthOfTextAtSize(assainir(ligneDate), 9),
    y: yTitre - 27, size: 9, font: normal, color: GRIS,
  });

  y -= 26;
  page.drawLine({ start: { x: MARGE, y }, end: { x: width - MARGE, y }, thickness: 1, color: TRAIT });
  y -= 26;

  // --- Bloc client ---
  ecrire('CLIENT', { taille: 8, police: gras, couleur: VERT });
  y -= 15;
  const nomClient = [d.prenom, d.nom].filter(Boolean).join(' ') || 'Non renseigné';
  ecrire(nomClient, { taille: 12, police: gras });
  y -= 14;
  for (const ligne of [d.email, d.telephone, d.adresse].filter(Boolean)) {
    for (const bout of couper(ligne, normal, 10, LARGEUR * 0.6)) {
      ecrire(bout, { taille: 10, couleur: GRIS });
      y -= 13;
    }
  }

  y -= 12;

  // --- Sections en lignes clé / valeur ---
  const section = (titreSection, lignes) => {
    ecrire(titreSection, { taille: 8, police: gras, couleur: VERT });
    y -= 16;
    for (const [cle, valeur] of lignes) {
      if (!valeur) continue;
      ecrire(cle, { taille: 10, couleur: GRIS });
      const xValeur = MARGE + 165;
      const bouts = couper(valeur, normal, 10, LARGEUR - 165);
      bouts.forEach((bout, i) => {
        page.drawText(assainir(bout), {
          x: xValeur, y: y - i * 13, size: 10, font: normal, color: ENCRE,
        });
      });
      y -= 13 * bouts.length + 3;
    }
    y -= 10;
  };

  section('VÉHICULE', [
    ['Type', d.type_vehicule],
    ['Marque et modèle', d.modele],
  ]);

  section('INTERVENTION', [
    ['Adresse', d.adresse],
    ['Date souhaitée', dateFr(d.date)],
    ['Créneau', LIBELLES_HORAIRE[d.horaire] || d.horaire],
  ]);

  // --- Prestation et total ---
  ecrire('PRESTATION', { taille: 8, police: gras, couleur: VERT });
  y -= 18;
  page.drawRectangle({
    x: MARGE, y: y - 4, width: LARGEUR, height: 22, color: rgb(0.96, 0.97, 0.97),
  });
  ecrire('Désignation', { x: MARGE + 10, taille: 9, police: gras, couleur: GRIS });
  const entete = 'Montant';
  page.drawText(entete, {
    x: width - MARGE - 10 - gras.widthOfTextAtSize(entete, 9),
    y, size: 9, font: gras, color: GRIS,
  });
  y -= 24;

  const formule = assainir(d.gamme) || 'Prestation à définir';
  for (const bout of couper(formule, normal, 10, LARGEUR - 130)) {
    ecrire(bout, { x: MARGE + 10, taille: 10 });
    y -= 14;
  }

  const options = assainir(d.options_choisies);
  if (options && options.toLowerCase() !== 'aucune') {
    y -= 2;
    ecrire('Options retenues :', { x: MARGE + 10, taille: 9, police: gras, couleur: GRIS });
    y -= 13;
    for (const option of options.split(/\s*[;,|]\s*/).filter(Boolean)) {
      for (const bout of couper('• ' + option, normal, 9, LARGEUR - 140)) {
        ecrire(bout, { x: MARGE + 18, taille: 9, couleur: GRIS });
        y -= 12;
      }
    }
  }

  y -= 8;
  page.drawLine({ start: { x: MARGE, y }, end: { x: width - MARGE, y }, thickness: 0.5, color: TRAIT });
  y -= 20;

  const total = assainir(d.total_estime) || 'Sur devis';
  const libelleTotal = 'Total estimé';
  ecrire(libelleTotal, { x: MARGE + 10, taille: 11, police: gras });
  page.drawText(assainir(total), {
    x: width - MARGE - 10 - gras.widthOfTextAtSize(assainir(total), 13),
    y: y - 1, size: 13, font: gras, color: VERT,
  });
  y -= 16;
  ecrire('TVA non applicable, art. 293 B du CGI', { x: MARGE + 10, taille: 8, couleur: GRIS });
  y -= 24;

  // --- Message du client ---
  const message = assainir(d.message);
  if (message) {
    ecrire('PRÉCISIONS DU CLIENT', { taille: 8, police: gras, couleur: VERT });
    y -= 15;
    for (const bout of couper(message, normal, 10, LARGEUR)) {
      ecrire(bout, { taille: 10 });
      y -= 13;
      if (y < 150) break;
    }
    y -= 12;
  }

  // --- Conditions ---
  const conditions = [
    'Montant estimatif établi sur la base des informations transmises. Il pourra être ajusté après constat de l\'état réel du véhicule.',
    'Le règlement s\'effectue à la fin de l\'intervention, en espèces ou par carte bancaire.',
    'Devis valable 30 jours. Annulation gratuite jusqu\'à 2h avant le rendez-vous.',
    'Intervention réalisée sur place, en autonomie complète : eau et électricité fournies par L\'Auto-Mobile.',
  ];
  if (y > 120) {
    ecrire('CONDITIONS', { taille: 8, police: gras, couleur: VERT });
    y -= 14;
    for (const condition of conditions) {
      for (const bout of couper(condition, normal, 8, LARGEUR)) {
        ecrire(bout, { taille: 8, couleur: GRIS });
        y -= 10;
      }
      y -= 2;
    }
  }

  // --- Pied de page ---
  const pied = `${ENTREPRISE.nom} · ${ENTREPRISE.siret} · ${ENTREPRISE.tel} · ${ENTREPRISE.email}`;
  page.drawText(assainir(pied), {
    x: MARGE, y: 36, size: 7.5, font: normal, color: GRIS,
  });

  const octets = await pdf.save();
  return { pdf: Buffer.from(octets), numero, nomClient };
}

module.exports = { genererDevisPdf, assainir };
