import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fitAssetImage } from "../server/asset-image";

test("portrait and landscape sources fill every edge of a square slot without white canvas", async () => {
  for (const [width, height] of [[60, 100], [100, 60]]) {
    const input = await sharp({ create: { width, height, channels: 3, background: "#24683a" } }).png().toBuffer();
    const { data, info } = await sharp(await fitAssetImage(input, { width: 100, height: 100 })).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 100); assert.equal(info.height, 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      if (x !== 0 && x !== 99 && y !== 0 && y !== 99) continue;
      const offset = (y * 100 + x) * info.channels;
      assert.ok(data[offset] < 60 && data[offset + 1] < 130 && data[offset + 2] < 85, `unexpected padding at ${x},${y}`);
    }
  }
});
