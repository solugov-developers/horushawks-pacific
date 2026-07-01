/**
 * Mapeamento das localidades reais (campo `location` em slabs_history)
 * para coordenadas geográficas. Lookup por chave EXATA do banco.
 *
 * Online/sem geo: lat/lng = null -> bolha "Online" fora do mapa.
 */
export interface CityCoord {
  lat: number;
  lng: number;
  state: string;
  label: string;
}

export const US_CITY_COORDS: Record<string, CityCoord | null> = {
  Austin:           { lat: 30.2672, lng: -97.7431, state: 'TX', label: 'Austin, TX' },
  Charleston:       { lat: 32.7765, lng: -79.9311, state: 'SC', label: 'Charleston, SC' },
  Anaheim:          { lat: 33.8366, lng: -117.9143, state: 'CA', label: 'Anaheim, CA' },
  'Anaheim East':   { lat: 33.8366, lng: -117.9143, state: 'CA', label: 'Anaheim East, CA' },
  'Dallas, TX':     { lat: 32.7767, lng: -96.7970, state: 'TX', label: 'Dallas, TX' },
  'Tulsa, OK':      { lat: 36.1540, lng: -95.9928, state: 'OK', label: 'Tulsa, OK' },
  Birmingham:       { lat: 33.5186, lng: -86.8104, state: 'AL', label: 'Birmingham, AL' },
  'Lowell, AR':     { lat: 36.2562, lng: -94.1316, state: 'AR', label: 'Lowell, AR' },
  ATL:              { lat: 33.7490, lng: -84.3880, state: 'GA', label: 'Atlanta, GA' },
  'Fort Worth, TX': { lat: 32.7555, lng: -97.3308, state: 'TX', label: 'Fort Worth, TX' },
  SA:               { lat: 29.4241, lng: -98.4936, state: 'TX', label: 'San Antonio, TX' },
  'The Colony, TX': { lat: 33.0681, lng: -96.8867, state: 'TX', label: 'The Colony, TX' },
  Atlanta:          { lat: 33.7490, lng: -84.3880, state: 'GA', label: 'Atlanta, GA' },
  Ecommerce:        null,
};

export function lookupLocation(name: string | null | undefined): CityCoord | null {
  if (!name) return null;
  const direct = US_CITY_COORDS[name];
  if (direct !== undefined) return direct;
  // Fallback: tenta sem espaços extras
  const trimmed = name.trim();
  const match = US_CITY_COORDS[trimmed];
  return match ?? null;
}
