import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeWorldCountries, matchRegionCountries, geographicVector, projectVector, unprojectGlobe, createGlobeClock, createGlobeInputQueue, findCountry, rotateGlobeView } from '../src/admin/visitorRegionGlobe.js';

test('real TopoJSON keeps 241 countries, correct delta arcs, and its existing source/license notice', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/world-borders.json', import.meta.url), 'utf8'));
  const world = decodeWorldCountries(data);
  assert.equal(world.countries.length, 241);
  assert.equal(world.countryByAlias.get('china').id, '156');
  assert.ok(world.countries.find(c => c.id === '528').polygons.length > 0);
  assert.equal(data.kkSource.dataLicense, 'public-domain');
  assert.ok(data.kkSource.worldAtlasLicenseNotice.includes('Michael Bostock'));
  assert.throws(() => decodeWorldCountries({ ...data, transform: null }), /transform/);
});

test('country matching preserves source prefixes and never guesses unknown regions or cities', async () => {
  const world = decodeWorldCountries(JSON.parse(await readFile(new URL('../public/data/world-borders.json', import.meta.url), 'utf8')));
  const rows = [{ name: '中国 · 浙江省 · 杭州市', requests: 8 }, { name: '中国 · 福建省', requests: 2 }, { name: 'Netherlands · South Holland', requests: 4 }, { name: 'NLD', requests: 1 }, { name: '美国', requests: 0 }, { name: '未知地域', requests: 7 }, { name: 'Korea', requests: 1 }, { name: 'Paris', requests: 2 }];
  const { groups, unmatched } = matchRegionCountries(world, rows);
  assert.deepEqual(groups.map(g => [g.country.id, g.name, g.requests]), [['156', '中国', 10], ['528', 'Netherlands', 5]]);
  assert.deepEqual(unmatched.map(r => r.name), ['未知地域', 'Korea', 'Paris']);
  assert.equal(findCountry(world, 'GBR').id, '826');
  assert.equal(findCountry(world, 'CN').id, '156');
  assert.equal(findCountry(world, '-99'), undefined);
});

test('orthographic projection inverts real front hemisphere coordinates and rejects outside the sphere', () => {
  for (const [lon, lat, angle] of [[116.4, 39.9, -1.8], [4.9, 52.4, 0], [-77, 39, 1.5], [179, 20, -3]]) {
    const [x, y, z] = projectVector(geographicVector(lon, lat), angle, .18);
    assert.ok(z > 0);
    const actual = unprojectGlobe(x, y, angle, .18);
    assert.ok(Math.abs(actual[0] - lon) < 1e-8);
    assert.ok(Math.abs(actual[1] - lat) < 1e-8);
  }
  assert.equal(unprojectGlobe(1.1, .2, 0), null);
});

test('drag rotation wraps horizontally, clamps both poles, and keeps geographic picking aligned after both axes change', () => {
  const start = { angle: -1.8, tilt: .18 };
  const moved = rotateGlobeView(start, 45, -20, 104);
  assert.notEqual(moved.angle, start.angle); assert.notEqual(moved.tilt, start.tilt);
  const [x, y, z] = projectVector(geographicVector(116.4, 39.9), moved.angle, moved.tilt);
  assert.ok(z > 0);
  const actual = unprojectGlobe(x, y, moved.angle, moved.tilt);
  assert.ok(Math.abs(actual[0] - 116.4) < 1e-8); assert.ok(Math.abs(actual[1] - 39.9) < 1e-8);
  assert.equal(rotateGlobeView(start, 0, 10000, 104).tilt, 1.15);
  assert.equal(rotateGlobeView(start, 0, -10000, 104).tilt, -1.15);
  const wrapped = rotateGlobeView(start, 10000, 0, 104);
  assert.ok(wrapped.angle >= -Math.PI && wrapped.angle <= Math.PI);
  assert.ok(Math.abs(Math.sin(wrapped.angle) - Math.sin(start.angle + 10000 * .8 / 104)) < 1e-10);
});

test('30fps clock cancels pending work, resumes without time jumps, and disposes permanently', () => {
  const pending = new Map(), deltas = []; let id = 0;
  const clock = createGlobeClock({ draw: dt => deltas.push(dt), raf: callback => { pending.set(++id, callback); return id; }, cancel: handle => pending.delete(handle) });
  const frame = time => { const work = [...pending.values()]; pending.clear(); work.forEach(cb => cb(time)); };
  clock.start(); for (let time = 0; time < 1000; time += 1000 / 60) frame(time);
  assert.ok(deltas.length >= 29 && deltas.length <= 31);
  clock.stop(); assert.equal(pending.size, 0); const count = deltas.length; frame(10000); assert.equal(deltas.length, count);
  clock.start(); frame(20000); assert.equal(deltas.at(-1), 0);
  clock.dispose(); assert.equal(pending.size, 0); clock.start(); clock.invalidate(); assert.equal(pending.size, 0); assert.equal(deltas.length, count + 1);
});

test('high-frequency drag inputs share one frame while preserving their complete movement and final pointerup position', () => {
  const pending = new Map(), rotations = []; let id = 0, paints = 0;
  const input = createGlobeInputQueue({ rotate: (x, y) => rotations.push([x, y]), paint: () => paints++, raf: callback => { pending.set(++id, callback); return id; }, cancel: handle => pending.delete(handle) });
  for (let i = 0; i < 20; i++) input.move(2, -1);
  assert.equal(pending.size, 1); assert.equal(paints, 0);
  [...pending.values()][0]();
  assert.deepEqual(rotations, [[40, -20]]); assert.equal(paints, 1);
  input.move(5, 3); input.flush();
  assert.deepEqual(rotations, [[40, -20], [5, 3]]); assert.equal(paints, 2); assert.equal(pending.size, 0);
  input.dispose();
});

test('hidden/offscreen cancellation and unmount discard queued input and never draw later', () => {
  const pending = new Map(); let paints = 0, id = 0;
  const input = createGlobeInputQueue({ rotate: () => {}, paint: () => paints++, raf: callback => { pending.set(++id, callback); return id; }, cancel: handle => pending.delete(handle) });
  input.move(12, 10); input.cancel(); assert.equal(pending.size, 0); input.flush(); assert.equal(paints, 0);
  input.move(15, 5); input.dispose(); assert.equal(pending.size, 0); input.move(5, 5); input.flush(); assert.equal(paints, 0);
});
