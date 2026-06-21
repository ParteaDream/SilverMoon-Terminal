import fs from 'fs';

const lines = fs.readFileSync('electron/seed_part1.sql', 'utf8').split('\n');
const hdrIdx = lines.findIndex(l => l.includes('INSERT OR IGNORE INTO "characters"'));
const hdrCols = lines[hdrIdx].match(/"([^"]+)"/g);
const expected = hdrCols.length - 1;
console.log('Expected columns:', expected);

function countValues(line) {
  let count = 0, inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "'" && (i === 0 || line[i - 1] !== '\\')) inQ = !inQ;
    if (line[i] === ',' && !inQ) count++;
  }
  return count + 1;
}

let bad = 0;
for (let i = hdrIdx + 1; i < lines.length; i++) {
  const t = lines[i].trim();
  if (!t.startsWith('(')) {
    if (i > hdrIdx + 1) break;
    else continue;
  }
  const n = countValues(lines[i]);
  if (n !== expected) {
    console.log('Row ' + (i + 1) + ': ' + n + ' values (expected ' + expected + ')  excess=' + (n - expected));
    bad++;
  }
}
console.log('Bad rows: ' + bad);
