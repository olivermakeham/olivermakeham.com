import type { ImageMetadata } from 'astro';

const modules = import.meta.glob<{ default: ImageMetadata }>(
    '/src/assets/{jpg_*,navigation_icons}/*.{jpg,jpeg,png,webp}',
    { eager: true },
);

const images = new Map<string, ImageMetadata>();
for (const [path, module] of Object.entries(modules)) {
    images.set(path.replace('/src/assets/', ''), module.default);
}

/** Look up an imported asset, e.g. asset('jpg_maps', 'cover_1.png'). */
export function asset(folder: string, name: string): ImageMetadata {
    const found = images.get(`${folder}/${name}`);
    if (!found) throw new Error(`Missing image asset: ${folder}/${name}`);
    return found;
}
