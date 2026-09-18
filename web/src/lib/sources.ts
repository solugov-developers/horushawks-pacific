/**
 * Lista canônica de scrapers/fontes.
 * Define rótulos, ícones e a tabela específica de cada um.
 * Usar `ALL_SOURCES` quando "todas as fontes" estiver selecionada.
 */
export interface SourceMeta {
  slug: string;     // = scrapers.name
  label: string;    // pretty
  table: string;    // <source>_slabs (pg ident)
}

export const SOURCES: SourceMeta[] = [
  { slug: 'encore',             label: 'Encore',             table: 'encore_slabs' },
  { slug: 'crs',                label: 'CRS',                table: 'crs_slabs' },
  { slug: 'nsr',                label: 'NSR',                table: 'nsr_slabs' },
  { slug: 'granitedistributor', label: 'Granite Distributor',table: 'granitedistributor_slabs' },
  { slug: 'vmcstone',           label: 'VMC',                table: 'vmcstone_slabs' },
  { slug: 'zucchistones',       label: 'Zucchi',             table: 'zucchistones_slabs' },
  { slug: 'irgstone',           label: 'IRG Stone',          table: 'irgstone_slabs' },
  // Loja Shopify (North Hollywood, CA): chapas = variantes disponíveis por produto (db/031).
  { slug: 'imperialtile',       label: 'Imperial Tile',      table: 'imperialtile_slabs' },
  // Fonte PRÓPRIA (scrapers.kind = 'own'): fora do módulo Mercado; só fotos e pareamento.
  { slug: 'pacshore',           label: 'Pacific Shore',      table: 'pacshore_slabs' },
];


export const ALL_SOURCES = 'all';

export function findSource(slug: string | undefined | null): SourceMeta | null {
  if (!slug || slug === ALL_SOURCES) return null;
  return SOURCES.find(s => s.slug === slug) ?? null;
}

/**
 * Categorias que NÃO são material de chapa e ficam fora do módulo Mercado
 * (overview, inventory, sales, movements e facets). Lista explícita, com a
 * fonte onde o valor foi observado (snapshot 2026-09-17); nada é inferido.
 *   encore   : Cleaning Products (kit de limpeza "Encore Stone Care")
 *   irgstone : Natural Stone Tile, Porcelain Pavers, Chorus Glass, Jeffrey Court,
 *              Island Stone, AKDO (tiles/pavers e marcas de revestimento)
 *   nsr      : Pebbles, Riverstone, Wood (paisagismo)
 *   tsi      : Cobblestone (pavers)
 * Comparação exata (case-sensitive) com slabs_history.category_name.
 */
export const EXCLUDED_CATEGORIES: readonly string[] = [
  'Cleaning Products',
  'Natural Stone Tile', 'Porcelain Pavers', 'Chorus Glass', 'Jeffrey Court', 'Island Stone', 'AKDO',
  'Pebbles', 'Riverstone', 'Wood',
  'Cobblestone',
];
