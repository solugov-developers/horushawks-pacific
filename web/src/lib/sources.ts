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
];

export const ALL_SOURCES = 'all';

export function findSource(slug: string | undefined | null): SourceMeta | null {
  if (!slug || slug === ALL_SOURCES) return null;
  return SOURCES.find(s => s.slug === slug) ?? null;
}
