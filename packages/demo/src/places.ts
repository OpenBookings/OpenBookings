/** EU only: generated hotels are always placed in or near one of these. */

export type EuPlace = { country: string; capital: string; lat: number; lon: number; timezone: string };

export const EU_PLACES: readonly EuPlace[] = [
  { country: "AT", capital: "Vienna", lat: 48.2082, lon: 16.3738, timezone: "Europe/Vienna" },
  { country: "BE", capital: "Brussels", lat: 50.8503, lon: 4.3517, timezone: "Europe/Brussels" },
  { country: "BG", capital: "Sofia", lat: 42.6977, lon: 23.3219, timezone: "Europe/Sofia" },
  { country: "HR", capital: "Zagreb", lat: 45.815, lon: 15.9819, timezone: "Europe/Zagreb" },
  { country: "CY", capital: "Nicosia", lat: 35.1856, lon: 33.3823, timezone: "Asia/Nicosia" },
  { country: "CZ", capital: "Prague", lat: 50.0755, lon: 14.4378, timezone: "Europe/Prague" },
  { country: "DK", capital: "Copenhagen", lat: 55.6761, lon: 12.5683, timezone: "Europe/Copenhagen" },
  { country: "EE", capital: "Tallinn", lat: 59.437, lon: 24.7536, timezone: "Europe/Tallinn" },
  { country: "FI", capital: "Helsinki", lat: 60.1699, lon: 24.9384, timezone: "Europe/Helsinki" },
  { country: "FR", capital: "Paris", lat: 48.8566, lon: 2.3522, timezone: "Europe/Paris" },
  { country: "DE", capital: "Berlin", lat: 52.52, lon: 13.405, timezone: "Europe/Berlin" },
  { country: "GR", capital: "Athens", lat: 37.9838, lon: 23.7275, timezone: "Europe/Athens" },
  { country: "HU", capital: "Budapest", lat: 47.4979, lon: 19.0402, timezone: "Europe/Budapest" },
  { country: "IE", capital: "Dublin", lat: 53.3498, lon: -6.2603, timezone: "Europe/Dublin" },
  { country: "IT", capital: "Rome", lat: 41.9028, lon: 12.4964, timezone: "Europe/Rome" },
  { country: "LV", capital: "Riga", lat: 56.9496, lon: 24.1052, timezone: "Europe/Riga" },
  { country: "LT", capital: "Vilnius", lat: 54.6872, lon: 25.2797, timezone: "Europe/Vilnius" },
  { country: "LU", capital: "Luxembourg", lat: 49.6116, lon: 6.1319, timezone: "Europe/Luxembourg" },
  { country: "MT", capital: "Valletta", lat: 35.8989, lon: 14.5146, timezone: "Europe/Malta" },
  { country: "NL", capital: "Amsterdam", lat: 52.3676, lon: 4.9041, timezone: "Europe/Amsterdam" },
  { country: "PL", capital: "Warsaw", lat: 52.2297, lon: 21.0122, timezone: "Europe/Warsaw" },
  { country: "PT", capital: "Lisbon", lat: 38.7223, lon: -9.1393, timezone: "Europe/Lisbon" },
  { country: "RO", capital: "Bucharest", lat: 44.4268, lon: 26.1025, timezone: "Europe/Bucharest" },
  { country: "SK", capital: "Bratislava", lat: 48.1486, lon: 17.1077, timezone: "Europe/Bratislava" },
  { country: "SI", capital: "Ljubljana", lat: 46.0569, lon: 14.5058, timezone: "Europe/Ljubljana" },
  { country: "ES", capital: "Madrid", lat: 40.4168, lon: -3.7038, timezone: "Europe/Madrid" },
  { country: "SE", capital: "Stockholm", lat: 59.3293, lon: 18.0686, timezone: "Europe/Stockholm" },
];

/** Closest capital by (equirectangular) distance: plenty accurate for picking a country. */
export function nearestEuPlace(lat: number, lon: number): EuPlace {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = EU_PLACES[0];
  let bestD = Infinity;
  for (const place of EU_PLACES) {
    const dLat = place.lat - lat;
    const dLon = (place.lon - lon) * cosLat;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = place;
    }
  }
  return best;
}
