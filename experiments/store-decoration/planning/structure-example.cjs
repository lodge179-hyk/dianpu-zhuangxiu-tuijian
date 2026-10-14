const fs = require('fs');
const path = require('path');

// Only the documented beauty example has a reviewed, matching local material set.
// Other shops keep their generated briefs and normal library matching behavior.
function fillStructureExample(folder, dossier, plan) {
  if (dossier.exampleId !== 'beauty') return [];
  const source = path.join(__dirname, 'structure-examples', 'beauty');
  const filled = [];
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  for (const asset of plan.assets) {
    // The saved hero is 4:3, so compact 3:1 must be generated separately.
    if (asset.id === 'overview' && asset.aspect !== '4:3') continue;
    const file = path.join(source, asset.id + '.png');
    if (fs.existsSync(file)) { fs.copyFileSync(file, path.join(folder, 'assets', asset.id + '.png')); filled.push(asset.id); }
  }
  return filled;
}
module.exports = { fillStructureExample };
