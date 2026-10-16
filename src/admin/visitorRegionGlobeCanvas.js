import { geographicVector, rotateGlobeView, unprojectGlobe } from './visitorRegionGlobe.js';

const W = 1080, H = 540;
const unwrapRing = ring => {
  let previous = ring[0]?.[0] || 0;
  return ring.map(([lon, lat]) => { while (lon - previous > 180) lon -= 360; while (lon - previous < -180) lon += 360; previous = lon; return [lon, lat]; });
};
const vectorLine = points => {
  const values = []; let previous;
  for (let i = 0; i < points.length; i++) {
    const point = points[i], v = geographicVector(...point);
    if (previous && i < points.length - 1 && (v[0] - previous[0]) ** 2 + (v[1] - previous[1]) ** 2 + (v[2] - previous[2]) ** 2 < .00003) continue;
    values.push(...v); previous = v;
  }
  return new Float32Array(values);
};

// A small, one-time country-ID raster is used for real polygon hit-testing and
// land dots. It is not a visitor-position texture, nor is it uploaded anywhere.
export function prepareGlobeSurface(world, createCanvas = () => document.createElement('canvas')) {
  const mask = createCanvas(); mask.width = W; mask.height = H;
  const context = mask.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const lookup = new Map();
  world.countries.forEach((country, index) => {
    const code = ((index + 1) * 0x5bd1e9) & 0xffffff;
    lookup.set(code, index + 1); context.fillStyle = '#' + code.toString(16).padStart(6, '0');
    for (const polygon of country.polygons) {
      const rings = polygon.map(unwrapRing);
      const mean = rings[0].reduce((n, p) => n + p[0], 0) / rings[0].length;
      for (const shift of [-360, 0, 360]) {
        context.beginPath();
        for (const ring of rings) {
          const middle = ring.reduce((n, p) => n + p[0], 0) / ring.length;
          const correction = Math.round((mean - middle) / 360) * 360 + shift;
          ring.forEach(([lon, lat], i) => { const x = (lon + correction + 180) / 360 * W, y = (90 - lat) / 180 * H; if (i) context.lineTo(x, y); else context.moveTo(x, y); });
          context.closePath();
        }
        context.fill('evenodd');
      }
    }
  });
  const rgba = context.getImageData(0, 0, W, H).data, indices = new Uint16Array(W * H);
  for (let i = 0; i < indices.length; i++) if (rgba[i * 4 + 3] > 253) indices[i] = lookup.get((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]) || 0;
  const at = (lon, lat) => {
    const x = Math.max(0, Math.min(W - 1, Math.floor((lon + 180) / 360 * W))), y = Math.max(0, Math.min(H - 1, Math.floor((90 - lat) / 180 * H)));
    return indices[y * W + x];
  };
  const baseDots = [], denseDots = new Map();
  for (let latitude = -84; latitude < 85; latitude += .85) {
    const step = .85 / Math.max(.14, Math.cos(latitude * Math.PI / 180));
    for (let longitude = -179.7; longitude < 180; longitude += step) {
      const country = at(longitude, latitude);
      if (country) { if (!denseDots.has(country)) denseDots.set(country, []); denseDots.get(country).push(...geographicVector(longitude, latitude)); }
    }
  }
  for (let latitude = -84; latitude < 85; latitude += 2) {
    const step = 2 / Math.max(.14, Math.cos(latitude * Math.PI / 180));
    for (let longitude = -179; longitude < 180; longitude += step) { const country = at(longitude, latitude); if (country) baseDots.push(...geographicVector(longitude, latitude)); }
  }
  const grid = [];
  for (let latitude = -60; latitude <= 60; latitude += 30) grid.push(vectorLine(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, latitude])));
  for (let longitude = -180; longitude < 180; longitude += 30) grid.push(vectorLine(Array.from({ length: 61 }, (_, i) => [longitude, -90 + i * 3])));
  return { world, at, baseDots: new Float32Array(baseDots), denseDots: new Map([...denseDots].map(([id, points]) => [id, new Float32Array(points)])), borders: world.arcs.map(vectorLine), countryBorders: world.countries.map(c => c.polygons.flatMap(p => p.map(vectorLine))), grid };
}

