export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pire rapport largeur/hauteur d'une rangée de surfaces posée le long d'un côté. */
function worst(row: number[], side: number): number {
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const a of row) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Treemap « squarified » (Bruls, Huizing & van Wijk) : découpe `bounds` en rectangles
 * d'aires proportionnelles à `values`, aussi proches que possible du carré.
 * `values` doit être trié par ordre décroissant ; les valeurs ≤ 0 donnent un rectangle vide.
 */
export function squarify(values: number[], bounds: Rect): Rect[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const out: Rect[] = values.map(() => ({ x: bounds.x, y: bounds.y, w: 0, h: 0 }));
  if (total <= 0 || bounds.w <= 0 || bounds.h <= 0) return out;

  const scale = (bounds.w * bounds.h) / total;
  const areas = values.map((v) => Math.max(0, v) * scale);
  let { x, y, w, h } = bounds;
  let i = 0;
  while (i < areas.length && areas[i] > 0) {
    const side = Math.min(w, h);
    let end = i + 1;
    let current = worst(areas.slice(i, end), side);
    while (end < areas.length && areas[end] > 0) {
      const next = worst(areas.slice(i, end + 1), side);
      if (next > current) break;
      current = next;
      end++;
    }
    const row = areas.slice(i, end);
    const rowSum = row.reduce((s, a) => s + a, 0);
    if (w >= h) {
      // Colonne à gauche, sur toute la hauteur restante.
      const colW = rowSum / h;
      let cy = y;
      row.forEach((a, k) => {
        const rh = a / colW;
        out[i + k] = { x, y: cy, w: colW, h: rh };
        cy += rh;
      });
      x += colW;
      w -= colW;
    } else {
      // Rangée en haut, sur toute la largeur restante.
      const rowH = rowSum / w;
      let cx = x;
      row.forEach((a, k) => {
        const rw = a / rowH;
        out[i + k] = { x: cx, y, w: rw, h: rowH };
        cx += rw;
      });
      y += rowH;
      h -= rowH;
    }
    i = end;
  }
  return out;
}
