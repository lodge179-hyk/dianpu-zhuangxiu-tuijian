// Portable entry point for the saved demo; no browser, model or credentials required.
const fs = require('fs');
const path = require('path');
const { renderPage, components } = require('./a9-component-library/lib/index.cjs');
const folder = path.join(__dirname, 'a13-complete-store');
const page = JSON.parse(fs.readFileSync(path.join(folder, 'page.json'), 'utf8'));
const result = renderPage(page);
const localSources = new Set(result.photos.map(photo => photo.src));
for (const module of page.modules) {
  if (module.content?.shop?.avatar) localSources.add(module.content.shop.avatar);
}
for (const source of localSources) {
  if (/^(?:https?:|data:)/i.test(source)) throw new Error('The saved demo requires local assets');
  const file = path.resolve(folder, source);
  const relative = path.relative(folder, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) {
    throw new Error('Missing or invalid demo asset: ' + source);
  }
}
fs.writeFileSync(path.join(folder, 'shop.html'), result.html);
console.log(JSON.stringify({
  html: 'a13-complete-store/shop.html',
  availableStyles: Object.keys(components).length,
  modules: result.moduleCount,
  photos: result.photos.length,
  width: result.width,
  height: result.height,
  generationCalls: 0
}, null, 2));