export function createGlobePainter(canvas, surface) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  let size = 280, ratio = 1, radius = 104, angle = -105 * Math.PI / 180, groups = [], active = null, palette = {}, fill;
  let mapped = new Map(), highlighted = [], layers = [];
  const backdrop = document.createElement('canvas'), background = backdrop.getContext('2d');
  let tilt = .18, ct = Math.cos(tilt), st = Math.sin(tilt);
  const trace = (lines, ca, sa) => {
    context.beginPath();
    for (const line of lines) {
      let px, py, pz;
      for (let i = 0; i < line.length; i += 3) {
        const xx = line[i] * ca + line[i + 2] * sa, zz = line[i + 2] * ca - line[i] * sa;
        const yy = line[i + 1] * ct - zz * st, z = line[i + 1] * st + zz * ct;
        if (i && (z > 0 || pz > 0)) {
          if (z <= 0 || pz <= 0) {
            const t = pz / (pz - z), hx = px + (xx - px) * t, hy = py + (yy - py) * t, length = Math.hypot(hx, hy) || 1;
            if (pz <= 0) context.moveTo(size / 2 + hx / length * radius, size / 2 - hy / length * radius);
            else context.lineTo(size / 2 + hx / length * radius, size / 2 - hy / length * radius);
          }
          if (z > 0) context.lineTo(size / 2 + xx * radius, size / 2 - yy * radius);
        } else if (z > 0) context.moveTo(size / 2 + xx * radius, size / 2 - yy * radius);
        px = xx; py = yy; pz = z;
      }
    }
    context.stroke();
  };
  const draw = delta => {
    angle += delta * .13;
    const ca = Math.cos(angle), sa = Math.sin(angle), center = size / 2;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, size, size);
    context.drawImage(backdrop, 0, 0, size, size);
    context.save(); context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.clip();
    context.strokeStyle = palette.grid; context.lineWidth = .5; trace(surface.grid, ca, sa);
    context.strokeStyle = palette.borders; context.lineWidth = .45; trace(surface.borders, ca, sa);
    const dots = (sets, color, highlighted = false) => {
      context.fillStyle = color;
      for (const items of sets) for (let i = 0; i < items.length; i += 3) {
        const x = items[i] * ca + items[i + 2] * sa, zz = items[i + 2] * ca - items[i] * sa;
        const y = items[i + 1] * ct - zz * st, z = items[i + 1] * st + zz * ct;
        if (z <= .015) continue;
        context.globalAlpha = (highlighted ? .65 : .34) + z * (highlighted ? .35 : .5);
        const dot = (highlighted ? .82 : .58) * (.65 + z * .35) * size / 280;
        context.fillRect(center + x * radius - dot / 2, center - y * radius - dot / 2, dot, dot);
      }
    };
    dots([surface.baseDots], palette.land);
    for (const layer of layers) if (layer.points.length) dots(layer.points, palette[layer.color], true);
    context.globalAlpha = 1;
    for (const { group, index } of highlighted) {
      context.strokeStyle = group.country.id === active ? palette.selected : palette.highlight;
      context.lineWidth = group.country.id === active ? 1.35 : .9;
      trace(surface.countryBorders[index], ca, sa);
    }
    context.restore(); context.strokeStyle = palette.rim; context.lineWidth = 1;
    context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.stroke();
  };
  return {
    draw,
    rotate(deltaX, deltaY) {
      ({ angle, tilt } = rotateGlobeView({ angle, tilt }, deltaX, deltaY, radius));
      ct = Math.cos(tilt); st = Math.sin(tilt);
    },
    contains(x, y) { return (x - size / 2) ** 2 + (y - size / 2) ** 2 <= radius ** 2; },
    resize(value, dpr, colors) {
      size = Math.max(140, Math.min(480, value || 280)); ratio = Math.max(1, Math.min(1.5, dpr || 1)); radius = size * .405;
      canvas.width = Math.round(size * ratio); canvas.height = Math.round(size * ratio); palette = colors;
      backdrop.width = canvas.width; backdrop.height = canvas.height; background.setTransform(ratio, 0, 0, ratio, 0, 0);
      background.lineWidth = .7; background.strokeStyle = colors.orbit;
      background.beginPath(); background.ellipse(size / 2, size / 2, radius * 1.19, radius * .34, -.38, 0, Math.PI * 2); background.stroke();
      background.beginPath(); background.ellipse(size / 2, size / 2, radius * 1.08, radius * .76, .66, 0, Math.PI * 2); background.stroke();
      fill = background.createRadialGradient(size * .36, size * .33, radius * .05, size / 2, size / 2, radius);
      fill.addColorStop(0, colors.seaLight); fill.addColorStop(1, colors.sea);
      background.fillStyle = fill; background.beginPath(); background.arc(size / 2, size / 2, radius, 0, Math.PI * 2); background.fill(); draw(0);
    },
    setRegions(nextGroups, selectedId) {
      groups = nextGroups; active = selectedId;
      highlighted = groups.map(group => { const index = surface.world.countries.indexOf(group.country); return { group, index, points: surface.denseDots.get(index + 1) || [] }; });
      mapped = new Map(highlighted.map(({ index, group }) => [index + 1, group]));
      layers = [{ color: 'highlight', points: highlighted.filter(item => item.group.country.id !== active).map(item => item.points) }, { color: 'selected', points: highlighted.filter(item => item.group.country.id === active).map(item => item.points) }];
    },
    hit(x, y) {
      const point = unprojectGlobe((x - size / 2) / radius, (size / 2 - y) / radius, angle, tilt);
      if (!point) return null;
      const direct = mapped.get(surface.at(...point));
      if (direct) return direct;
      // About 3 CSS px tolerance for a small highlighted country, never a
      // synthetic visitor point. Unknown/ocean locations remain non-selectable.
      for (const [dx, dy] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
        const nearby = unprojectGlobe((x + dx - size / 2) / radius, (size / 2 - y - dy) / radius, angle, tilt);
        const group = nearby && mapped.get(surface.at(...nearby)); if (group) return group;
      }
      return null;
    },
  };
}
