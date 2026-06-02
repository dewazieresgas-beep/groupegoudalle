const fs = require('fs');
const path = require('path');
const XlsxPopulate = require('../server/node_modules/xlsx-populate');

const BASE = process.env.DOSSIERS_BASE || path.join('Y:', '03-Affaires', '02-Affaires en cours');
const INFO_FILE = '00_ Infos général chantier.xlsx';
const DATE_LABELS = new Set(["Date d'OS", 'Date fin contractuelle']);

function isChantierDir(name) {
  return !name.startsWith('0 ');
}

function normalizeExcelDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return value;
}

function applyDateCellSetup(cell) {
  const current = cell.value();
  const normalized = normalizeExcelDate(current);
  if (normalized instanceof Date) cell.value(normalized);
  cell.style('numberFormat', 'dd/mm/yyyy');
  cell.dataValidation({
    type: 'date',
    allowBlank: true,
    showInputMessage: true,
    promptTitle: 'Date',
    prompt: 'Choisir ou saisir une date au format jj/mm/aaaa',
    showErrorMessage: true,
    errorTitle: 'Date invalide',
    error: 'Veuillez saisir une date valide.',
    operator: 'between',
    formula1: 'DATE(2000,1,1)',
    formula2: 'DATE(2100,12,31)',
  });
}

async function updateWorkbook(filePath) {
  const workbook = await XlsxPopulate.fromFileAsync(filePath);
  const sheet = workbook.sheet(0);
  let touched = 0;

  for (let row = 1; row <= 30; row++) {
    const label = String(sheet.cell(row, 1).value() || '').trim();
    if (!DATE_LABELS.has(label)) continue;
    applyDateCellSetup(sheet.cell(row, 2));
    touched++;
  }

  if (touched > 0) await workbook.toFileAsync(filePath);
  return touched;
}

async function main() {
  if (!fs.existsSync(BASE)) {
    throw new Error(`Dossier introuvable: ${BASE}`);
  }

  const files = [];
  const template = path.join(BASE, '1 Dossier Type CHANTIER', INFO_FILE);
  if (fs.existsSync(template)) files.push(template);

  const entries = fs.readdirSync(BASE, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !isChantierDir(entry.name)) continue;
    const filePath = path.join(BASE, entry.name, INFO_FILE);
    if (fs.existsSync(filePath)) files.push(filePath);
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const touched = await updateWorkbook(file);
      if (touched > 0) updated++;
      else skipped++;
    } catch (e) {
      failed++;
      console.warn(`Erreur: ${file} -> ${e.message}`);
    }
  }

  console.log(`Excel traités: ${files.length}`);
  console.log(`Mis à jour: ${updated}`);
  console.log(`Ignorés: ${skipped}`);
  console.log(`Échecs: ${failed}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
