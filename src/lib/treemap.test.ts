import { describe, expect, it } from 'vitest';
import { squarify } from './treemap';

const area = (r: { w: number; h: number }) => r.w * r.h;

describe('squarify', () => {
  const bounds = { x: 0, y: 0, w: 600, h: 400 };
  const values = [6, 6, 4, 3, 2, 2, 1];
  const rects = squarify(values, bounds);

  it('donne des aires proportionnelles aux valeurs', () => {
    const total = values.reduce((s, v) => s + v, 0);
    rects.forEach((r, i) => expect(area(r)).toBeCloseTo((values[i] / total) * 600 * 400, 6));
  });

  it('reste dans le cadre et remplit toute la surface', () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(400 + 1e-6);
    }
    expect(rects.reduce((s, r) => s + area(r), 0)).toBeCloseTo(240000, 4);
  });

  it('ne superpose aucun rectangle', () => {
    for (let a = 0; a < rects.length; a++)
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a];
        const B = rects[b];
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        expect(ox <= 1e-6 || oy <= 1e-6).toBe(true);
      }
  });

  it('produit des tuiles plutôt carrées', () => {
    const ratios = rects.map((r) => Math.max(r.w / r.h, r.h / r.w));
    expect(Math.max(...ratios)).toBeLessThan(3);
  });

  it('gère les cas vides', () => {
    expect(squarify([], bounds)).toEqual([]);
    expect(squarify([0, 0], bounds).every((r) => r.w === 0)).toBe(true);
    expect(area(squarify([5], bounds)[0])).toBeCloseTo(240000);
  });
});
