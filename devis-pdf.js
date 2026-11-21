// Génération du PDF de devis L'Auto-Mobile à partir d'une soumission Netlify Forms.
// Design : même modèle que la facture (en-tête blanc + logo, titre en Cormorant Garamond,
// tableau vert foncé, encadré du total, bandeau menthe en pied de page).
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const LOGO_BASE64 = require('./logo');
const FONTS = require('./fonts');

// ---------- Palette du modèle ----------
const VERT_FONCE = rgb(0.059, 0.165, 0.141);  // #0f2a24 : tableau, encadré du total, titre
const MENTHE = rgb(0.125, 0.788, 0.592);      // #20c997 : trait et bandeau
const LABEL = rgb(0.11, 0.54, 0.42);          // vert des petits titres
const FOND = rgb(0.965, 0.973, 0.969);        // fond du corps de page
const TEXTE = rgb(0.09, 0.13, 0.12);
const GRIS = rgb(0.36, 0.42, 0.45);
const TRAIT = rgb(0.85, 0.88, 0.87);
const BLANC = rgb(1, 1, 1);

const ENTREPRISE = {
  nom: "L'Auto-Mobile Nettoyage",
  ancien: "(anciennement Cleanin'Call)",
  siret: 'SIRET : 103 998 696 00019',
  tel: 'Tél. : 07 56 97 84 25',
  email: 'contact@lauto-mobile-nettoyage.com',
  pied: "L'Auto-Mobile Nettoyage · Meudon-la-Forêt · Île-de-France",
  site: 'lauto-mobile-nettoyage.com',
};

const LIBELLES_HORAIRE = {
  matin: 'Matin (8h – 12h)',
  midi: 'Milieu de journée (12h – 14h)',
  'apres-midi': 'Après-midi (14h – 18h)',
  soiree: 'Soirée (18h – 20h)',
};

// Prix de base des formules (utilisé seulement si le total du formulaire n'est pas un nombre).
const PRIX_FORMULES = {
  'Rafraîchissement intérieur': 39,
  'Signature intérieure': 59,
  'Lavage extérieur': 29,
  'Rafraîchissement complet': 59,
  'Signature complète': 79,
};

// Normalise les espaces et retire les caractères de contrôle.
function assainir(valeur) {
  if (valeur === undefined || valeur === null) return '';
  return String(valeur)
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F]/g, '')
    .trim();
}

// Ne garde que les caractères réellement présents dans la police.
const jeuxCaracteres = new WeakMap();
function filtrer(texte, police) {
  if (!jeuxCaracteres.has(police)) jeuxCaracteres.set(police, new Set(police.getCharacterSet()));
  const jeu = jeuxCaracteres.get(police);
  let sortie = '';
  for (const c of assainir(texte)) {
    if (jeu.has(c.codePointAt(0))) sortie += c;
  }
  return sortie;
}

