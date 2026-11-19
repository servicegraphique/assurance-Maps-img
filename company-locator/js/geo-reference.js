/**
 * geo-reference.js — Repères géographiques publics français (littoral, aéroports, autoroutes).
 *
 * Permet de calculer instantanément et sans clé API la distance à la mer,
 * l'aéroport commercial le plus proche et l'axe autoroutier le plus proche
 * pour tout établissement situé en France métropolitaine et dans les DROM.
 */

import { haversineM } from './utils.js';

/** Lignes de côte simplifiées [lat, lon] : Manche, Atlantique, Méditerranée, Corse, DROM. */
export const FRANCE_COASTLINES = [
  // Manche & Mer du Nord (Dunkerque → Brest)
  [
    [51.055, 2.368], [50.965, 1.852], [50.872, 1.584], [50.725, 1.596], [50.520, 1.585],
    [50.214, 1.564], [50.062, 1.370], [49.930, 1.077], [49.865, 0.708], [49.760, 0.368],
    [49.698, 0.175], [49.493, 0.098], [49.365, 0.075], [49.290, -0.250], [49.340, -0.550],
    [49.405, -0.890], [49.420, -1.170], [49.685, -1.270], [49.655, -1.625], [49.715, -1.940],
    [49.370, -1.785], [49.055, -1.595], [48.838, -1.595], [48.645, -1.515], [48.650, -2.025],
    [48.655, -2.315], [48.530, -2.755], [48.785, -3.050], [48.820, -3.570], [48.725, -3.985],
    [48.590, -4.615], [48.385, -4.490],
  ],
  // Façade Atlantique (Brest → Hendaye)
  [
    [48.385, -4.490], [48.250, -4.550], [48.035, -4.720], [47.795, -4.345], [47.870, -3.920],
    [47.730, -3.370], [47.555, -3.130], [47.565, -2.765], [47.285, -2.515], [47.265, -2.210],
    [47.115, -2.105], [46.940, -2.170], [46.695, -1.940], [46.495, -1.785], [46.340, -1.310],
    [46.155, -1.165], [45.950, -1.095], [45.625, -1.030], [45.545, -1.090], [45.135, -1.215],
    [44.660, -1.170], [44.205, -1.295], [43.855, -1.390], [43.655, -1.445], [43.485, -1.560],
    [43.375, -1.775],
  ],
  // Façade Méditerranéenne (Cerbère → Menton, incluant littoral Berre/Fos)
  [
    [42.443, 3.166], [42.545, 3.050], [42.700, 3.040], [42.905, 3.045], [43.135, 3.130],
    [43.280, 3.505], [43.400, 3.695], [43.545, 3.965], [43.555, 4.135], [43.455, 4.425],
    [43.345, 4.845], [43.425, 4.945], [43.405, 5.055], [43.495, 5.135], [43.335, 5.155],
    [43.300, 5.365], [43.210, 5.350], [43.180, 5.605], [43.115, 5.810], [43.105, 5.930],
    [43.080, 6.150], [43.140, 6.370], [43.270, 6.640], [43.420, 6.770], [43.550, 7.020],
    [43.580, 7.130], [43.695, 7.265], [43.735, 7.425], [43.775, 7.505],
  ],
  // Corse
  [
    [43.005, 9.405], [42.700, 9.450], [42.320, 9.550], [41.850, 9.400], [41.590, 9.280],
    [41.385, 9.160], [41.575, 8.855], [41.920, 8.735], [42.245, 8.565], [42.565, 8.755],
    [42.695, 9.300], [43.005, 9.405],
  ],
  // Guadeloupe, Martinique, Guyane, La Réunion, Mayotte
  [[16.50, -61.46], [16.24, -61.53], [16.00, -61.73], [16.32, -61.79], [16.25, -61.18]],
  [[14.87, -61.15], [14.60, -61.07], [14.40, -60.87], [14.74, -60.96]],
  [[5.74, -53.95], [5.50, -53.00], [5.16, -52.64], [4.93, -52.33], [4.32, -51.65]],
  [[-20.88, 55.45], [-21.05, 55.71], [-21.37, 55.77], [-21.34, 55.47], [-21.05, 55.22], [-20.88, 55.45]],
  [[-12.64, 45.13], [-12.78, 45.23], [-12.99, 45.14], [-12.83, 45.08]],
];

