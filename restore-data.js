const fs = require('fs');
const current = JSON.parse(fs.readFileSync('server/goudalle.json'));
const restored = JSON.parse(fs.readFileSync('server/goudalle.restored.json'));

// Restaurer les données manquantes
const keysToRestore = ['sylve_balance', 'sylve_ca', 'sylve_paiements', 'cbco_commercial'];

console.log('Restoring data:');
keysToRestore.forEach(key => {
  if (restored[key] && !current[key]) {
    current[key] = restored[key];
    console.log(`  ✅ ${key} restored`);
  } else if (restored[key] && current[key]) {
    console.log(`  ⚠️  ${key} already exists, skipping`);
  } else {
    console.log(`  ❌ ${key} not found in restored data`);
  }
});

// Sauvegarder
fs.writeFileSync('server/goudalle.json', JSON.stringify(current, null, 2));
console.log('\n✅ Data restored to goudalle.json');

// Vérifier
console.log('\nVerification:');
['sylve_balance', 'sylve_ca', 'sylve_paiements', 'cbco_commercial'].forEach(key => {
  const val = current[key];
  if (!val) console.log(`  ${key}: NOT FOUND`);
  else if (Array.isArray(val)) console.log(`  ${key}: ${val.length} items`);
  else if (typeof val === 'object' && val.cbco) console.log(`  ${key}: cbco=${val.cbco.length}, gc=${val.gc.length}, gm=${val.gm.length}`);
  else console.log(`  ${key}: exists`);
});
