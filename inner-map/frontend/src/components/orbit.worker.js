// Runs the Orbit loading screen's 3D scene off the main thread (OffscreenCanvas), so it stays
// smooth while the page starts the globe. Messages from the page:
//   { type: 'init', canvas, width, height, dpr, modest, reduceMotion }   { type: 'state', s }
//   { type: 'resize', width, height, dpr }   { type: 'dispose' }
// Events back: whatever the scene emits, plus { type: 'fail' } when 3D cannot start here.
import { ImageBitmapLoader, SRGBColorSpace, Texture } from 'three';
import { createOrbitScene } from './orbitScene';

let scene = null;
let running = false;
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);

const loadTexture = (url, srgb) =>
  new Promise((resolve, reject) => {
    const loader = new ImageBitmapLoader();
    loader.setOptions({ imageOrientation: 'flipY' }); // like an <img> texture (three flips those)
    loader.load(
      url,
      (bitmap) => {
        const t = new Texture(bitmap);
        t.flipY = false;
        if (srgb) t.colorSpace = SRGBColorSpace;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      reject
    );
  });

const loop = (now) => {
  if (!running) return;
  scene.frame(now);
  raf(loop);
};

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      scene = createOrbitScene({ ...m, loadTexture, emit: (ev) => self.postMessage(ev) });
    } catch {
      self.postMessage({ type: 'fail' });
      return;
    }
    running = true;
    raf(loop);
  } else if (m.type === 'state' && scene) {
    scene.setState(m.s, performance.now());
  } else if (m.type === 'resize' && scene) {
    scene.resize(m.width, m.height, m.dpr);
  } else if (m.type === 'dispose') {
    running = false;
    scene?.dispose();
    scene = null;
    self.close();
  }
};
