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
  Austin:           { lat: 30.2672, lng: -97.7431,  state: 'TX', label: 'Austin, TX' },
  Charleston:       { lat: 32.7765, lng: -79.9311,  state: 'SC', label: 'Charleston, SC' },
  Anaheim:          { lat: 33.8366, lng: -117.9143, state: 'CA', label: 'Anaheim, CA' },
  // Anaheim East fica ~10km a nordeste do warehouse principal — coord real distinta pra não sobrepor
  'Anaheim East':   { lat: 33.8794, lng: -117.7500, state: 'CA', label: 'Anaheim East, CA' },
  'Dallas, TX':     { lat: 32.7767, lng: -96.7970,  state: 'TX', label: 'Dallas, TX' },
  'Tulsa, OK':      { lat: 36.1540, lng: -95.9928,  state: 'OK', label: 'Tulsa, OK' },
  Birmingham:       { lat: 33.5186, lng: -86.8104,  state: 'AL', label: 'Birmingham, AL' },
  'Lowell, AR':     { lat: 36.2562, lng: -94.1316,  state: 'AR', label: 'Lowell, AR' },
  ATL:              { lat: 33.7490, lng: -84.3880,  state: 'GA', label: 'Atlanta, GA' },
  Atlanta:          { lat: 33.7490, lng: -84.3880,  state: 'GA', label: 'Atlanta, GA' },
  'Fort Worth, TX': { lat: 32.7555, lng: -97.3308,  state: 'TX', label: 'Fort Worth, TX' },
  SA:               { lat: 29.4241, lng: -98.4936,  state: 'TX', label: 'San Antonio, TX' },
  'San Antonio':    { lat: 29.4241, lng: -98.4936,  state: 'TX', label: 'San Antonio, TX' },
  'The Colony, TX': { lat: 33.0681, lng: -96.8867,  state: 'TX', label: 'The Colony, TX' },
  // California = alias genérico (IRG/Zucchi/Imperial gravam a constante); as fontes com sede
  // conhecida são reatribuídas por SOURCE_GEO. Fica como fallback (Zucchi, sede não localizada).
  California:       { lat: 37.7749, lng: -122.4194, state: 'CA', label: 'California' },
  HOU:              { lat: 29.7604, lng: -95.3698,  state: 'TX', label: 'Houston, TX' },
  Houston:          { lat: 29.7604, lng: -95.3698,  state: 'TX', label: 'Houston, TX' },
  Ecommerce:        null,
  // praças levantadas nos sites das fontes (contrato v2.3, 2026-09-18)
  'Addison/Dallas': { lat: 32.9618, lng: -96.8289,  state: 'TX', label: 'Addison (Dallas), TX' },
  'Van Nuys':       { lat: 34.1866, lng: -118.4487, state: 'CA', label: 'Van Nuys, CA' },
  Brisbane:         { lat: 37.6808, lng: -122.3999, state: 'CA', label: 'Brisbane, CA' },
  Dublin:           { lat: 37.7022, lng: -121.9358, state: 'CA', label: 'Dublin, CA' },
  Sacramento:       { lat: 38.5816, lng: -121.4944, state: 'CA', label: 'Sacramento, CA' },
  'North Hollywood': { lat: 34.1870, lng: -118.3813, state: 'CA', label: 'North Hollywood, CA' },
};

/**
 * Fontes que NÃO informam praça no payload (ou gravam uma constante): todo o
 * volume vai para a sede (precision 'hq'); unidades conhecidas sem volume
 * atribuível entram como 'presence' (slabs 0). Endereços confirmados nos sites
 * em 2026-09-18 (contrato v2.3).
 */
export const SOURCE_GEO: Record<string, { hq: string; presence?: string[]; note?: string }> = {
  granitedistributor: { hq: 'Addison/Dallas', presence: ['Houston'] },      // Everest Stone, 15565 Wright Brothers Dr
  thestoneindustry:   { hq: 'Van Nuys' },                                    // 15934 Strathern St
  irgstone:           { hq: 'Brisbane', presence: ['Dublin', 'Sacramento'] }, // 275 Valley Dr · 6800 Sierra Ct · 8460 Elder Creek Rd
  imperialtile:       { hq: 'North Hollywood' },                             // 12503 Sherman Way
  // TODO(geo): Zucchi Stones — endereço não localizado; 'California' genérico (37.77/-122.42) até confirmar.
  zucchistones:       { hq: 'California', note: 'sede não localizada; ponto genérico na Califórnia' },
};

/** Lojas da Pacific (erp.locations.code -> cidade oficial do site). Depósitos e terceiros ficam de fora. */
export const PACIFIC_STORE_COORDS: Record<string, CityCoord> = {
  'SoCal AG':    { lat: 35.1186, lng: -120.5907, state: 'CA', label: 'Arroyo Grande, CA' },
  'NorCal BA':   { lat: 35.3733, lng: -119.0187, state: 'CA', label: 'Bakersfield, CA' },
  'NorCal FR':   { lat: 36.7378, lng: -119.7871, state: 'CA', label: 'Fresno, CA' },
  'SoCal IR':    { lat: 33.7455, lng: -117.8677, state: 'CA', label: 'Irvine / Santa Ana, CA' },
  'Central LR':  { lat: 34.6229, lng: -92.3446,  state: 'AR', label: 'Little Rock / Mabelvale, AR' },
  'SoCal NH':    { lat: 34.1870, lng: -118.3813, state: 'CA', label: 'Los Angeles / North Hollywood, CA' },
  'NorCal MO':   { lat: 37.6391, lng: -120.9969, state: 'CA', label: 'Modesto, CA' },
  'Central NWA': { lat: 36.2562, lng: -94.1316,  state: 'AR', label: 'Northwest Arkansas / Lowell, AR' },
  'Central OKC': { lat: 35.6528, lng: -97.4781,  state: 'OK', label: 'Oklahoma City / Edmond, OK' },
  'Central OB':  { lat: 34.9618, lng: -89.8295,  state: 'MS', label: 'Olive Branch, MS' },
  'SoCal OX':    { lat: 34.1975, lng: -119.1771, state: 'CA', label: 'Oxnard, CA' },
  'NorCal RN':   { lat: 39.5296, lng: -119.8138, state: 'NV', label: 'Reno, NV' },
  'NorCal SAC':  { lat: 38.5891, lng: -121.3027, state: 'CA', label: 'Sacramento / Rancho Cordova, CA' },
  'Central SA':  { lat: 29.4241, lng: -98.4936,  state: 'TX', label: 'San Antonio, TX' },
  'Central TU':  { lat: 36.1540, lng: -95.9928,  state: 'OK', label: 'Tulsa, OK' },
  'Central DAL': { lat: 32.7767, lng: -96.7970,  state: 'TX', label: 'Dallas, TX' },
  'SoCal ER':    { lat: 34.0522, lng: -118.2437, state: 'CA', label: 'Elements Room Los Angeles, CA' },
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
