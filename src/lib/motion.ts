import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
} from 'react';

/**
 * Vitesses d'animation de toute l'app (ms). Les mêmes valeurs existent en CSS :
 * --dur-fast, --dur-base, --dur-slow dans styles.css. Les garder synchronisées.
 * - fast : survols, pressions, petits changements de couleur ;
 * - base : apparitions et disparitions (infobulles, menus, fenêtres, pastilles) ;
 * - slow : mouvements (carrés, graphique, carrousel, couleur d'accent).
 */
export const DURATION = { fast: 150, base: 250, slow: 450 } as const;

/** Courbe « ease-out » commune aux animations pilotées en JS (équivalent de --ease en CSS). */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

// Ressort quasi critique : se pose en ~DURATION.slow.
const STIFFNESS = 170;
const DAMPING = 26;
const MAX_VELOCITY = 3000; // px/s

/**
 * Valeur animée par un ressort (position flottante d'un carrousel par ex.).
 * `get()` renvoie la valeur courante sans attendre le rendu.
 */
export function useSpring(initial: number) {
  const [value, setValue] = useState(initial);
  const s = useRef({ x: initial, v: 0, target: initial, raf: 0, last: 0 });

  const stop = useCallback(() => {
    cancelAnimationFrame(s.current.raf);
    s.current.raf = 0;
    s.current.v = 0;
  }, []);

  const set = useCallback(
    (x: number) => {
      stop();
      s.current.x = x;
      s.current.target = x;
      setValue(x);
    },
    [stop],
  );

  const animateTo = useCallback((target: number, velocity?: number) => {
    const st = s.current;
    cancelAnimationFrame(st.raf);
    st.target = target;
    if (velocity !== undefined) st.v = velocity;
    st.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - st.last) / 1000);
      st.last = now;
      const a = -STIFFNESS * (st.x - st.target) - DAMPING * st.v;
      st.v += a * dt;
      st.x += st.v * dt;
      if (Math.abs(st.x - st.target) < 0.0004 && Math.abs(st.v) < 0.004) {
        st.x = st.target;
        st.v = 0;
        st.raf = 0;
        setValue(st.x);
        return;
      }
      setValue(st.x);
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }, []);

  /** Décale valeur et cible sans interrompre l'animation (changement de repère). */
  const shift = useCallback((delta: number) => {
    s.current.x += delta;
    s.current.target += delta;
    setValue(s.current.x);
  }, []);

  useEffect(() => () => cancelAnimationFrame(s.current.raf), []);

  return useMemo(
    () => ({ value, get: () => s.current.x, set, animateTo, shift, stop }),
    [value, set, animateTo, shift, stop],
  );
}

/**
 * Interpole un tuple de nombres vers sa cible en `duration` ms (courbe « ease-out »,
 * comme --ease en CSS). Une nouvelle cible repart de la valeur affichée.
 */
