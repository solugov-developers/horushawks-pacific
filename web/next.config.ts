import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // Produção: Next gera /app/.next/standalone com server.js executável.
  // Imagem Docker final ~150 MB.
  output: 'standalone',
};

export default nextConfig;
