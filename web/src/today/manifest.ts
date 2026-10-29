import { useEffect, useState } from 'react';
import { api } from '../core/client.ts';

export interface ManifestModule {
  id: string;
  title: string;
  description: string;
  actions: { name: string; kind: 'query' | 'mutation'; description: string; agent: boolean }[];
}

let cache: Promise<ManifestModule[]> | null = null;

export function useManifest() {
  const [list, setList] = useState<ManifestModule[]>([]);
  useEffect(() => {
    cache ??= api.get<ManifestModule[]>('/api/manifest');
    void cache.then(setList);
  }, []);
  return list;
}