export function useTweened(target: number[], duration: number = DURATION.slow): number[] {
  const [val, setVal] = useState(target);
  const ref = useRef(target);
  const key = target.map((n) => n.toFixed(4)).join('|');
  useEffect(() => {
    const from = ref.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = easeOut(t);
      ref.current = t === 1 ? target : from.map((f, i) => f + (target[i] - f) * eased);
      setVal(ref.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `key` résume `target` : inutile de relancer à chaque nouveau tableau identique.
  }, [key, duration]);
  return val;
}

/**
 * Garde un élément affiché le temps de son animation de sortie.
 * `item` vaut la valeur courante, ou la dernière connue pendant la sortie ;
 * `state` sert d'attribut data-state (« open » / « closed ») pour les animations CSS.
 */
export function usePresence<T>(value: T | null | undefined, duration: number = DURATION.base) {
  const [last, setLast] = useState<T | null>(value ?? null);
  useEffect(() => {
    if (value != null) {
      setLast(value);
      return;
    }
    const t = window.setTimeout(() => setLast(null), duration);
    return () => window.clearTimeout(t);
  }, [value, duration]);
  const open = value != null;
  return { item: open ? value : last, state: open ? ('open' as const) : ('closed' as const) };
}

interface DragCallbacks {
  onStart?: () => void;
  /** Déplacement horizontal depuis le début du geste, en px. */
  onMove: (dx: number) => void;
  /** Fin du geste : déplacement total et vitesse (px/s). */
  onEnd: (dx: number, velocity: number) => void;
  /** Appui sans déplacement. */
  onTap?: (e: RPointerEvent<HTMLElement>) => void;
}

/**
 * Glisser horizontal pour souris et tactile. Le défilement vertical reste natif
 * (à combiner avec `touch-action: pan-y`). Les clics qui suivent un glisser sont ignorés.
 */
export function useHorizontalDrag(callbacks: DragCallbacks) {
  const cb = useRef(callbacks);
  cb.current = callbacks;
  const [dragging, setDragging] = useState(false);
  const st = useRef<{
    id: number;
    x0: number;
    y0: number;
    axis: 'x' | 'y' | null;
    samples: { x: number; t: number }[];
  } | null>(null);
  const suppressClick = useRef(false);

  const handlers = useMemo(
    () => ({
      onPointerDown(e: RPointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        st.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, samples: [{ x: e.clientX, t: e.timeStamp }] };
        suppressClick.current = false;
      },
      onPointerMove(e: RPointerEvent<HTMLElement>) {
        const s = st.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x0;
        const dy = e.clientY - s.y0;
        if (!s.axis) {
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          s.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          if (s.axis === 'x') {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            cb.current.onStart?.();
          }
        }
        if (s.axis !== 'x') return;
        s.samples.push({ x: e.clientX, t: e.timeStamp });
        while (s.samples.length > 2 && e.timeStamp - s.samples[0].t > 100) s.samples.shift();
        cb.current.onMove(dx);
      },
      onPointerUp(e: RPointerEvent<HTMLElement>) {
        const s = st.current;
        if (!s || s.id !== e.pointerId) return;
        st.current = null;
        if (s.axis === 'x') {
          const first = s.samples[0];
          const dt = (e.timeStamp - first.t) / 1000;
          const raw = dt > 0 ? (e.clientX - first.x) / dt : 0;
          const velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, raw));
          suppressClick.current = true;
          setDragging(false);
          cb.current.onEnd(e.clientX - s.x0, velocity);
        } else if (!s.axis) {
          cb.current.onTap?.(e);
        }
      },
      onPointerCancel(e: RPointerEvent<HTMLElement>) {
        const s = st.current;
        if (!s || s.id !== e.pointerId) return;
        st.current = null;
        if (s.axis === 'x') {
          setDragging(false);
          cb.current.onEnd(e.clientX - s.x0, 0);
        }
      },
      onClickCapture(e: RMouseEvent) {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
          suppressClick.current = false;
        }
      },
    }),
    [],
  );

  return { dragging, handlers };
}

/** Résistance élastique au-delà des bornes. */
export function rubberBand(value: number, min: number, max: number, strength = 0.35) {
  if (value < min) return min - (1 - 1 / ((min - value) * strength + 1)) / strength;
  if (value > max) return max + (1 - 1 / ((value - max) * strength + 1)) / strength;
  return value;
}

/** Taille de la fenêtre, mise à jour au redimensionnement. */
export function useViewport() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const onResize = () => setViewport(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

/** Taille (largeur, hauteur) d'un élément, mise à jour au redimensionnement. */
export function useElementSize<T extends HTMLElement>(fallback = { width: 480, height: 300 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Largeur d'un élément, mise à jour au redimensionnement. */
export function useElementWidth<T extends HTMLElement>(fallback = 800) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  // Mesure avant le premier affichage pour éviter un saut de mise en page.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