/** Principaux aéroports commerciaux français. */
export const FRANCE_AIRPORTS = [
  { code: 'CDG', name: 'Paris-CDG', lat: 49.0097, lon: 2.5479 },
  { code: 'ORY', name: 'Paris-Orly', lat: 48.7262, lon: 2.3652 },
  { code: 'BVA', name: 'Beauvais-Tillé', lat: 49.4544, lon: 2.1128 },
  { code: 'NCE', name: 'Nice Côte d\'Azur', lat: 43.6584, lon: 7.2159 },
  { code: 'LYS', name: 'Lyon-Saint-Exupéry', lat: 45.7256, lon: 5.0811 },
  { code: 'MRS', name: 'Marseille-Provence', lat: 43.4393, lon: 5.2214 },
  { code: 'TLS', name: 'Toulouse-Blagnac', lat: 43.6293, lon: 1.3638 },
  { code: 'MLH', name: 'Bâle-Mulhouse', lat: 47.5900, lon: 7.5299 },
  { code: 'BOD', name: 'Bordeaux-Mérignac', lat: 44.8283, lon: -0.7156 },
  { code: 'NTE', name: 'Nantes Atlantique', lat: 47.1532, lon: -1.6107 },
  { code: 'LIL', name: 'Lille-Lesquin', lat: 50.5633, lon: 3.0869 },
  { code: 'MPL', name: 'Montpellier', lat: 43.5762, lon: 3.9630 },
  { code: 'AJA', name: 'Ajaccio', lat: 41.9236, lon: 8.8029 },
  { code: 'BIA', name: 'Bastia-Poretta', lat: 42.5527, lon: 9.4837 },
  { code: 'FSC', name: 'Figari', lat: 41.5006, lon: 9.0978 },
  { code: 'CLY', name: 'Calvi', lat: 42.5308, lon: 8.7932 },
  { code: 'SXB', name: 'Strasbourg-Entzheim', lat: 48.5383, lon: 7.6282 },
  { code: 'BES', name: 'Brest Bretagne', lat: 48.4479, lon: -4.4185 },
  { code: 'BIQ', name: 'Biarritz', lat: 43.4684, lon: -1.5233 },
  { code: 'RNS', name: 'Rennes', lat: 48.0695, lon: -1.7348 },
  { code: 'TLN', name: 'Toulon-Hyères', lat: 43.0973, lon: 6.1460 },
  { code: 'PUF', name: 'Pau-Pyrénées', lat: 43.3800, lon: -0.4186 },
  { code: 'LDE', name: 'Tarbes-Lourdes', lat: 43.1787, lon: -0.0064 },
  { code: 'PGF', name: 'Perpignan', lat: 42.7404, lon: 2.8707 },
  { code: 'FNI', name: 'Nîmes-Garons', lat: 43.7574, lon: 4.4163 },
  { code: 'AVN', name: 'Avignon-Provence', lat: 43.9073, lon: 4.9018 },
  { code: 'BZR', name: 'Béziers-Cap d\'Agde', lat: 43.3235, lon: 3.3539 },
  { code: 'CCF', name: 'Carcassonne', lat: 43.2160, lon: 2.3063 },
  { code: 'CFE', name: 'Clermont-Ferrand', lat: 45.7867, lon: 3.1692 },
  { code: 'GNB', name: 'Grenoble Alpes Isère', lat: 45.3629, lon: 5.3294 },
  { code: 'CMF', name: 'Chambéry-Savoie', lat: 45.6381, lon: 5.8802 },
  { code: 'LIG', name: 'Limoges', lat: 45.8628, lon: 1.1794 },
  { code: 'PIS', name: 'Poitiers-Biard', lat: 46.5877, lon: 0.3066 },
  { code: 'LRH', name: 'La Rochelle', lat: 46.1792, lon: -1.1953 },
  { code: 'TUF', name: 'Tours Val de Loire', lat: 47.4322, lon: 0.7276 },
  { code: 'CFR', name: 'Caen-Carpiquet', lat: 49.1733, lon: -0.4500 },
  { code: 'DOL', name: 'Deauville-Normandie', lat: 49.3653, lon: 0.1543 },
  { code: 'ETZ', name: 'Metz-Nancy-Lorraine', lat: 48.9821, lon: 6.2513 },
  { code: 'DLE', name: 'Dole-Jura', lat: 47.0390, lon: 5.4273 },
  { code: 'EGC', name: 'Bergerac', lat: 44.8253, lon: 0.5186 },
  { code: 'RDZ', name: 'Rodez-Aveyron', lat: 44.4079, lon: 2.4827 },
  { code: 'LRT', name: 'Lorient', lat: 47.7606, lon: -3.4400 },
  { code: 'UIP', name: 'Quimper', lat: 47.9750, lon: -4.1678 },
  { code: 'PTP', name: 'Pointe-à-Pitre', lat: 16.2653, lon: -61.5318 },
  { code: 'FDF', name: 'Martinique Aimé Césaire', lat: 14.5910, lon: -61.0032 },
  { code: 'CAY', name: 'Cayenne Félix Éboué', lat: 4.8198, lon: -52.3604 },
  { code: 'RUN', name: 'La Réunion Roland-Garros', lat: -20.8901, lon: 55.5189 },
  { code: 'DZA', name: 'Mayotte Dzaoudzi', lat: -12.8047, lon: 45.2811 },
];

