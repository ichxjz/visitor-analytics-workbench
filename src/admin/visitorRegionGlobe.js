// Natural Earth / world-atlas data provenance and ISC notice stay embedded in
// public/data/world-borders.json. No city/visitor coordinates are generated.
const RAD = Math.PI / 180;
const aliases = [
  ['156','CN','CHN','中国','中华人民共和国','中国大陆','Mainland China'],
  ['528','NL','NLD','荷兰'],['840','US','USA','美国','United States'],['826','GB','GBR','英国','UK','United Kingdom'],
  ['250','FR','FRA','法国'],['276','DE','DEU','德国'],['392','JP','JPN','日本'],['410','KR','KOR','韩国','South Korea'],
  ['408','KP','PRK','朝鲜','North Korea'],['643','RU','RUS','俄罗斯'],['036','AU','AUS','澳大利亚'],['554','NZ','NZL','新西兰'],
  ['124','CA','CAN','加拿大'],['702','SG','SGP','新加坡'],['344','HK','HKG','香港','中国香港'],['158','TW','TWN','台湾','中国台湾'],
  ['446','MO','MAC','澳门','中国澳门','Macau'],['756','CH','CHE','瑞士'],['040','AT','AUT','奥地利'],['056','BE','BEL','比利时'],
  ['442','LU','LUX','卢森堡'],['352','IS','ISL','冰岛'],['372','IE','IRL','爱尔兰'],['724','ES','ESP','西班牙'],['620','PT','PRT','葡萄牙'],
  ['380','IT','ITA','意大利'],['752','SE','SWE','瑞典'],['578','NO','NOR','挪威'],['246','FI','FIN','芬兰'],['208','DK','DNK','丹麦'],
  ['616','PL','POL','波兰'],['203','CZ','CZE','捷克'],['642','RO','ROU','罗马尼亚'],['348','HU','HUN','匈牙利'],['300','GR','GRC','希腊'],
  ['792','TR','TUR','土耳其'],['356','IN','IND','印度'],['360','ID','IDN','印度尼西亚','印尼'],['458','MY','MYS','马来西亚'],
  ['764','TH','THA','泰国'],['704','VN','VNM','越南'],['608','PH','PHL','菲律宾'],['076','BR','BRA','巴西'],['032','AR','ARG','阿根廷'],
  ['484','MX','MEX','墨西哥'],['152','CL','CHL','智利'],['710','ZA','ZAF','南非'],['818','EG','EGY','埃及'],['784','AE','ARE','阿联酋'],
  ['682','SA','SAU','沙特阿拉伯'],['376','IL','ISR','以色列'],['804','UA','UKR','乌克兰'],['364','IR','IRN','伊朗'],
  ['586','PK','PAK','巴基斯坦'],['050','BD','BGD','孟加拉国'],
];
const key = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const regionCountryName = value => String(typeof value === 'string' ? value : value?.name || value?.region || '').split(/[·|｜]/)[0].trim();

export function decodeWorldCountries(topology) {
  if (topology?.type !== 'Topology' || !Array.isArray(topology.arcs) || !Array.isArray(topology.objects?.countries?.geometries)) throw new Error('Invalid world boundary data');
  const [sx, sy] = topology.transform?.scale || [], [tx, ty] = topology.transform?.translate || [];
  if (![sx, sy, tx, ty].every(Number.isFinite) || sx <= 0 || sy <= 0) throw new Error('Invalid world boundary transform');
  const arcs = topology.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(delta => {
      if (!Array.isArray(delta) || !delta.every(Number.isFinite)) throw new Error('Invalid world boundary coordinate');
      x += delta[0]; y += delta[1];
      const point = [x * sx + tx, y * sy + ty];
      if (Math.abs(point[0]) > 180.01 || Math.abs(point[1]) > 90.01) throw new Error('World boundary outside Earth');
      return point;
    });
  });
  const ring = references => {
    const points = [];
    for (const index of references) {
      const arc = arcs[index < 0 ? ~index : index];
      if (!arc) throw new Error('Missing world boundary arc');
      const part = index < 0 ? [...arc].reverse() : arc;
      points.push(...(points.length ? part.slice(1) : part));
    }
    return points;
  };
  const countries = topology.objects.countries.geometries.filter(g => ['Polygon', 'MultiPolygon'].includes(g.type)).map(g => ({
    id: String(g.id).padStart(3, '0'), name: g.properties?.name || String(g.id),
    polygons: (g.type === 'Polygon' ? [g.arcs] : g.arcs).map(polygon => polygon.map(ring)),
  }));
  const countryByAlias = new Map();
  for (const country of countries) { countryByAlias.set(key(country.name), country); if (/^\d{3}$/.test(country.id)) countryByAlias.set(key(country.id), country); }
  for (const [id, ...names] of aliases) {
    const country = countries.find(item => item.id === id);
    if (country) for (const name of names) countryByAlias.set(key(name), country);
  }
  return { countries, arcs, countryByAlias };
}

