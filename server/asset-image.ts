import sharp from "sharp";

/** Fill the slot from source pixels. Never bake contain-padding into an asset. */
export function fitAssetImage(bytes: Buffer, size: { width: number; height: number }) {
  return sharp(bytes).rotate().resize(size.width, size.height, { fit: "cover", position: "attention" }).jpeg({ quality: 92 }).toBuffer();
}
