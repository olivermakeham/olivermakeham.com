// Packs the 9 robot head poses into a single 3x3 sprite sheet.
// Run with: node scripts/build-head-sheet.mjs
// Cell order (row-major): forward, up, upright, right, downright, down, downleft, left, upleft.
import sharp from 'sharp';

const source = 'source-art/jpg_assortments';
const output = 'src/assets/jpg_assortments/headSheet.png';
const poses = [
    ['ch_foward.png', 0.9], // the forward pose was displayed at 90% scale
    ['ch_up.png', 1],
    ['ch_upright.png', 1],
    ['ch_right.png', 1],
    ['ch_downright.png', 1],
    ['ch_down.png', 1],
    ['ch_downleft.png', 1],
    ['ch_left.png', 1],
    ['ch_upleft.png', 1],
];
const cellWidth = 400;
const cellHeight = 340;

const composites = [];
for (const [index, [file, scale]] of poses.entries()) {
    const width = Math.round(cellWidth * scale);
    const height = Math.round(cellHeight * scale);
    const frame = await sharp(`${source}/${file}`)
        .resize(width, height, { fit: 'fill' })
        .toBuffer();
    composites.push({
        input: frame,
        left: (index % 3) * cellWidth + Math.round((cellWidth - width) / 2),
        top: Math.floor(index / 3) * cellHeight + Math.round((cellHeight - height) / 2),
    });
}

await sharp({
    create: {
        width: cellWidth * 3,
        height: cellHeight * 3,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
})
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(output);

console.log(`Wrote ${output}`);
