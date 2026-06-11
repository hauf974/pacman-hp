import * as fs from 'fs';
import * as path from 'path';
import { MapData } from '../shared/types';

const MAPS_DIR = path.join(process.cwd(), 'data', 'maps');

function ensureDir(): void {
  if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });
}

/** Filesystem-safe slug used as both the stored name and the JSON filename stem. */
export function slugify(name: string): string {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'carte'
  );
}

export function listMaps(): string[] {
  ensureDir();
  return fs
    .readdirSync(MAPS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

export function getMap(name: string): MapData | null {
  const slug = slugify(name);
  const file = path.join(MAPS_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as MapData;
  } catch {
    return null;
  }
}

/** Persist a map (no validation here — saving WIP is allowed). Returns the slug used. */
export function saveMap(map: MapData): string {
  ensureDir();
  const slug = slugify(map.name);
  const file = path.join(MAPS_DIR, `${slug}.json`);
  const now = new Date().toISOString();
  const existing = getMap(slug);
  const toWrite: MapData = {
    ...map,
    name: slug,
    createdAt: existing?.createdAt ?? map.createdAt ?? now,
    updatedAt: now,
  };
  fs.writeFileSync(file, JSON.stringify(toWrite, null, 2), 'utf-8');
  return slug;
}

/** Find a free slug derived from `base` (base, base-2, base-3, …). */
function uniqueSlug(base: string): string {
  const existing = new Set(listMaps());
  let slug = slugify(base);
  if (!existing.has(slug)) return slug;
  let i = 2;
  while (existing.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

export function duplicateMap(name: string): { ok: boolean; name?: string; error?: string } {
  const src = getMap(name);
  if (!src) return { ok: false, error: 'Carte introuvable.' };
  const newSlug = uniqueSlug(`${slugify(name)}-copie`);
  const copy: MapData = { ...src, name: newSlug, createdAt: undefined, updatedAt: undefined };
  const saved = saveMap(copy);
  return { ok: true, name: saved };
}

export function deleteMap(name: string, opts: { activeName: string }): { ok: boolean; error?: string } {
  const slug = slugify(name);
  if (slug === slugify(opts.activeName)) {
    return { ok: false, error: 'Impossible de supprimer la carte active.' };
  }
  const maps = listMaps();
  if (!maps.includes(slug)) return { ok: false, error: 'Carte introuvable.' };
  if (maps.length <= 1) return { ok: false, error: 'Au moins une carte doit subsister.' };
  fs.unlinkSync(path.join(MAPS_DIR, `${slug}.json`));
  return { ok: true };
}
