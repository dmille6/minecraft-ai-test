// Fixed-camera frame capture from the timelapse BlueMap webserver (127.0.0.1:8101).
// stdin: JSON [{url, out, width, height, settle_ms}], one browser for all frames.
// The URL hash carries the whole camera (map:x:y:z:distance:rotation:angle:tilt:ortho:mode),
// so the same site config always produces the same view.
// Software WebGL (SwiftShader): this host has no GPU. --no-sandbox because Ubuntu 24.04
// restricts unprivileged user namespaces; the only page loaded is our own localhost map.
import puppeteer from 'puppeteer';

// #app holds every overlay (control bar, compass, zoom buttons, menus); the WebGL
// canvas lives in #map-container, outside it.
const HIDE_UI = `#app { display: none !important; }`;

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const jobs = JSON.parse(Buffer.concat(chunks).toString());

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
let failed = 0;
try {
  for (const j of jobs) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.setViewport({ width: j.width, height: j.height, deviceScaleFactor: 1 });
    try {
      await page.goto(j.url, { waitUntil: 'networkidle0', timeout: 120000 });
      await page.addStyleTag({ content: HIDE_UI });
      if (j.fov) {
        // a narrower lens than BlueMap's 75 deg default: less fisheye on the near edge.
        // The hash already set the distance (scaled for this fov by tl.py).
        const got = await page.evaluate(fov => {
          const cam = window.bluemap?.mapViewer?.camera;
          if (!cam) return null;
          cam.fov = fov; cam.updateProjectionMatrix();
          window.bluemap.mapViewer.redraw?.();
          return cam.fov;
        }, j.fov);
        if (got !== j.fov) throw new Error(`could not set fov (got ${got})`);
      }
      // tiles stream in after the first idle; wait for a second quiet period, then settle
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 120000 }).catch(() => {});
      await new Promise(r => setTimeout(r, j.settle_ms ?? 6000));
      await page.waitForNetworkIdle({ idleTime: 2000, timeout: 60000 }).catch(() => {});
      const hasCanvas = await page.$('canvas') !== null;
      if (!hasCanvas) throw new Error('no WebGL canvas on the page');
      if (j.fov) {
        const fovNow = await page.evaluate(() => window.bluemap.mapViewer.camera.fov);
        if (fovNow !== j.fov) throw new Error(`fov drifted to ${fovNow} before capture`);
      }
      await page.screenshot({ path: j.out, type: 'png' });
      console.log(`ok ${j.out}${errs.length ? ' pageerrors=' + errs.length : ''}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${j.out}: ${e.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