function couper(texte, police, taille, largeurMax) {
  const lignes = [];
  for (const paragraphe of assainir(texte).split('\n')) {
    let courante = '';
    for (const mot of paragraphe.split(/\s+/)) {
      const essai = courante ? courante + ' ' + mot : mot;
      if (police.widthOfTextAtSize(filtrer(essai, police), taille) > largeurMax && courante) {
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

function dateCourte(valeur) {
  if (!valeur) return '';
  const m = String(valeur).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return assainir(valeur);
  return d.toLocaleDateString('fr-FR');
}

function euros(n) {
  return n.toFixed(2).replace('.', ',') + ' €';
}

function enNombre(texte) {
  const t = assainir(texte);
  if (!/\d/.test(t) || /devis/i.test(t)) return null;
  const n = parseFloat(t.replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

// Découpe « Véhicule: Citadine (+20€) | Option (+25€), Frais de déplacement (+3€) »
// sans casser les noms qui contiennent des virgules ou des parenthèses.
function extraireLignes(chaine) {
  const s = assainir(chaine);
  const lignes = [];
  if (!s || s.toLowerCase() === 'aucune') return lignes;
  const re = /\(\+\s*(\d+(?:[.,]\d+)?)\s*€\)/g;
  let dernier = 0;
  let m;
  const nettoyerNom = (brut) => {
    let nom = brut.replace(/^[\s,;|]+/, '').replace(/[\s,;|]+$/, '');
    const veh = nom.match(/^V[ée]hicule\s*:\s*(.+)$/i);
    if (veh) nom = 'Supplément véhicule : ' + veh[1].trim();
    return nom;
  };
  while ((m = re.exec(s)) !== null) {
    const nom = nettoyerNom(s.slice(dernier, m.index));
    dernier = m.index + m[0].length;
    if (nom) lignes.push({ designation: nom, prix: parseFloat(m[1].replace(',', '.')) });
  }
  const reste = nettoyerNom(s.slice(dernier));
  if (reste && /devis/i.test(reste)) {
    lignes.push({ designation: reste.replace(/\s*\(sur devis\)/i, ''), prix: null, texte: 'Sur devis' });
    lignes[lignes.length - 1].designation = lignes[lignes.length - 1].designation.replace(/^V[ée]hicule\s*:\s*/i, 'Supplément véhicule : ');
  }
  return lignes;
}

async function genererDevisPdf(donnees, dateSoumission) {
  const d = donnees || {};
  const emis = dateSoumission ? new Date(dateSoumission) : new Date();
  const numero = numeroDevis(emis);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width: W, height: H } = page.getSize();

  const barlow = await pdf.embedFont(Buffer.from(FONTS.barlow, 'base64'), { subset: true });
  const barlowGras = await pdf.embedFont(Buffer.from(FONTS.barlowGras, 'base64'), { subset: true });
  const cormorant = await pdf.embedFont(Buffer.from(FONTS.cormorant, 'base64'), { subset: true });

  const MARGE = 36;
  const DROITE = W - MARGE;          // bord droit du contenu
  const Y = (haut) => H - haut;       // ordonnée PDF à partir du haut de page

  const ecrire = (texte, { x = MARGE, haut, taille = 9, police = barlow, couleur = TEXTE } = {}) => {
    page.drawText(filtrer(texte, police), { x, y: Y(haut), size: taille, font: police, color: couleur });
  };
  const ecrireDroite = (texte, { x = DROITE, haut, taille = 9, police = barlow, couleur = TEXTE } = {}) => {
    const t = filtrer(texte, police);
    page.drawText(t, { x: x - police.widthOfTextAtSize(t, taille), y: Y(haut), size: taille, font: police, color: couleur });
  };
  // Petites capitales espacées (titres, en-têtes de tableau)
  const ecrireEspace = (texte, { x = MARGE, haut, taille = 7, police = barlowGras, couleur = LABEL, esp = 1.4, droite = false } = {}) => {
    const t = filtrer(texte, police);
    let largeur = -esp;
    for (const c of t) largeur += police.widthOfTextAtSize(c, taille) + esp;
    let cx = droite ? x - largeur : x;
    for (const c of t) {
      page.drawText(c, { x: cx, y: Y(haut), size: taille, font: police, color: couleur });
      cx += police.widthOfTextAtSize(c, taille) + esp;
    }
  };

  // ---------- Fond, en-tête, trait menthe ----------
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: FOND });
  page.drawRectangle({ x: 0, y: Y(141), width: W, height: 141, color: BLANC });
  page.drawRectangle({ x: 0, y: Y(144), width: W, height: 3, color: MENTHE });

  const logo = await pdf.embedPng(Buffer.from(LOGO_BASE64, 'base64'));
  const hLogo = 94;
  const wLogo = (logo.width / logo.height) * hLogo;
  page.drawImage(logo, { x: MARGE, y: Y(24 + hLogo), width: wLogo, height: hLogo });

  ecrireEspace('DEVIS', { x: DROITE, haut: 80, taille: 40, police: cormorant, couleur: VERT_FONCE, esp: 4.5, droite: true });
  ecrireDroite(`N° ${numero}`, { haut: 102, taille: 8.5, couleur: GRIS });

  // ---------- Émetteur / Client ----------
  const COL2 = 313;
  ecrireEspace('ÉMETTEUR', { haut: 182 });
  ecrireEspace('DEVIS POUR', { x: COL2, haut: 182 });

  const PAS = 15.5;
  let hautG = 204;
  ecrire(ENTREPRISE.nom, { haut: hautG, taille: 10, police: barlowGras });
  for (const ligne of [ENTREPRISE.ancien, ENTREPRISE.siret, ENTREPRISE.email, ENTREPRISE.tel]) {
    hautG += PAS;
    ecrire(ligne, { haut: hautG, taille: 9.5 });
  }

  const nomClient = [d.prenom, d.nom].filter(Boolean).join(' ') || 'Non renseigné';
  let hautD = 204;
  ecrire(nomClient, { x: COL2, haut: hautD, taille: 10, police: barlowGras });
  const lignesClient = [d.email, d.telephone];
  for (const l of lignesClient.filter(Boolean)) {
    hautD += PAS;
    ecrire(l, { x: COL2, haut: hautD, taille: 9.5 });
  }
  if (d.adresse) {
    for (const bout of couper(d.adresse, barlow, 9.5, DROITE - COL2)) {
      hautD += PAS;
      ecrire(bout, { x: COL2, haut: hautD, taille: 9.5 });
    }
  }
  const vehicule = [d.modele, d.type_vehicule ? `(${assainir(d.type_vehicule)})` : ''].filter(Boolean).join(' ');
  if (vehicule) {
    hautD += PAS;
    ecrire(`Véhicule : ${vehicule}`, { x: COL2, haut: hautD, taille: 9.5, couleur: GRIS });
  }

  // ---------- Dates ----------
  const regle1 = Math.max(hautG, hautD) + 20;
  page.drawLine({ start: { x: MARGE, y: Y(regle1) }, end: { x: DROITE, y: Y(regle1) }, thickness: 0.75, color: TRAIT });
  const hautDates = regle1 + 22;
  ecrire("Date d'émission : ", { haut: hautDates, taille: 9, couleur: GRIS });
  ecrire(emis.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }), {
    x: MARGE + barlow.widthOfTextAtSize("Date d'émission : ", 9), haut: hautDates, taille: 9, police: barlowGras,
  });
  const libInter = 'Intervention souhaitée : ';
  const xInter = 204;
  ecrire(libInter, { x: xInter, haut: hautDates, taille: 9, couleur: GRIS });
  const valInter = [dateCourte(d.date), LIBELLES_HORAIRE[d.horaire] || d.horaire].filter(Boolean).join(' · ') || 'À convenir';
  ecrire(valInter, { x: xInter + barlow.widthOfTextAtSize(libInter, 9), haut: hautDates, taille: 9, police: barlowGras });
  const regle2 = regle1 + 37;
  page.drawLine({ start: { x: MARGE, y: Y(regle2) }, end: { x: DROITE, y: Y(regle2) }, thickness: 0.75, color: TRAIT });

  // ---------- Lignes du devis ----------
  const supplements = extraireLignes(d.options_choisies);
  const sommeSupp = supplements.reduce((s, l) => s + (l.prix || 0), 0);
  const totalForm = enNombre(d.total_estime);
  const gamme = assainir(d.gamme) || 'Prestation à définir';
  let prixBase = null;
  if (totalForm !== null) prixBase = Math.max(0, totalForm - sommeSupp);
  else if (PRIX_FORMULES[gamme] !== undefined) prixBase = PRIX_FORMULES[gamme];

  const lignes = [{
    designation: gamme,
    detail: 'Prestation de nettoyage automobile à domicile',
    prix: prixBase,
  }, ...supplements];

  // ---------- Tableau ----------
  const X_DESIGN = MARGE + 12;
  const X_QTE = 382, X_UNIT = 464, X_TOTAL = DROITE - 12;
  const hautTable = regle2 + 25;
  const HAUT_ENTETE = 31;
  page.drawRectangle({ x: MARGE, y: Y(hautTable + HAUT_ENTETE), width: DROITE - MARGE, height: HAUT_ENTETE, color: VERT_FONCE });
  const hEntete = hautTable + HAUT_ENTETE / 2 + 2.5;
  ecrireEspace('DÉSIGNATION', { x: X_DESIGN, haut: hEntete, couleur: BLANC, taille: 6.8 });
  ecrireEspace('QTÉ', { x: X_QTE, haut: hEntete, couleur: BLANC, taille: 6.8, droite: true });
  ecrireEspace('PRIX UNIT.', { x: X_UNIT, haut: hEntete, couleur: BLANC, taille: 6.8, droite: true });
  ecrireEspace('TOTAL', { x: X_TOTAL, haut: hEntete, couleur: BLANC, taille: 6.8, droite: true });

  const hauteurBase = lignes.length <= 4 ? 34 : lignes.length <= 6 ? 29 : lignes.length <= 8 ? 25 : 18;
  let hautLigne = hautTable + HAUT_ENTETE;
  for (const l of lignes) {
    const bouts = couper(l.designation, barlowGras, 10, X_QTE - 40 - X_DESIGN);
    const hauteur = hauteurBase + (bouts.length - 1) * 12 + (l.detail ? 10 : 0);
    let base = hautLigne + hauteur / 2 - ((bouts.length - 1) * 12 + (l.detail ? 10 : 0)) / 2 + 3.5;
    bouts.forEach((bout, i) => ecrire(bout, { x: X_DESIGN, haut: base + i * 12, taille: 10, police: barlowGras }));
    if (l.detail) ecrire(l.detail, { x: X_DESIGN, haut: base + (bouts.length - 1) * 12 + 12, taille: 8, couleur: GRIS });
    ecrireDroite('1', { x: X_QTE, haut: base, taille: 9.5 });
    const unit = l.texte || (l.prix === null || l.prix === undefined ? 'À définir' : euros(l.prix));
    ecrireDroite(unit, { x: X_UNIT, haut: base, taille: 9.5 });
    ecrireDroite(unit, { x: X_TOTAL, haut: base, taille: 9.5, police: barlowGras });
    hautLigne += hauteur;
    page.drawLine({ start: { x: MARGE, y: Y(hautLigne) }, end: { x: DROITE, y: Y(hautLigne) }, thickness: 0.75, color: TRAIT });
  }

  // ---------- Totaux ----------
  const X_TOT = 334;
  const estSurDevis = totalForm === null && (/devis/i.test(assainir(d.total_estime)) || lignes.some((l) => l.texte));
  let totalNombre = totalForm;
  if (totalNombre === null && !estSurDevis) {
    totalNombre = (prixBase || 0) + sommeSupp;
  }
  const texteTotal = estSurDevis ? 'Sur devis' : euros(totalNombre);

  const hautHT = hautLigne + 34;
  ecrire('Total HT', { x: X_TOT, haut: hautHT, taille: 9.5, couleur: GRIS });
  ecrireDroite(texteTotal, { haut: hautHT, taille: 9.5, police: barlowGras });
  ecrire('TVA', { x: X_TOT, haut: hautHT + 27, taille: 9.5, couleur: GRIS });
  ecrireDroite('Non applicable', { haut: hautHT + 27, taille: 9.5 });
  const reglTot = hautHT + 45;
  page.drawLine({ start: { x: X_TOT, y: Y(reglTot) }, end: { x: DROITE, y: Y(reglTot) }, thickness: 0.75, color: TRAIT });

  const hautBoite = reglTot + 12;
  const HAUT_BOITE = 49;
  page.drawRectangle({ x: X_TOT, y: Y(hautBoite + HAUT_BOITE), width: DROITE - X_TOT, height: HAUT_BOITE, color: VERT_FONCE });
  ecrireEspace('TOTAL ESTIMÉ', { x: X_TOT + 15, haut: hautBoite + HAUT_BOITE / 2 + 2.5, couleur: MENTHE, taille: 6.8 });
  ecrireDroite(texteTotal, {
    x: DROITE - 15, haut: hautBoite + HAUT_BOITE / 2 + (estSurDevis ? 6 : 8), taille: estSurDevis ? 17 : 23,
    police: cormorant, couleur: BLANC,
  });

  // ---------- Précisions du client (à gauche des totaux) ----------
  const bas = hautBoite + HAUT_BOITE;
  const message = assainir(d.message);
  if (message) {
    ecrireEspace('PRÉCISIONS DU CLIENT', { haut: hautHT - 2 });
    const largeurMsg = X_TOT - 24 - MARGE;
    const lignesMsg = couper(message, barlow, 9, largeurMsg);
    const maxLignes = Math.floor((bas - (hautHT + 14)) / 12.5);
    lignesMsg.slice(0, maxLignes).forEach((bout, i) => {
      let t = bout;
      if (i === maxLignes - 1 && lignesMsg.length > maxLignes) t = t.replace(/[\s.,;]*$/, '') + '…';
      ecrire(t, { haut: hautHT + 14 + i * 12.5, taille: 9 });
    });
  }

  // ---------- Règlement et conditions ----------
  let haut = bas + 24;
  const LIMITE = 796;
  ecrireEspace('RÈGLEMENT', { haut });
  haut += 17;
  ecrire('Paiement effectué sur place après intervention, en espèces ou par carte bancaire.', { haut, taille: 9.5 });
  haut += 13;
  ecrire('TVA non applicable, art. 293 B du CGI.', { haut, taille: 7.5, couleur: GRIS });
  haut += 20;

  const conditions = "Montant estimatif établi sur la base des informations transmises, ajustable après constat de l'état réel du véhicule. " +
    "Devis valable 30 jours. Annulation toujours gratuite. " +
    "Intervention réalisée sur place, en autonomie complète : eau et électricité fournies par L'Auto-Mobile.";
  const lignesCond = couper(conditions, barlow, 7.5, DROITE - MARGE);
  if (haut + 13 + lignesCond.length * 10 < LIMITE) {
    ecrireEspace('CONDITIONS', { haut });
    haut += 13;
    for (const bout of lignesCond) {
      ecrire(bout, { haut, taille: 7.5, couleur: GRIS });
      haut += 10;
    }
  }

  // ---------- Bandeau de pied de page ----------
  const HAUT_PIED = H - 34;
  page.drawRectangle({ x: 0, y: 0, width: W, height: 34, color: MENTHE });
  ecrire(ENTREPRISE.pied, { haut: HAUT_PIED + 21, taille: 8, couleur: VERT_FONCE });
  ecrireDroite(ENTREPRISE.site, { haut: HAUT_PIED + 21, taille: 8, couleur: VERT_FONCE });

  const octets = await pdf.save();
  return { pdf: Buffer.from(octets), numero, nomClient };
}

module.exports = { genererDevisPdf, assainir };
