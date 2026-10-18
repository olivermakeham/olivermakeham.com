/**
 * Homepage card interactions.
 *
 * Every effect shares one pointer listener and one requestAnimationFrame loop.
 * Card rectangles are measured once (and again only after scroll/resize/layout changes),
 * so the hot path never reads layout after a style write. Each effect also only writes to
 * the DOM when the value it would write has actually changed.
 */

interface Reach {
    x: number;
    y: number;
}

interface Handler {
    cover: HTMLElement;
    /** How far outside the card the pointer still matters (pixels). */
    reach?: (rect: DOMRect) => Reach;
    update(x: number, y: number, rect: DOMRect): void;
    leave(x?: number, y?: number, rect?: DOMRect): void;
    /** Called every frame; return true while an animation is still settling. */
    step?(dt: number): boolean;
    active?: boolean;
    /** Pointer-following effects; skipped entirely while motion is off. */
    motion?: boolean;
}

const NO_REACH: Reach = { x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// With motion off, only a static "pop" on the hovered card remains
const root = document.documentElement;
let noMotion = root.classList.contains('no-motion');

const covers = Array.from(document.querySelectorAll<HTMLElement>('.cover:not(.cover--static)'));
const handlers: Handler[] = [];
const rects = new Map<HTMLElement, DOMRect>();
let rectsDirty = true;
let pointer: { x: number; y: number } | null = null;
let frameId = 0;
let lastTime = 0;

const measure = () => {
    covers.forEach((cover) => rects.set(cover, cover.getBoundingClientRect()));
    rectsDirty = false;
};

const schedule = () => {
    if (!frameId) frameId = requestAnimationFrame(tick);
};

function tick(now: number) {
    frameId = 0;
    const dt = clamp(lastTime ? now - lastTime : 16.7, 8, 50);
    lastTime = now;
    if (rectsDirty) measure();

    let keepAlive = false;
    for (const handler of handlers) {
        const rect = rects.get(handler.cover);
        if (!rect) continue;

        if (noMotion && handler.motion) {
            if (handler.active) {
                handler.active = false;
                handler.leave();
            }
            continue;
        }

        let near = false;
        if (pointer) {
            const reach = handler.reach?.(rect) ?? NO_REACH;
            near =
                pointer.x >= rect.left - reach.x &&
                pointer.x <= rect.right + reach.x &&
                pointer.y >= rect.top - reach.y &&
                pointer.y <= rect.bottom + reach.y;
        }

        if (near && pointer) {
            handler.update(pointer.x, pointer.y, rect);
            handler.active = true;
        } else if (handler.active) {
            handler.active = false;
            handler.leave(pointer?.x, pointer?.y, rect);
        }

        if (handler.step?.(dt)) keepAlive = true;
    }

    if (keepAlive) schedule();
    else lastTime = 0;
}

const markDirty = () => {
    rectsDirty = true;
    if (pointer) schedule();
};

document.addEventListener('motionchange', () => {
    noMotion = root.classList.contains('no-motion');
    schedule();
});

window.addEventListener(
    'pointermove',
    (event) => {
        if (event.pointerType === 'touch') return;
        pointer = { x: event.clientX, y: event.clientY };
        schedule();
    },
    { passive: true },
);
const clearPointer = () => {
    pointer = null;
    schedule();
};
document.documentElement.addEventListener('mouseleave', clearPointer);
window.addEventListener('blur', clearPointer);
window.addEventListener('scroll', markDirty, { passive: true });
window.addEventListener('resize', markDirty);
const layoutObserver = new ResizeObserver(markDirty);
layoutObserver.observe(document.body);
document.querySelectorAll('.site-header, .grid').forEach((element) => layoutObserver.observe(element));
document.fonts?.ready.then(markDirty);
window.addEventListener('load', markDirty);

/* Card tilt, lift and scale. Writes a single transform per frame, and only when it changed. */
const initTilt = (cover: HTMLElement) => {
    const tilt = cover.querySelector<HTMLElement>('.cover-tilt');
    if (!tilt) return;
    // The motion machine pops like the other cards but never tilts
    const tiltDeg = cover.classList.contains('cover--motion') ? 0 : 16;

    const state = { lift: 0, scale: 1, rotateX: 0, rotateY: 0 };
    const target = { lift: 0, scale: 1, rotateX: 0, rotateY: 0 };
    let applied = '';

    handlers.push({
        cover,
        reach: (rect) => {
            const distance = Math.min(rect.width, rect.height) * 0.13;
            return { x: distance, y: distance };
        },
        update(x, y, rect) {
            const { width, height, left, top, right, bottom } = rect;
            const inside = x >= left && x <= right && y >= top && y <= bottom;
            const localX = (x - left) / width;
            const localY = (y - top) / height;
            if (noMotion) {
                target.lift = inside ? -7 : 0;
                target.scale = inside ? 1.035 : 1;
                target.rotateX = 0;
                target.rotateY = 0;
                return;
            }
            let progress = 0;

            if (inside) {
                const edgeDepth = Math.min(localX, 1 - localX, localY, 1 - localY) * 2;
                progress = 0.22 + 0.78 * (1 - (1 - edgeDepth) ** 4);
            } else {
                const dx = Math.max(left - x, 0, x - right);
                const dy = Math.max(top - y, 0, y - bottom);
                const radius = Math.min(width, height) * 0.13;
                const influence = Math.max(0, 1 - Math.hypot(dx, dy) / radius);
                progress = influence * influence * (3 - 2 * influence) * 0.22;
            }

            target.rotateX = clamp(0.5 - localY, -0.5, 0.5) * tiltDeg * progress;
            target.rotateY = clamp(localX - 0.5, -0.5, 0.5) * tiltDeg * progress;
            target.lift = -9 * progress;
            target.scale = 1 + 0.03 * progress;
        },
        leave() {
            target.lift = 0;
            target.scale = 1;
            target.rotateX = 0;
            target.rotateY = 0;
        },
        step(dt) {
            // Frame-rate independent smoothing keeps 60/120/144 Hz displays visually identical
            const k = noMotion ? 1 : 1 - 0.78 ** (dt / 16.667);
            let moving = false;
            for (const key of ['lift', 'scale', 'rotateX', 'rotateY'] as const) {
                const delta = target[key] - state[key];
                const threshold = key === 'scale' ? 0.0001 : 0.01;
                if (Math.abs(delta) > threshold) {
                    state[key] += delta * k;
                    moving = true;
                } else {
                    state[key] = target[key];
                }
            }

            const atRest =
                state.lift === 0 && state.scale === 1 && state.rotateX === 0 && state.rotateY === 0;
            const next = atRest
                ? ''
                : `perspective(1100px) translate3d(0, ${state.lift.toFixed(2)}px, 0) ` +
                  `scale(${state.scale.toFixed(4)}) rotateX(${state.rotateX.toFixed(2)}deg) ` +
                  `rotateY(${state.rotateY.toFixed(2)}deg)`;
            if (next !== applied) {
                applied = next;
                tilt.style.transform = next;
            }
            return moving;
        },
    });
};

/* Bar: the spotlight follows the pointer; CSS expands it into the fully lit image. */
const initBar = (cover: HTMLElement) => {
    const light = cover.querySelector<HTMLElement>('.bar-cover-full');
    if (!light) return;
    let lastX = Number.NaN;
    let lastY = Number.NaN;

    const place = (percentX: number, percentY: number) => {
        const x = Math.round(percentX * 10) / 10;
        const y = Math.round(percentY * 10) / 10;
        if (x === lastX && y === lastY) return;
        lastX = x;
        lastY = y;
        light.style.setProperty('--bar-light-x', `${x}%`);
        light.style.setProperty('--bar-light-y', `${y}%`);
    };

    handlers.push({
        cover,
        update(x, y, rect) {
            place(((x - rect.left) / rect.width) * 100, ((y - rect.top) / rect.height) * 100);
        },
        // The spotlight always drops out through the bottom middle, whichever way the pointer left
        leave() {
            place(50, 100);
        },
    });
    cover.addEventListener('focus', () => place(50, 50));
};

/* Robot: picks one of 9 head poses from a sprite sheet; CSS shows the matching frame. */
const initRobot = (cover: HTMLElement) => {
    const HEAD_LEFT = 0.441;
    const HEAD_TOP = 0.193;
    const HEAD_WIDTH = 0.112;
    const HEAD_ASPECT = 340 / 400;
    const ARTWORK_ASPECT = 1536 / 2048;
    const sector = (Math.PI * 2) / 8;
    let current = -1;
    let shownPose = 0;

    const show = (direction: number) => {
        const pose = direction < 0 ? 0 : direction + 1;
        if (pose === shownPose) return;
        shownPose = pose;
        cover.dataset.pose = String(pose);
    };

    handlers.push({
        cover,
        update(x, y, rect) {
            const { width, height } = rect;
            const artworkHeight = width * ARTWORK_ASPECT;
            const artworkTop = rect.top + (height - artworkHeight) / 2;
            const pivotX = rect.left + width * (HEAD_LEFT + HEAD_WIDTH / 2);
            const pivotY =
                artworkTop + artworkHeight * HEAD_TOP + (width * HEAD_WIDTH * HEAD_ASPECT) / 2;
            const offsetX = x - pivotX;
            const offsetY = y - pivotY;
            const distance = Math.hypot(offsetX, offsetY);
            const minSide = Math.min(width, height);

            if (distance < minSide * 0.045) {
                current = -1;
                show(-1);
                return;
            }

            const angle = (Math.atan2(offsetX, -offsetY) + Math.PI * 2) % (Math.PI * 2);
            const threshold = sector / 2 + Math.min(1, distance / (minSide * 0.75)) * (Math.PI / 18);
            const nearest = Math.round(angle / sector) % 8;

            if (current === -1) {
                current = nearest;
            } else {
                const difference = Math.abs(
                    ((angle - current * sector + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
                );
                if (difference > threshold) current = nearest;
            }
            show(current);
        },
        leave() {
            current = -1;
            show(-1);
        },
    });
    cover.addEventListener('focus', () => {
        current = -1;
        show(-1);
    });
};

/* Presents: the reveal disc is a baked mask texture positioned with CSS variables. */
const initPresents = (cover: HTMLElement) => {
    const stage = cover.querySelector<HTMLElement>('.presents-cover');
    if (!stage) return;
    let lastX = Number.NaN;
    let lastY = Number.NaN;

    const place = (x: number, y: number) => {
        const roundedX = Math.round(x * 2) / 2;
        const roundedY = Math.round(y * 2) / 2;
        if (roundedX === lastX && roundedY === lastY) return;
        lastX = roundedX;
        lastY = roundedY;
        stage.style.setProperty('--reveal-x', `${roundedX}px`);
        stage.style.setProperty('--reveal-y', `${roundedY}px`);
    };

    handlers.push({
        cover,
        update(x, y, rect) {
            place(x - rect.left, y - rect.top);
        },
        leave() {},
    });
    cover.addEventListener('focus', () => {
        stage.style.removeProperty('--reveal-x');
        stage.style.removeProperty('--reveal-y');
        lastX = Number.NaN;
        lastY = Number.NaN;
    });

    // Warm the mask textures so the first hover does not wait on the network
    (stage.dataset.warm ?? '')
        .split(' ')
        .filter(Boolean)
        .forEach((url) => {
            const image = new Image();
            image.decoding = 'async';
            image.src = url;
        });
};

/* Maps: raised layers are found with precomputed edge-distance fields, not per-move scans. */
const initMaps = (cover: HTMLElement) => {
    const layers = Array.from(cover.querySelectorAll<HTMLImageElement>('.maps-cover-layer')).sort(
        (a, b) => Number(a.dataset.mapLayer) - Number(b.dataset.mapLayer),
    );
    if (!layers.length) return;
    const SIZE = 256;
    const EDGE = 18;
    const MAX_LIFT = -14;
    interface Field {
        /** Distance (mask px) to the nearest transparent pixel; 0 where transparent. */
        outside: Float32Array;
        /** Distance (mask px) to the nearest opaque pixel; 0 where opaque. */
        inside: Float32Array;
    }
    const fields: (Field | undefined)[] = new Array(layers.length).fill(undefined);
    const lifts: number[] = new Array(layers.length).fill(0);
    const geometry = layers.map(() => ({ cos: 1, sin: 0, scale: 1, offsetX: 0, offsetY: 0, ready: false }));
    let geometryKey = '';

    // Two-pass chamfer distance transform (close to Euclidean, linear time)
    const distanceTransform = (isSource: Uint8Array) => {
        const distance = new Float32Array(SIZE * SIZE);
        const DIAGONAL = Math.SQRT2;
        for (let i = 0; i < distance.length; i += 1) distance[i] = isSource[i] ? 0 : 1e6;

        for (let y = 0; y < SIZE; y += 1) {
            for (let x = 0; x < SIZE; x += 1) {
                const i = y * SIZE + x;
                let best = distance[i];
                if (x > 0) best = Math.min(best, distance[i - 1] + 1);
                if (y > 0) {
                    best = Math.min(best, distance[i - SIZE] + 1);
                    if (x > 0) best = Math.min(best, distance[i - SIZE - 1] + DIAGONAL);
                    if (x < SIZE - 1) best = Math.min(best, distance[i - SIZE + 1] + DIAGONAL);
                }
                distance[i] = best;
            }
        }
        for (let y = SIZE - 1; y >= 0; y -= 1) {
            for (let x = SIZE - 1; x >= 0; x -= 1) {
                const i = y * SIZE + x;
                let best = distance[i];
                if (x < SIZE - 1) best = Math.min(best, distance[i + 1] + 1);
                if (y < SIZE - 1) {
                    best = Math.min(best, distance[i + SIZE] + 1);
                    if (x < SIZE - 1) best = Math.min(best, distance[i + SIZE + 1] + DIAGONAL);
                    if (x > 0) best = Math.min(best, distance[i + SIZE - 1] + DIAGONAL);
                }
                distance[i] = best;
            }
        }
        return distance;
    };

    const buildField = (index: number) => {
        const image = layers[index];
        if (fields[index] || !image.naturalWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, SIZE, SIZE);
        const data = context.getImageData(0, 0, SIZE, SIZE).data;
        const opaque = new Uint8Array(SIZE * SIZE);
        const transparent = new Uint8Array(SIZE * SIZE);
        for (let i = 0; i < opaque.length; i += 1) {
            const isOpaque = data[i * 4 + 3] > 16;
            opaque[i] = isOpaque ? 1 : 0;
            transparent[i] = isOpaque ? 0 : 1;
        }
        fields[index] = { outside: distanceTransform(transparent), inside: distanceTransform(opaque) };
    };

    // Build the edge fields right after each layer arrives, one per task so the page never stalls
    const idle: (callback: () => void) => void = (callback) => window.setTimeout(callback, 0);
    const isBuildable = (index: number) =>
        !fields[index] && layers[index].complete && layers[index].naturalWidth > 0;
    const processQueue = () => {
        const next = layers.findIndex((_, index) => isBuildable(index));
        if (next === -1) return;
        buildField(next);
        if (layers.some((_, index) => isBuildable(index))) idle(processQueue);
    };
    layers.forEach((layer) => layer.addEventListener('load', () => idle(processQueue), { once: true }));
    idle(processQueue);

    const updateGeometry = (rect: DOMRect) => {
        const key = `${rect.width}x${rect.height}`;
        if (key === geometryKey && geometry.every((entry) => entry.ready)) return;
        geometryKey = key;
        layers.forEach((layer, index) => {
            if (!layer.naturalWidth) {
                geometry[index].ready = false;
                return;
            }
            const rotation = ((Number(layer.dataset.mapLayer) - 3.5) * 1.05 * Math.PI) / 180;
            const scale = Math.max(rect.width / layer.naturalWidth, rect.height / layer.naturalHeight);
            geometry[index] = {
                cos: Math.cos(rotation),
                sin: Math.sin(rotation),
                scale,
                offsetX: (rect.width - layer.naturalWidth * scale) / 2,
                offsetY: (rect.height - layer.naturalHeight * scale) / 2,
                ready: true,
            };
        });
    };

    const setLift = (index: number, value: number) => {
        const rounded = Math.round(value * 10) / 10;
        if (lifts[index] === rounded) return;
        lifts[index] = rounded;
        layers[index].style.setProperty('--map-lift', `${rounded}px`);
    };

    const maskIndex = (index: number, x: number, y: number, rect: DOMRect) => {
        const g = geometry[index];
        if (!g.ready) return -1;
        const layer = layers[index];
        const offsetX = x - (rect.left + rect.width / 2);
        const offsetY = y - (rect.top + rect.height / 2);
        const localX = g.cos * offsetX + g.sin * offsetY + rect.width / 2;
        const localY = -g.sin * offsetX + g.cos * offsetY + rect.height / 2;
        const sourceX = (localX - g.offsetX) / (layer.naturalWidth * g.scale);
        const sourceY = (localY - g.offsetY) / (layer.naturalHeight * g.scale);
        if (sourceX < 0 || sourceX > 1 || sourceY < 0 || sourceY > 1) return -1;
        return (
            Math.min(SIZE - 1, Math.floor(sourceY * SIZE)) * SIZE +
            Math.min(SIZE - 1, Math.floor(sourceX * SIZE))
        );
    };

    const targets: number[] = new Array(layers.length).fill(0);
    const currents: number[] = new Array(layers.length).fill(0);
    const resetLifts = () => targets.fill(0);

    handlers.push({
        cover,
        update(x, y, rect) {
            updateGeometry(rect);
            const positions = layers.map((_, index) => maskIndex(index, x, y, rect));
            const raisedIndex = positions.findIndex((position, index) => {
                const field = fields[index];
                return field !== undefined && position >= 0 && field.outside[position] > 0;
            });

            const wanted = new Array<number>(layers.length).fill(0);
            if (raisedIndex !== -1) {
                const field = fields[raisedIndex] as Field;
                const edgeDistance = Math.min(EDGE + 1, field.outside[positions[raisedIndex]]);
                wanted[raisedIndex] = MAX_LIFT * (1 - (1 - Math.min(1, edgeDistance / EDGE)) ** 7);

                const previous = raisedIndex - 1;
                const previousField = previous >= 0 ? fields[previous] : undefined;
                if (previousField && positions[previous] >= 0 && previousField.inside[positions[previous]] > 0) {
                    const nearestOpaque = Math.min(EDGE + 1, previousField.inside[positions[previous]]);
                    const progress = Math.max(0, 1 - nearestOpaque / EDGE);
                    wanted[previous] = MAX_LIFT * progress * progress * (3 - 2 * progress) * 0.35;
                }
            }
            wanted.forEach((value, index) => {
                targets[index] = value;
            });
        },
        leave: resetLifts,
        step(dt) {
            // Layer edges are steep, so the lift is smoothed per frame instead of following the pointer 1:1
            const k = 1 - 0.8 ** (dt / 16.667);
            let moving = false;
            for (let index = 0; index < currents.length; index += 1) {
                const delta = targets[index] - currents[index];
                if (Math.abs(delta) > 0.03) {
                    currents[index] += delta * k;
                    moving = true;
                } else {
                    currents[index] = targets[index];
                }
                setLift(index, currents[index]);
            }
            return moving;
        },
    });
};

/* Graphics: layered panels lift and tilt toward the pointer. */
const initGraphics = (cover: HTMLElement) => {
    const stack = cover.querySelector<HTMLElement>('.exhibition-stack');
    if (!stack) return;

    const pairs = Array.from(stack.querySelectorAll<HTMLElement>('.exhibition-layer-pair'))
        .map((pair) => {
            const bounds = pair.dataset.bounds?.split(',').map(Number);
            return {
                layer: pair.querySelector<HTMLElement>('.exhibition-layer'),
                shadow: pair.querySelector<HTMLElement>('.exhibition-shadow'),
                depth: Number(pair.dataset.depth),
                bounds: bounds && bounds.length === 4 && !bounds.some(Number.isNaN) ? bounds : undefined,
                key: '',
            };
        })
        .filter((pair) => pair.layer && pair.shadow);

    const apply = (
        pair: (typeof pairs)[number],
        layerTransform: string,
        shadowTransform: string,
        shadowOpacity: string,
    ) => {
        const key = `${layerTransform}|${shadowTransform}|${shadowOpacity}`;
        if (key === pair.key) return;
        pair.key = key;
        (pair.layer as HTMLElement).style.transform = layerTransform;
        (pair.shadow as HTMLElement).style.transform = shadowTransform;
        (pair.shadow as HTMLElement).style.opacity = shadowOpacity;
    };

    const resetAll = () => pairs.forEach((pair) => apply(pair, '', '', ''));

    handlers.push({
        cover,
        update(x, y, rect) {
            const radius = Math.min(rect.width, rect.height) * 0.16;
            const imageScale = Math.max(rect.width / 1920, rect.height / 1080);
            const imageWidth = 1920 * imageScale;
            const imageHeight = 1080 * imageScale;
            const imageLeft = rect.left + (rect.width - imageWidth) / 2;
            const imageTop = rect.top + (rect.height - imageHeight) / 2;

            for (const pair of pairs) {
                if (!pair.bounds) {
                    apply(pair, '', '', '');
                    continue;
                }
                const [sourceX, sourceY, sourceWidth, sourceHeight] = pair.bounds;
                const artLeft = imageLeft + sourceX * imageWidth;
                const artTop = imageTop + sourceY * imageHeight;
                const artRight = artLeft + sourceWidth * imageWidth;
                const artBottom = artTop + sourceHeight * imageHeight;
                const offsetX = x - clamp(x, artLeft, artRight);
                const offsetY = y - clamp(y, artTop, artBottom);
                const distance = Math.hypot(offsetX, offsetY);

                if (distance >= radius) {
                    apply(pair, '', '', '');
                    continue;
                }

                const influence = 1 - distance / radius;
                const localX = clamp(offsetX / radius, -1, 1);
                const localY = clamp(offsetY / radius, -1, 1);
                const lift = influence * pair.depth * 10;
                const popDepth = influence * pair.depth * 14;
                const rotateX = -localY * influence * pair.depth * 2;
                const rotateY = localX * influence * pair.depth * 2;
                const shadowOffset = lift * 0.32;

                apply(
                    pair,
                    `translate3d(0, ${(-lift).toFixed(2)}px, ${popDepth.toFixed(2)}px) ` +
                        `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`,
                    `translate3d(${(-shadowOffset).toFixed(2)}px, ${(shadowOffset * 0.28).toFixed(2)}px, 0)`,
                    `${Math.min(0.22, influence * pair.depth * 0.18).toFixed(3)}`,
                );
            }
        },
        leave: resetAll,
    });
};

/* Swaplings: the logo pops in lockstep with the card, using the same reach, progress and smoothing as initTilt. */
const initPop = (cover: HTMLElement, card: HTMLElement, subject: HTMLElement) => {
    const state = { pop: 0, rotateX: 0, rotateY: 0 };
    const target = { pop: 0, rotateX: 0, rotateY: 0 };
    let applied = '';
    let engaged = false;

    const setEngaged = (value: boolean) => {
        if (engaged === value) return;
        engaged = value;
        card.classList.toggle('is-popping', value);
        cover.classList.toggle('is-popping', value);
        subject.classList.toggle('is-popped', value);
    };

    handlers.push({
        cover,
        reach: (rect) => {
            const distance = Math.min(rect.width, rect.height) * 0.13;
            return { x: distance, y: distance };
        },
        update(x, y, rect) {
            const { width, height, left, top, right, bottom } = rect;
            const inside = x >= left && x <= right && y >= top && y <= bottom;
            const localX = (x - left) / width;
            const localY = (y - top) / height;
            let progress = 0;
            if (inside) {
                const edgeDepth = Math.min(localX, 1 - localX, localY, 1 - localY) * 2;
                progress = 0.22 + 0.78 * (1 - (1 - edgeDepth) ** 4);
            } else {
                const dx = Math.max(left - x, 0, x - right);
                const dy = Math.max(top - y, 0, y - bottom);
                const radius = Math.min(width, height) * 0.13;
                const influence = Math.max(0, 1 - Math.hypot(dx, dy) / radius);
                progress = influence * influence * (3 - 2 * influence) * 0.22;
            }
            target.pop = progress;
            target.rotateX = clamp(0.5 - localY, -0.5, 0.5) * 6 * progress;
            target.rotateY = clamp(localX - 0.5, -0.5, 0.5) * 6 * progress;
            setEngaged(true);
        },
        leave() {
            target.pop = 0;
            target.rotateX = 0;
            target.rotateY = 0;
        },
        step(dt) {
            const k = 1 - 0.78 ** (dt / 16.667);
            let moving = false;
            for (const key of ['pop', 'rotateX', 'rotateY'] as const) {
                const delta = target[key] - state[key];
                if (Math.abs(delta) > (key === 'pop' ? 0.0005 : 0.01)) {
                    state[key] += delta * k;
                    moving = true;
                } else {
                    state[key] = target[key];
                }
            }
            const atRest = state.pop === 0 && state.rotateX === 0 && state.rotateY === 0;
            const next = atRest
                ? ''
                : `translateY(${(-state.pop * 4).toFixed(2)}px) scale(${(1 + 0.1 * state.pop).toFixed(4)}) ` +
                  `rotateX(${state.rotateX.toFixed(2)}deg) rotateY(${state.rotateY.toFixed(2)}deg)`;
            if (next !== applied) {
                applied = next;
                subject.style.transform = next;
            }
            if (atRest && !moving) setEngaged(false);
            return moving;
        },
    });
};
/* Swaplings: the subject pops out of the card and tilts toward the pointer. */
const initCard = (cover: HTMLElement) => {
    const card = cover.querySelector<HTMLElement>('.card-cover');
    const subject = cover.querySelector<HTMLElement>('.cover-popout');
    const bounds = subject?.dataset.subjectBounds?.split(',').map(Number);
    const aspect = Number(subject?.dataset.aspect);
    if (!card || !subject || !bounds || bounds.length !== 4 || bounds.some(Number.isNaN) || !aspect) return;

    const isSwaplings = cover.classList.contains('cover--swaplings');
    if (isSwaplings) {
        initPop(cover, card, subject);
        return;
    }
    const [sourceX, sourceY, sourceWidth, sourceHeight] = bounds;
    let isActive = false;
    let applied = '';

    const reset = () => {
        if (!isActive) return;
        isActive = false;
        applied = '';
        subject.style.removeProperty('transform');
        card.classList.remove('is-popping');
        cover.classList.remove('is-popping');
        subject.classList.remove('is-popped');
    };

    handlers.push({
        cover,
        reach: (rect) => ({ x: rect.width * 0.2, y: rect.height * 0.22 }),
        update(x, y, rect) {
            const overCard = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            if (!overCard && !isActive) return;

            // Mirrors object-fit: cover for the subject image
            const coversByWidth = rect.width / rect.height >= aspect;
            const imageWidth = coversByWidth ? rect.width : rect.height * aspect;
            const imageHeight = coversByWidth ? rect.width / aspect : rect.height;
            const imageLeft = rect.left + (rect.width - imageWidth) / 2;
            const imageTop = rect.top + (rect.height - imageHeight) / 2;
            const rawX = (x - (imageLeft + sourceX * imageWidth)) / (sourceWidth * imageWidth);
            const rawY = (y - (imageTop + sourceY * imageHeight)) / (sourceHeight * imageHeight);
            // Once popped, the subject keeps a small grace margin so the edge does not flicker
            const margin = isActive ? 0.05 : 0;
            if (rawX < -margin || rawX > 1 + margin || rawY < -margin || rawY > 1 + margin) {
                reset();
                return;
            }
            const localX = clamp(rawX, 0, 1);
            const localY = clamp(rawY, 0, 1);

            const rotateX = (0.5 - localY) * 6;
            const rotateY = (localX - 0.5) * 6;
            const edgeDistance = Math.min(localX, 1 - localX, localY, 1 - localY) * 2;
            const logoDistance = Math.hypot((localX - 0.5) / 0.76, (localY - 0.84) / 0.48);
            const logoInfluence = isSwaplings ? (1 - Math.min(1, logoDistance)) ** 2 : 0;
            const liftProgress = 1 - (1 - Math.min(1, edgeDistance + logoInfluence)) ** 7;
            const maxScale = isSwaplings ? 1.1 : 1.02;
            const scale = 1 + (maxScale - 1) * liftProgress + logoInfluence * 0.015;
            const transform =
                `translateY(${(-logoInfluence * 4).toFixed(2)}px) scale(${scale.toFixed(4)}) ` +
                `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;

            if (!isActive) {
                isActive = true;
                card.classList.add('is-popping');
                cover.classList.add('is-popping');
                subject.classList.add('is-popped');
            }
            if (transform !== applied) {
                applied = transform;
                subject.style.transform = transform;
            }
        },
        leave: reset,
    });
    window.addEventListener('pointercancel', reset);
};

/* Callan: a localised mesh warp under the pointer, computed only inside the affected window. */
const initMesh = (cover: HTMLElement) => {
    const canvas = cover.querySelector<HTMLCanvasElement>('.mesh-canvas');
    const subjectUrl = canvas?.dataset.subjectSrc;
    const context = canvas?.getContext('2d');
    const sourceCanvas = document.createElement('canvas');
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!canvas || !subjectUrl || !context || !sourceContext) return;

    const subject = new Image();
    subject.decoding = 'async';
    subject.src = subjectUrl;

    // Keep the subject hidden until the background beneath it has loaded, so it never appears alone
    const blank = cover.querySelector<HTMLImageElement>('.mesh-blank');
    if (blank && !(blank.complete && blank.naturalWidth)) {
        canvas.style.visibility = 'hidden';
        blank.addEventListener('load', () => (canvas.style.visibility = ''), { once: true });
        blank.addEventListener('error', () => (canvas.style.visibility = ''), { once: true });
    }

    const INFLUENCE_CUTOFF = 1.5;
    const WINDOW = Math.sqrt(INFLUENCE_CUTOFF);
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let source8: Uint8ClampedArray | null = null;
    let source32: Uint32Array | null = null;
    let falloffs: Float32Array | null = null;
    let scratch: ImageData | null = null;
    let scratch32: Uint32Array | null = null;

    const smoothstep = (value: number) => {
        const t = clamp(value, 0, 1);
        return t * t * t * (t * (t * 6 - 15) + 10);
    };
    const contactMask = (
        x: number,
        y: number,
        centerX: number,
        centerY: number,
        radiusX: number,
        radiusY: number,
        blend: number,
    ) => {
        const distance = Math.sqrt(((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2);
        return smoothstep((distance - 1) / blend);
    };

    const ensure = (cssWidth: number, cssHeight: number) => {
        if (!subject.complete || !subject.naturalWidth) return false;
        pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
        const nextWidth = Math.round(cssWidth * pixelRatio);
        const nextHeight = Math.round(cssHeight * pixelRatio);
        if (nextWidth === width && nextHeight === height && source8) return true;
        if (!nextWidth || !nextHeight) return false;

        width = nextWidth;
        height = nextHeight;
        canvas.width = width;
        canvas.height = height;
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        scratch = null;
        scratch32 = null;

        const scale = Math.max(width / subject.naturalWidth, height / subject.naturalHeight);
        const cropWidth = width / scale;
        const cropHeight = height / scale;
        const cropLeft = (subject.naturalWidth - cropWidth) / 2;
        const cropTop = (subject.naturalHeight - cropHeight) / 2;
        sourceContext.clearRect(0, 0, width, height);
        sourceContext.drawImage(subject, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, width, height);
        const pixels = sourceContext.getImageData(0, 0, width, height);
        source8 = pixels.data;
        source32 = new Uint32Array(pixels.data.buffer);

        falloffs = new Float32Array(width * height);
        for (let y = 0; y < height; y += 1) {
            const normalizedY = (cropTop + (y / height) * cropHeight) / subject.naturalHeight;
            for (let x = 0; x < width; x += 1) {
                const normalizedX = (cropLeft + (x / width) * cropWidth) / subject.naturalWidth;
                falloffs[y * width + x] = Math.min(
                    contactMask(normalizedX, normalizedY, 0.58, 0.08, 0.3, 0.1, 0.45),
                    contactMask(normalizedX, normalizedY, 0.55, 0.83, 0.4, 0.05, 0.7),
                );
            }
        }
        return true;
    };

    const drawBase = () => {
        context.clearRect(0, 0, width, height);
        context.drawImage(sourceCanvas, 0, 0);
    };

    const drawWarp = (cssX: number, cssY: number) => {
        if (!source8 || !source32 || !falloffs) return;
        const pointerX = cssX * pixelRatio;
        const pointerY = cssY * pixelRatio;
        const radiusX = width * 0.2;
        const radiusY = height * 0.2;
        const x0 = Math.max(0, Math.floor(pointerX - radiusX * WINDOW));
        const x1 = Math.min(width, Math.ceil(pointerX + radiusX * WINDOW));
        const y0 = Math.max(0, Math.floor(pointerY - radiusY * WINDOW));
        const y1 = Math.min(height, Math.ceil(pointerY + radiusY * WINDOW));
        drawBase();
        const windowWidth = x1 - x0;
        const windowHeight = y1 - y0;
        if (windowWidth <= 0 || windowHeight <= 0) return;

        if (!scratch || scratch.width !== windowWidth || scratch.height !== windowHeight) {
            scratch = context.createImageData(windowWidth, windowHeight);
            scratch32 = new Uint32Array(scratch.data.buffer);
        }
        const output8 = scratch.data;
        const output32 = scratch32 as Uint32Array;
        const inverseX = 1 / (radiusX * radiusX);
        const inverseY = 1 / (radiusY * radiusY);
        const maxX = width - 1.001;
        const maxY = height - 1.001;

        for (let y = y0; y < y1; y += 1) {
            const dy = y - pointerY;
            const rowTerm = dy * dy * inverseY;
            const outputRow = (y - y0) * windowWidth;
            for (let x = x0; x < x1; x += 1) {
                const dx = x - pointerX;
                const distanceSquared = dx * dx * inverseX + rowTerm;
                const index = y * width + x;
                const outputIndex = outputRow + (x - x0);
                if (distanceSquared > INFLUENCE_CUTOFF) {
                    output32[outputIndex] = source32[index];
                    continue;
                }
                const influence = Math.exp(-distanceSquared * 2.4) * falloffs[index];
                if (influence < 0.0005) {
                    output32[outputIndex] = source32[index];
                    continue;
                }

                const sourceX = clamp(x - dx * influence * 0.08, 0, maxX);
                const sourceY = clamp(y - dy * influence * 0.08, 0, maxY);
                const left = sourceX | 0;
                const top = sourceY | 0;
                const xWeight = sourceX - left;
                const yWeight = sourceY - top;
                const base = (top * width + left) * 4;
                const below = base + width * 4;
                const byteIndex = outputIndex * 4;

                for (let channel = 0; channel < 4; channel += 1) {
                    const topLeft = source8[base + channel];
                    const bottomLeft = source8[below + channel];
                    const topValue = topLeft + (source8[base + 4 + channel] - topLeft) * xWeight;
                    const bottomValue = bottomLeft + (source8[below + 4 + channel] - bottomLeft) * xWeight;
                    output8[byteIndex + channel] = topValue + (bottomValue - topValue) * yWeight;
                }
            }
        }
        context.putImageData(scratch, x0, y0);
    };

    handlers.push({
        cover,
        update(x, y, rect) {
            if (!ensure(rect.width, rect.height)) return;
            drawWarp(x - rect.left, y - rect.top);
        },
        leave(_x, _y, rect) {
            if (rect && ensure(rect.width, rect.height)) drawBase();
        },
    });

    const refresh = () => {
        if (ensure(cover.clientWidth, cover.clientHeight)) drawBase();
    };
    subject.addEventListener('load', refresh);
    new ResizeObserver(refresh).observe(cover);
};

/* Every card stays blank until all of its images are decoded, then fades in as one piece. */
document.querySelectorAll<HTMLElement>('.cover').forEach((cover) => {
    const frame = cover.querySelector<HTMLElement>('.cover-frame');
    if (!frame) return;
    const reveal = () => frame.classList.add('is-ready');
    const images = Array.from(frame.querySelectorAll<HTMLImageElement>('img'));
    Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(reveal);
    // Safety net for a stalled request; cards far below the fold are left to lazy-load first
    window.setTimeout(() => {
        if (cover.getBoundingClientRect().top < window.innerHeight * 1.5) reveal();
    }, 4000);
});

covers.forEach((cover) => {
    initTilt(cover);
    const tiltHandlers = handlers.length;
    if (cover.classList.contains('cover--bar')) initBar(cover);
    if (cover.classList.contains('cover--robot')) initRobot(cover);
    if (cover.classList.contains('cover--presents')) initPresents(cover);
    if (cover.classList.contains('cover--maps')) initMaps(cover);
    if (cover.classList.contains('cover--layers')) initGraphics(cover);
    if (cover.classList.contains('cover--card')) initCard(cover);
    if (cover.classList.contains('cover--mesh')) initMesh(cover);
    for (let i = tiltHandlers; i < handlers.length; i += 1) handlers[i].motion = true;
});

measure();