/** Grands axes autoroutiers français (tracés simplifiés [lat, lon]). */
export const FRANCE_MOTORWAYS = [
  { code: 'A1', pts: [[48.92, 2.36], [49.02, 2.53], [49.42, 2.75], [49.88, 2.86], [50.29, 2.84], [50.61, 3.08]] },
  { code: 'A4', pts: [[48.83, 2.42], [48.85, 2.78], [49.03, 3.40], [49.23, 4.03], [49.11, 5.15], [49.15, 6.20], [48.75, 7.36], [48.60, 7.74]] },
  { code: 'A6', pts: [[48.81, 2.34], [48.55, 2.46], [48.02, 3.04], [47.78, 3.62], [47.27, 4.55], [47.02, 4.85], [46.78, 4.86], [46.31, 4.82], [45.77, 4.79]] },
  { code: 'A7', pts: [[45.74, 4.82], [45.52, 4.86], [45.07, 4.84], [44.92, 4.88], [44.56, 4.76], [44.14, 4.78], [43.93, 4.91], [43.64, 5.10], [43.52, 5.18], [43.455, 5.228], [43.39, 5.31], [43.31, 5.38]] },
  { code: 'A8', pts: [[43.52, 5.18], [43.51, 5.45], [43.44, 5.86], [43.41, 6.32], [43.47, 6.72], [43.58, 7.05], [43.70, 7.24], [43.78, 7.50]] },
  { code: 'A9', pts: [[44.14, 4.78], [43.92, 4.55], [43.81, 4.36], [43.62, 3.93], [43.33, 3.27], [43.17, 2.98], [42.68, 2.86], [42.47, 2.87]] },
  { code: 'A10', pts: [[48.72, 2.24], [48.45, 1.88], [47.92, 1.85], [47.59, 1.32], [47.37, 0.72], [46.60, 0.32], [46.30, -0.42], [45.75, -0.66], [45.25, -0.52], [44.89, -0.52]] },
  { code: 'A11', pts: [[48.56, 1.92], [48.42, 1.50], [48.03, 0.21], [47.50, -0.54], [47.26, -1.51]] },
  { code: 'A13', pts: [[48.84, 2.24], [48.95, 1.90], [49.15, 1.35], [49.34, 1.05], [49.35, 0.42], [49.24, 0.02], [49.17, -0.32]] },
  { code: 'A16', pts: [[49.08, 2.26], [49.44, 2.11], [49.89, 2.24], [50.12, 1.84], [50.72, 1.64], [50.94, 1.86], [51.02, 2.38]] },
  { code: 'A20', pts: [[47.21, 2.04], [46.82, 1.67], [46.23, 1.46], [45.85, 1.29], [45.15, 1.50], [44.47, 1.48], [44.01, 1.37]] },
  { code: 'A25', pts: [[50.61, 3.05], [50.71, 2.74], [50.84, 2.48], [50.99, 2.37]] },
  { code: 'A26', pts: [[50.93, 1.87], [50.52, 2.58], [50.28, 2.83], [49.84, 3.31], [49.26, 4.00], [48.95, 4.35], [48.32, 4.12]] },
  { code: 'A28', pts: [[50.11, 1.83], [49.47, 1.15], [49.10, 0.56], [48.44, 0.10], [48.02, 0.24], [47.46, 0.68]] },
  { code: 'A31', pts: [[47.02, 4.86], [47.32, 5.09], [47.86, 5.28], [48.67, 6.12], [49.12, 6.18], [49.44, 6.12]] },
  { code: 'A35', pts: [[48.90, 7.95], [48.58, 7.72], [48.26, 7.45], [48.08, 7.38], [47.76, 7.39], [47.59, 7.55]] },
  { code: 'A36', pts: [[47.05, 5.05], [47.25, 5.98], [47.51, 6.80], [47.75, 7.30]] },
  { code: 'A40', pts: [[46.31, 4.84], [46.20, 5.24], [46.14, 5.82], [46.16, 6.26], [45.92, 6.70]] },
  { code: 'A41', pts: [[46.14, 6.10], [45.90, 6.09], [45.60, 5.92], [45.22, 5.78]] },
  { code: 'A43', pts: [[45.72, 4.92], [45.58, 5.30], [45.57, 5.90], [45.28, 6.35], [45.20, 6.67]] },
  { code: 'A47', pts: [[45.58, 4.78], [45.51, 4.61], [45.44, 4.41]] },
  { code: 'A50', pts: [[43.28, 5.42], [43.29, 5.56], [43.19, 5.71], [43.13, 5.91]] },
  { code: 'A51', pts: [[43.36, 5.36], [43.51, 5.43], [43.69, 5.57], [44.06, 5.90], [44.42, 6.03]] },
  { code: 'A55', pts: [[43.32, 5.36], [43.38, 5.22], [43.40, 5.06]] },
  { code: 'A61', pts: [[43.59, 1.49], [43.35, 1.85], [43.20, 2.34], [43.17, 2.96]] },
  { code: 'A62', pts: [[44.78, -0.53], [44.48, 0.18], [44.17, 0.62], [43.99, 1.31], [43.65, 1.42]] },
  { code: 'A63', pts: [[44.78, -0.64], [44.32, -0.86], [43.86, -1.24], [43.48, -1.51], [43.35, -1.76]] },
  { code: 'A64', pts: [[43.49, -1.46], [43.34, -0.37], [43.13, 0.08], [43.11, 0.72], [43.56, 1.39]] },
  { code: 'A71', pts: [[47.88, 1.86], [47.09, 2.35], [46.36, 2.62], [45.80, 3.14]] },
  { code: 'A75', pts: [[45.76, 3.15], [45.10, 3.15], [44.52, 3.24], [44.10, 3.03], [43.65, 3.42], [43.34, 3.28]] },
  { code: 'A83', pts: [[47.16, -1.52], [46.68, -1.35], [46.33, -0.45]] },
  { code: 'A84', pts: [[49.16, -0.40], [48.68, -1.35], [48.13, -1.62]] },
  { code: 'A86', pts: [[48.93, 2.30], [48.88, 2.48], [48.76, 2.38], [48.78, 2.18], [48.90, 2.21]] },
  { code: 'A89', pts: [[44.89, -0.35], [45.14, 0.72], [45.27, 1.54], [45.82, 3.14], [45.84, 4.65]] },
  { code: 'N165', pts: [[47.25, -1.62], [47.66, -2.75], [47.78, -3.37], [48.00, -4.09], [48.40, -4.45]] },
  { code: 'N12', pts: [[48.11, -1.72], [48.51, -2.76], [48.57, -3.82], [48.42, -4.42]] },
];

