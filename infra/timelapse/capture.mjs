// Fixed-camera frame capture from the timelapse BlueMap webserver (127.0.0.1:8101).
// stdin: JSON [{url, out, width, height, settle_ms, reuse?, deadline_ms?, est_ms?}], one browser for all frames.
// REUSE (tlvideo-01): with `reuse`, consecutive jobs share ONE page and the camera moves by location.hash (BlueMap reads
// the hash on hashchange), so the webapp, its shaders and the tiles already loaded are not rebuilt per camera; the
// camera is read back and a job whose position does not match is retried on a fresh page. DEADLINE: a job that would
// end past deadline_ms (now + est_ms) is not started (`skip <out> deadline`), so a run ends inside its slot.
// PIN (tlvideo-01): BlueMap's MapControls keep easing the camera height toward the terrain under the target (+3), so
// a frame's framing depended on which tiles had loaded and on what the bots had built at the centre (two captures of
// the same render differed in ~40% of pixels; pinned, 0%). With `pin`, the controls are detached once the camera is
// placed and the height is the hash's y: the same render always gives the same frame, fresh page or reused.
// Each `ok` line carries ms=<job wall time>.
// The URL hash carries the whole camera (map:x:y:z:distance:rotation:angle:tilt:ortho:mode),
// so the same site config always produces the same view.
// Software WebGL (SwiftShader): this host has no GPU. --no-sandbox because Ubuntu 24.04
// restricts unprivileged user namespaces; the only page loaded is our own localhost map.
import puppeteer from 'puppeteer';

// #app holds every overlay (control bar, compass, zoom buttons, menus); the WebGL
// canvas lives in #map-container, outside it.
const HIDE_UI = `#app { display: none !important; }`;

// Marker sets (11-02: the whole-map route layer drew trails, zone boxes and pins over EVERY camera). A job may carry
// `markers`: the ids of the marker sets to SHOW; every other set is hidden (BlueMap's own `bm-*` sets are left alone).
// A job without `markers` leaves the map's defaults (the .30 timelapse). Returns the sets left wrongly shown/hidden.
const applyMarkers = show => {
  const root = window.bluemap?.mapViewer?.markers;
  if (!root?.markerSets) return ['no marker root'];
  const bad = [];
  for (const [id, set] of root.markerSets) {
    if (id.startsWith('bm-')) continue;
    const want = show.includes(id);
    if (set.visible !== want) set.visible = want;
    if (set.visible !== want) bad.push(id);
  }
  window.bluemap.mapViewer.redraw?.();
  return bad;
};

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const jobs = JSON.parse(Buffer.concat(chunks).toString());

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
// The camera BlueMap is showing, from the hash fields: [x, z, distance, rotation, angle, ortho].
const camNow = () => {
  const c = window.bluemap?.mapViewer?.controlsManager;
  return c ? [c.position.x, c.position.z, c.distance, c.rotation, c.angle, c.ortho] : null;
};
const want = url => {
  const f = url.slice(url.indexOf('#') + 1).split(':');
  return [+f[1], +f[3], +f[4], +f[5], +f[6], +f[8]];
};
const pinTo = y => {
  const cm = window.bluemap?.mapViewer?.controlsManager;
  if (!cm) return null;
  cm.controls = null;               // no terrain following, no smoothing: the camera stays where it is put
  cm.position.y = y;
  window.bluemap.mapViewer.redraw?.();
  return cm.position.y;
};
const hashY = url => +url.slice(url.indexOf('#') + 1).split(':')[2];
const close = (a, b) => a && b && a.every((x, i) => Math.abs(x - b[i]) <= (i < 3 ? 0.6 : 0.01));

let failed = 0;
let shared = null;          // the reused page
try {
  for (const j of jobs) {
    if (j.deadline_ms && Date.now() + (j.est_ms ?? 60000) > j.deadline_ms) {
      console.log(`skip ${j.out} deadline`);
      continue;
    }
    const t0 = Date.now();
    let page = null;
    const errs = [];
    try {
      let moved = false;
      if (j.reuse && shared) {
        page = shared;
        const vp = page.viewport();
        if (vp.width !== j.width || vp.height !== j.height) {
          await page.setViewport({ width: j.width, height: j.height, deviceScaleFactor: 1 });
        }
        await page.evaluate(() => {           // back to the defaults a previous camera may have changed
          const cam = window.bluemap.mapViewer.camera;
          if (cam.fov !== 75) { cam.fov = 75; cam.updateProjectionMatrix(); }
        });
        await page.evaluate(h => { window.location.hash = h; }, j.url.slice(j.url.indexOf('#')));
        await page.waitForFunction((w) => {
          const c = window.bluemap?.mapViewer?.controlsManager;
          if (!c) return false;
          const n = [c.position.x, c.position.z, c.distance, c.rotation, c.angle, c.ortho];
          return n.every((x, i) => Math.abs(x - w[i]) <= (i < 3 ? 0.6 : 0.01));
        }, { timeout: 15000, polling: 200 }, want(j.url)).then(() => { moved = true; }).catch(() => {});
        if (!moved) {                          // the hash did not move the camera: this job on a fresh page
          await page.close().catch(() => {});
          shared = null;
        }
      }
      if (!moved) {
        page = await browser.newPage();
        page.on('pageerror', e => errs.push(String(e)));
        await page.setViewport({ width: j.width, height: j.height, deviceScaleFactor: 1 });
        await page.goto(j.url, { waitUntil: 'networkidle0', timeout: 120000 });
        await page.addStyleTag({ content: HIDE_UI });
        if (j.reuse) shared = page;
      }
      if (j.pin) {
        const y = await page.evaluate(pinTo, hashY(j.url));
        if (y !== hashY(j.url)) throw new Error(`could not pin the camera height (got ${y})`);
      }
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
      if (Array.isArray(j.markers)) {
        const bad = await page.evaluate(applyMarkers, j.markers);
        if (bad.length) throw new Error(`marker visibility not applied: ${bad.join(',')}`);
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
      const at = await page.evaluate(camNow);
      if (moved && !close(at, want(j.url))) throw new Error(`camera not at the job's position (at ${JSON.stringify(at)})`);
      if (j.pin) {
        const y = await page.evaluate(() => window.bluemap.mapViewer.controlsManager.position.y);
        if (y !== hashY(j.url)) throw new Error(`camera height drifted to ${y} before capture`);
      }
      if (Array.isArray(j.markers)) {
        // again just before the shot: the 10 s markers.json refresh can add a set created after the first pass
        const bad = await page.evaluate(applyMarkers, j.markers);
        if (bad.length) throw new Error(`marker visibility drifted: ${bad.join(',')}`);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      await page.screenshot({ path: j.out, type: 'png' });
      console.log(`ok ${j.out} ms=${Date.now() - t0}${moved ? ' reused' : ''}${errs.length ? ' pageerrors=' + errs.length : ''}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${j.out}: ${e.message}`);
      if (page && page === shared) shared = null;     // a failed page is never reused
      if (page) await page.close().catch(() => {});
      continue;
    }
    if (page && page !== shared) await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
