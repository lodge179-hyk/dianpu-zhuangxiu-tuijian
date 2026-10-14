import { readFileSync } from 'node:fs';
import { extractPalette } from '../src/palette.mjs';

const buf = readFileSync('output/runs/d9470448-94bf-4e99-8953-c6d6dddef8f3/screenshot.png');
const p = await extractPalette(buf);
console.log('实测主色：', p.dominant.slice(0, 5).map(c => `${c.hex}(${c.share}%)`).join('  '));
console.log('background:', p.background, ' accent:', p.accent, ' muted:', p.muted);