/** Distance minimale (en km) d'un point (lat, lon) à un segment [A, B]. */
function pointToSegmentKm(lat, lon, a, b) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const px = lon * cosLat;
  const py = lat;
  const ax = a[1] * cosLat;
  const ay = a[0];
  const bx = b[1] * cosLat;
  const by = b[0];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const projLat = a[0] + t * (b[0] - a[0]);
  const projLon = a[1] + t * (b[1] - a[1]);
  return haversineM(lat, lon, projLat, projLon) / 1000;
}

/** Distance minimale à une polyligne en kilomètres. */
export function distanceToPolylineKm(lat, lon, pts) {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const d = pointToSegmentKm(lat, lon, pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** Distance au littoral français le plus proche (km). */
export function nearestCoastKm(lat, lon) {
  let min = Infinity;
  for (const line of FRANCE_COASTLINES) {
    const d = distanceToPolylineKm(lat, lon, line);
    if (d < min) min = d;
  }
  return min;
}

/** Aéroport commercial français le plus proche. */
export function nearestAirport(lat, lon) {
  let best = null;
  for (const airport of FRANCE_AIRPORTS) {
    const km = haversineM(lat, lon, airport.lat, airport.lon) / 1000;
    if (!best || km < best.km) best = { ...airport, km };
  }
  return best;
}

/** Autoroute ou voie rapide française la plus proche. */
export function nearestMotorway(lat, lon) {
  let best = null;
  for (const road of FRANCE_MOTORWAYS) {
    const km = distanceToPolylineKm(lat, lon, road.pts);
    if (!best || km < best.km) best = { code: road.code, km };
  }
  return best;
}
