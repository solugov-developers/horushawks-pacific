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
  width?: number;
  height?: number;
}

interface ProjectedPoint {
  key: string;
  label: string;
  slabs: number;
  onHold?: number;
  origX: number;
  origY: number;
  x: number;
  y: number;
  r: number;
}

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
    return () => { cancelled = true; };
  }, []);

  const projection = useMemo(
    () => geoAlbersUsa().scale(1200).translate([width / 2, height / 2]),
    [width, height],
  );
  const pathGen = useMemo(() => geoPath(projection), [projection]);

  const { placed, unplaced } = useMemo(() => {
    const raw: ProjectedPoint[] = [];
    let unplacedSlabs = 0;
    const max = Math.max(1, ...points.map((p) => p.slabs));

    for (const p of points) {
      const coord = lookupLocation(p.location);
      if (!coord) { unplacedSlabs += p.slabs; continue; }
      const proj = projection([coord.lng, coord.lat]);
      if (!proj) { unplacedSlabs += p.slabs; continue; }
      const r = Math.max(6, Math.sqrt(p.slabs / max) * 38);
      raw.push({
        key: p.location,
        label: coord.label,
        slabs: p.slabs,
        onHold: p.onHold,
        origX: proj[0],
        origY: proj[1],
        x: proj[0],
        y: proj[1],
        r,
      });
    }
    return { placed: resolveCollisions(raw), unplaced: unplacedSlabs };
  }, [points, projection]);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Mapa dos US">
        {states && states.map((feat, i) => (
          <path
            key={i}
            d={pathGen(feat) ?? undefined}
            fill="var(--surface-2)"
            stroke="var(--border)"
            strokeWidth={0.5}
          />
        ))}

        {/* Leader lines: só desenha quando a bolha foi deslocada da origem */}
        {placed.map((p) => {
          const dx = p.x - p.origX;
          const dy = p.y - p.origY;
          if (Math.hypot(dx, dy) < 2) return null;
          return (
            <line
              key={`leader-${p.key}`}
              x1={p.origX}
              y1={p.origY}
              x2={p.x}
              y2={p.y}
              stroke="var(--border-strong)"
              strokeWidth={0.5}
              strokeDasharray="2 2"
            />
          );
        })}

        {/* Bubbles */}
        {placed.map((p) => (
          <g key={p.key} className="cursor-pointer">
            <circle
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill="var(--accent-700)"
              fillOpacity={0.7}
              stroke="var(--accent-700)"
              strokeWidth={1.5}
            >
              <title>{`${p.label}: ${p.slabs.toLocaleString('en-US')} slabs${p.onHold ? ` · ${p.onHold} on hold` : ''}`}</title>
            </circle>
          </g>
        ))}

        {/* Labels em pass separado — só bolhas grandes o suficiente */}
        {placed.filter((p) => p.r >= 8).map((p) => (
          <text
            key={`label-${p.key}`}
            x={p.x}
            y={p.y + p.r + 11}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-strong)"
            className="font-medium pointer-events-none"
          >
            {p.label.split(',')[0]}
          </text>
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

/**
 * Simulação simples de repulsão: itera empurrando pares de bolhas
 * sobrepostas até que nenhuma esteja invadindo a outra (+ gap mínimo).
 * O(N² × ITER) — trivial pra N < 30.
 */
function resolveCollisions(pts: ProjectedPoint[], minGap = 3, maxIter = 120): ProjectedPoint[] {
  const out = pts.map((p) => ({ ...p }));
  for (let iter = 0; iter < maxIter; iter++) {
    let anyMove = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const need = a.r + b.r + minGap;
        if (dist < need) {
          if (dist < 0.001) {
            // Exact overlap — desloca horizontal determinístico
            dx = 1; dy = 0; dist = 1;
          }
          const push = (need - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          anyMove = true;
        }
      }
    }
    if (!anyMove) break;
  }
  return out;
}