export function matchRegionCountries(world, regions = []) {
  const grouped = new Map(), unmatched = [];
  for (const row of regions) {
    const name = regionCountryName(row);
    const amount = row?.requests ?? row?.views ?? row?.count;
    if (amount != null && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) continue;
    const country = world.countryByAlias.get(key(name));
    if (!country) { unmatched.push(row); continue; }
    if (!grouped.has(country.id)) grouped.set(country.id, { country, name, regions: [], requests: 0 });
    const group = grouped.get(country.id);
    group.regions.push(row); group.requests += Math.max(0, Number(amount) || 0);
  }
  return { groups: [...grouped.values()], unmatched };
}
export const findCountry = (world, name) => world?.countryByAlias.get(key(regionCountryName(name)));
export function geographicVector(longitude, latitude) {
  const lat = latitude * RAD, lon = longitude * RAD, c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}
export function projectVector(v, angle, tilt = .2) {
  const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt);
  const x = v[0] * ca + v[2] * sa, z = v[2] * ca - v[0] * sa;
  return [x, v[1] * ct - z * st, v[1] * st + z * ct];
}
export function unprojectGlobe(x, y, angle, tilt = .2) {
  const r = x * x + y * y;
  if (r > 1) return null;
  const z = Math.sqrt(Math.max(0, 1 - r)), ct = Math.cos(tilt), st = Math.sin(tilt);
  const yy = y * ct + z * st, zz = z * ct - y * st, ca = Math.cos(angle), sa = Math.sin(angle);
  return [Math.atan2(x * ca - zz * sa, zz * ca + x * sa) / RAD, Math.asin(Math.max(-1, Math.min(1, yy))) / RAD];
}

// Share one orientation for drawing and geographic picking. Limit vertical
// rotation before the poles flip over; horizontal dragging remains continuous.
export function rotateGlobeView({ angle, tilt }, deltaX, deltaY, radius) {
  const scale = .8 / Math.max(1, radius), tau = Math.PI * 2;
  return {
    angle: ((angle + deltaX * scale + Math.PI) % tau + tau) % tau - Math.PI,
    tilt: Math.max(-1.15, Math.min(1.15, tilt + deltaY * scale)),
  };
}

// Pointer hardware can deliver several updates before one display refresh.
// Accumulate their full movement, then draw the latest orientation only once.
export function createGlobeInputQueue({ rotate, paint, raf = requestAnimationFrame, cancel = cancelAnimationFrame }) {
  let handle = null, x = 0, y = 0, disposed = false;
  const clear = () => { if (handle != null) cancel(handle); handle = null; x = 0; y = 0; };
  const flush = () => {
    if (handle != null) cancel(handle); handle = null;
    if (disposed || (!x && !y)) return;
    const dx = x, dy = y; x = 0; y = 0; rotate(dx, dy); paint();
  };
  return {
    move(dx, dy) { if (disposed) return; x += dx; y += dy; if (handle == null) handle = raf(flush); },
    flush,
    cancel: clear,
    dispose() { clear(); disposed = true; },
  };
}

// An explicit, pausable clock. No elapsed hidden/offscreen time is accumulated.
export function createGlobeClock({ draw, raf = requestAnimationFrame, cancel = cancelAnimationFrame, fps = 30 }) {
  let handle = null, last = null, previousDraw = -Infinity, running = false, disposed = false;
  const tick = time => {
    handle = null;
    if (!running || disposed) return;
    if (time - previousDraw >= 1000 / fps - .5) {
      const delta = last == null ? 0 : Math.min(.08, Math.max(0, (time - last) / 1000));
      last = time; previousDraw = time; draw(delta);
    }
    handle = raf(tick);
  };
  const stop = () => { running = false; if (handle != null) cancel(handle); handle = null; last = null; previousDraw = -Infinity; };
  return {
    start() { if (running || disposed) return; running = true; handle = raf(tick); },
    stop,
    invalidate() { if (!disposed) draw(0); },
    dispose() { stop(); disposed = true; },
  };
}
