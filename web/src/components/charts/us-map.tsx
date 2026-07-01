'use client';

import { useEffect, useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, Geometry, GeoJsonProperties } from 'geojson';
import { lookupLocation } from '@/lib/geo/us-cities';

export interface MapPoint {
  location: string;
  slabs: number;
  onHold?: number;
}

interface USMapProps {
  points: MapPoint[];
  /** Tamanho intrínseco. ResponsiveContainer ajusta via viewBox. */
  width?: number;
  height?: number;
}

/**
 * Mapa SVG dos US states com bolhas por localidade.
 * Tamanho das bolhas = raiz quadrada do valor (perceptualmente proporcional à área).
 */
export function USMap({ points, width = 960, height = 600 }: USMapProps) {
  const [states, setStates] = useState<Feature<Geometry, GeoJsonProperties>[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/us-states-10m.json')
      .then((r) => r.json())
      .then((topo) => {
        if (cancelled) return;
        const fc = feature(topo, topo.objects.states) as unknown as {
          type: 'FeatureCollection';
          features: Feature<Geometry, GeoJsonProperties>[];
        };
        setStates(fc.features);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const projection = useMemo(
    () => geoAlbersUsa().scale(1200).translate([width / 2, height / 2]),
    [width, height],
  );
  const pathGen = useMemo(() => geoPath(projection), [projection]);

  const validPoints = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => p.slabs));
    return points
      .map((p) => {
        const coord = lookupLocation(p.location);
        if (!coord) return null;
        const projected = projection([coord.lng, coord.lat]);
        if (!projected) return null;
        const r = Math.max(5, Math.sqrt(p.slabs / max) * 35);
        return {
          ...p,
          label: coord.label,
          x: projected[0],
          y: projected[1],
          r,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [points, projection]);

  const totalPlaced = validPoints.reduce((s, p) => s + p.slabs, 0);
  const totalAll = points.reduce((s, p) => s + p.slabs, 0);
  const unplaced = totalAll - totalPlaced;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Mapa dos US">
        {/* States */}
        {states &&
          states.map((feat, i) => (
            <path
              key={i}
              d={pathGen(feat) ?? undefined}
              fill="var(--surface-2)"
              stroke="var(--border)"
              strokeWidth={0.5}
            />
          ))}
        {/* Bubbles */}
        {validPoints.map((p) => (
          <g key={p.location} className="cursor-pointer">
            <circle
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill="var(--accent-700)"
              fillOpacity={0.7}
              stroke="var(--accent-700)"
              strokeWidth={1.5}
            >
              <title>{`${p.label}: ${p.slabs.toLocaleString('en-US')} slabs${
                p.onHold ? ` · ${p.onHold} on hold` : ''
              }`}</title>
            </circle>
            <text
              x={p.x}
              y={p.y + p.r + 12}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-strong)"
              className="font-medium pointer-events-none"
            >
              {p.label.split(',')[0]}
            </text>
          </g>
        ))}
      </svg>

      {unplaced > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          {unplaced.toLocaleString('en-US')} slabs em localidades sem coordenada (ex: Ecommerce/Online).
        </p>
      )}
    </div>
  );
}
