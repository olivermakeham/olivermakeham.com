// Bakes the organic-edged reveal disc used by the Presents card mask.
// This replaces a live feTurbulence + feDisplacementMap SVG filter that was re-run on every pointer move.
// Run with: node scripts/build-reveal-disc.mjs
import sharp from 'sharp';

const size = 256;
const radius = 96; // nominal disc radius in texture pixels; the margin leaves room for edge displacement
const solidUntil = 0.64;
const displacement = 42;
const output = 'src/assets/jpg_presents/revealDisc.png';

const hash = (x, y, seed) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1597334677) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const smooth = (t) => t * t * (3 - 2 * t);
const valueNoise = (x, y, seed) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const top = hash(x0, y0, seed) * (1 - tx) + hash(x0 + 1, y0, seed) * tx;
    const bottom = hash(x0, y0 + 1, seed) * (1 - tx) + hash(x0 + 1, y0 + 1, seed) * tx;
    return top * (1 - ty) + bottom * ty;
};
const fractal = (x, y, seed) =>
    valueNoise(x / 68, y / 41, seed) * 0.65 + valueNoise(x / 34, y / 20, seed + 11) * 0.35;

const pixels = Buffer.alloc(size * size * 4, 255);
const center = size / 2;
for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
        const sampleX = x + (fractal(x, y, 8) - 0.5) * displacement;
        const sampleY = y + (fractal(x, y, 21) - 0.5) * displacement;
        const distance = Math.hypot(sampleX - center, sampleY - center) / radius;
        const alpha = Math.max(0, Math.min(1, (1 - distance) / (1 - solidUntil)));
        pixels[(y * size + x) * 4 + 3] = Math.round(alpha * 255);
    }
}

await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(output);

console.log(`Wrote ${output}`);
