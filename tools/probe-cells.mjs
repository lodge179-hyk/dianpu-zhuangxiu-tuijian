import sharp from 'sharp';

const file = process.argv[2];
const probes = [
  { name: '左半全宽', left: 0, top: 680, width: 540, height: 560 },
  { name: '右半全宽', left: 540, top: 680, width: 536, height: 560 },
  { name: '左列商品', left: 150, top: 700, width: 280, height: 280 },
  { name: '右列商品', left: 600, top: 700, width: 280, height: 280 },
  { name: '左列偏上', left: 150, top: 600, width: 280, height: 280 },
  { name: '右列偏上', left: 600, top: 600, width: 280, height: 280 },
];
const tiles = [];
for (const [i, p] of probes.entries()) {
  const buf = await sharp(file).extract({ left: p.left, top: p.top, width: p.width, height: p.height })
    .resize(200, 200, { fit: 'cover' }).png().toBuffer();
  tiles.push({ input: buf, left: 10 + (i % 3) * 210, top: 10 + Math.floor(i / 3) * 210 });
}
await sharp({ create: { width: 640, height: 430, channels: 3, background: '#ccc' } })
  .composite(tiles).png().toFile('output/probe-cells.png');
console.log('已生成 output/probe-cells.png');
