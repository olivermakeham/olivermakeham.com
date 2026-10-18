// @ts-check
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';

// Dev only: the image endpoint sends a one-year cache header on URLs that don't change when a
// source file is replaced, so swapped artwork looks stale. Make the browser revalidate instead,
// using the source file's mtime as an ETag so unchanged images answer 304 without being
// re-encoded, and clear whatever it already cached once per browser per dev-server start.
const devImageRevalidate = {
    name: 'dev-image-revalidate',
    apply: 'serve',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
        const session = String(Date.now());
        const sourceStamp = (/** @type {string} */ url) => {
            try {
                const href = new URL(url, 'http://localhost').searchParams.get('href') ?? '';
                const path = href.split('?')[0];
                const file = path.startsWith('/@fs/') ? path.slice(5) : join(server.config.root, path);
                const { mtimeMs, size } = statSync(file);
                return `"${createHash('sha1').update(url).digest('base64url').slice(0, 12)}-${mtimeMs}-${size}"`;
            } catch {
                return undefined;
            }
        };
        server.middlewares.use((req, res, next) => {
            const url = req.url ?? '';
            if (url.startsWith('/_image')) {
                const etag = sourceStamp(url);
                if (etag && req.headers['if-none-match'] === etag) {
                    res.statusCode = 304;
                    res.setHeader('ETag', etag);
                    res.setHeader('Cache-Control', 'no-cache');
                    res.end();
                    return;
                }
                const setHeader = res.setHeader.bind(res);
                res.setHeader = (name, value) =>
                    setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-cache' : value);
                if (etag) res.setHeader('ETag', etag);
            } else if (req.headers.accept?.includes('text/html') && !req.headers.cookie?.includes(`devcache=${session}`)) {
                res.setHeader('Clear-Site-Data', '"cache"');
                res.setHeader('Set-Cookie', `devcache=${session}; Path=/; SameSite=Lax`);
            }
            next();
        });
    },
};

// https://astro.build/config
export default defineConfig({
    vite: { plugins: [devImageRevalidate] },
});
