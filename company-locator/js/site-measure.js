/** Dimensions d'un rectangle englobant orienté : approximation locale en mètres. */
export function orientedRectangle(feature, turf) {
  const hull = turf.convex(feature);
  if (!hull) throw new Error('Polygone dégénéré');
  const pts = hull.geometry.coordinates[0];
  const [lon0, lat0] = pts[0];
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = pts.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * ky]);
  let best = null;
  for (let i = 0; i < xy.length - 1; i++) {
    const a = Math.atan2(xy[i + 1][1] - xy[i][1], xy[i + 1][0] - xy[i][0]);
    const c = Math.cos(a), s = Math.sin(a);
    const rotated = xy.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
    const xs = rotated.map(p => p[0]), ys = rotated.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (!best || w * h < best.w * best.h) best = { w, h };
  }
  return { longueur: Math.max(best.w, best.h), largeur: Math.min(best.w, best.h) };
}

export function measure(feature, turf, slope = 30) {
  if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) throw new Error('Polygone requis');
  if (!Number.isFinite(slope) || slope < 0 || slope > 80) throw new Error('Pente invalide');
  const surface = turf.area(feature);
  // Chaque anneau (y compris les trous) contribue au périmètre.
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let perimetre = 0;
  for (const polygon of polygons) for (const ring of polygon) perimetre += turf.length(turf.lineString(ring), { units: 'meters' });
  return { surface, perimetre, ...orientedRectangle(feature, turf), surfaceToit: surface / Math.cos(slope * Math.PI / 180) };
}
