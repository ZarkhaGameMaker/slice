import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { categoryOf } from '../lib/categories';
import { monthDiff } from '../lib/dates';
import { monthIndexOf, type DayPoint, type MonthData } from '../lib/finance';
import {
  dayLabel,
  money,
  moneyCompact,
  monthName,
  monthShortName,
  periodRange,
  signedMoney,
  signedMoneyRound,
} from '../lib/format';
import {
  DURATION,
  easeOut,
  rubberBand,
  useElementWidth,
  useHorizontalDrag,
  usePresence,
  useSpring,
  useTweened,
} from '../lib/motion';

interface Props {
  months: MonthData[];
  index: number;
  onIndexChange: (index: number) => void;
  today: string;
  /** Hauteur imposée (px) ; sinon 300 sur mobile, 360 ailleurs. */
  height?: number;
}

type Pt = [number, number];

/** Netteté de la courbe du solde : 0 = très douce, 1 = presque en escalier. */
const CURVE_SHARPNESS = 0.45;

/**
 * Courbe monotone (pas de dépassement entre deux points), comme d3.curveMonotoneX.
 * `sharpness` aplatit la courbe autour de chaque jour et resserre la transition
 * entre deux jours : le solde « tient » entre les opérations, puis change plus franchement.
 */
function monotonePath(pts: Pt[], sharpness = 0): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const h: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1][0] - pts[i][0] || 1e-6;
    m[i] = (pts[i + 1][1] - pts[i][1]) / h[i];
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const p = (m[i - 1] * h[i] + m[i] * h[i - 1]) / (h[i - 1] + h[i]);
    t[i] = (Math.sign(m[i - 1]) + Math.sign(m[i])) * Math.min(Math.abs(m[i - 1]), Math.abs(m[i]), 0.5 * Math.abs(p)) || 0;
  }
  // Pentes réduites et poignées allongées (1/3 → 1/2 de l'écart) : les points de contrôle
  // restent entre les deux valeurs, la courbe ne dépasse donc toujours pas.
  const slope = 1 - sharpness;
  const handle = 1 / 3 + sharpness / 6;
  for (let i = 0; i < n; i++) t[i] *= slope;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = h[i] * handle;
    d +=
      `C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + t[i] * dx).toFixed(1)} ` +
      `${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * dx).toFixed(1)} ` +
      `${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100 || 0);
  return out;
}

/** Valeurs dessinées pour un jour : solde, gains, dépenses, et leurs estimations. */
interface Sample {
  b: number;
  i: number;
  e: number;
  /** Solde estimé (= b pour un jour passé). */
  fb: number;
  ei: number;
  ee: number;
}

const sampleOf = (p: DayPoint): Sample => ({
  b: p.balance,
  i: p.income,
  e: p.expense,
  fb: p.estBalance,
  ei: p.estIncome,
  ee: p.estExpense,
});
const mix = (from: Sample, to: Sample, t: number): Sample => ({
  b: from.b + (to.b - from.b) * t,
  i: from.i + (to.i - from.i) * t,
  e: from.e + (to.e - from.e) * t,
  fb: from.fb + (to.fb - from.fb) * t,
  ei: from.ei + (to.ei - from.ei) * t,
  ee: from.ee + (to.ee - from.ee) * t,
});

interface MorphState {
  months: MonthData[];
  /** Valeurs affichées au moment du changement, par date. */
  from: Map<string, Sample>;
  /** Solde de départ pour les dates absentes de `from` (avant / après). */
  firstDate: string;
  firstBalance: number;
  lastBalance: number;
  progress: number;
  raf: number;
}

/**
 * Quand les données changent (autre compte, nouvelle opération…), chaque jour glisse de la valeur
 * affichée vers sa nouvelle valeur en DURATION.slow, en même temps que l'échelle (useTweened).
 * Renvoie la valeur à dessiner pour un jour donné.
 */
function useMorph(months: MonthData[]) {
  const [progress, setProgress] = useState(1);
  const ref = useRef<MorphState>({
    months,
    from: new Map(),
    firstDate: '',
    firstBalance: 0,
    lastBalance: 0,
    progress: 1,
    raf: 0,
  });

  const sampleAt = (st: MorphState, p: DayPoint, t: number): Sample => {
    if (t >= 1) return sampleOf(p);
    const near = p.date < st.firstDate ? st.firstBalance : st.lastBalance;
    const from = st.from.get(p.date) ?? {
      // Jour inconnu de l'ancien jeu : la courbe part du solde le plus proche, sans barre.
      b: near,
      i: 0,
      e: 0,
      fb: near,
      ei: 0,
      ee: 0,
    };
    return mix(from, sampleOf(p), t);
  };

  useLayoutEffect(() => {
    const st = ref.current;
    if (st.months === months) return;
    // Photographie de ce qui est affiché maintenant (éventuellement en pleine transition).
    const t = easeOut(st.progress);
    const snapshot = new Map<string, Sample>();
    for (const m of st.months) for (const p of m.days) snapshot.set(p.date, sampleAt(st, p, t));
    const oldDays = st.months.flatMap((m) => m.days);
    st.from = snapshot;
    st.firstDate = oldDays[0]?.date ?? '';
    st.firstBalance = snapshot.get(st.firstDate)?.b ?? 0;
    st.lastBalance = oldDays.length ? (snapshot.get(oldDays[oldDays.length - 1].date)?.b ?? 0) : 0;
    st.months = months;
    // Premier affichage (aucun ancien jeu) : rien à animer.
    if (!oldDays.length) return;

    cancelAnimationFrame(st.raf);
    st.progress = 0;
    setProgress(0);
    const start = performance.now();
    const tick = (now: number) => {
      st.progress = Math.min(1, Math.max(0, (now - start) / DURATION.slow));
      setProgress(st.progress);
      if (st.progress < 1) st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    // sampleAt ne lit que ref.current.
  }, [months]);

  useEffect(() => () => cancelAnimationFrame(ref.current.raf), []);

  const t = easeOut(progress);
  return {
    day: (p: DayPoint) => sampleAt(ref.current, p, t),
    /** Solde d'ouverture du premier mois, transformé comme son premier jour. */
    opening: (m: MonthData) => {
      if (t >= 1 || !m.days[0]) return m.openingBalance;
      const first = sampleAt(ref.current, m.days[0], 0).b;
      return first + (m.openingBalance - first) * t;
    },
  };
}

const TOP = 58;
const BOTTOM = 30;

/** Un jour à venir dont la prévision ajoute quelque chose aux opérations déjà connues. */
const estimated = (p: DayPoint) => p.future && (p.estIncome > 0.005 || p.estExpense > 0.005);

export function MonthStrip({ months, index, onIndexChange, today, height }: Props) {
  const uid = useId().replace(/:/g, '');
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(900);
  const compact = width < 640;
  // Le graphique grandit avec la place disponible : sur un grand écran, il respire.
  const H = height ?? (compact ? 300 : width >= 1700 ? 460 : width >= 1300 ? 410 : 360);
  const panelW = compact ? width * 0.86 : Math.min(width * 0.72, 1040);
  const n = months.length;

  const spring = useSpring(index);
  const shape = useMorph(months);
  const requested = useRef(index);
  const dragStart = useRef(index);
  const [hover, setHover] = useState<{ i: number; d: number } | null>(null);

  // Changement de compte : le premier mois peut changer, on garde le même mois à l'écran.
  const firstKey = useRef(months[0]?.key);
  useLayoutEffect(() => {
    const prev = firstKey.current;
    const cur = months[0]?.key;
    firstKey.current = cur;
    if (prev && cur && prev !== cur) {
      const delta = monthDiff(cur, prev);
      spring.shift(delta);
      requested.current += delta;
    }
  }, [months, spring]);

  useEffect(() => {
    if (index !== requested.current) {
      requested.current = index;
      spring.animateTo(index);
    }
  }, [index, spring]);

  const snapTo = (target: number, velocity?: number) => {
    const t = Math.min(n - 1, Math.max(0, target));
    requested.current = t;
    spring.animateTo(t, velocity);
    if (t !== index) onIndexChange(t);
  };

  const pos = spring.value;
  const tx = width / 2 - (pos + 0.5) * panelW;

  const pickAt = (clientX: number): { i: number; d: number } | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const gx = clientX - el.getBoundingClientRect().left - tx;
    const i = Math.floor(gx / panelW);
    if (i < 0 || i >= n) return null;
    const dim = months[i].days.length;
    const d = Math.min(dim, Math.max(1, Math.floor((gx / panelW - i) * dim) + 1));
    return { i, d };
  };

  const { dragging, handlers } = useHorizontalDrag({
    onStart: () => {
      spring.stop();
      dragStart.current = spring.get();
      setHover(null);
    },
    onMove: (dx) => spring.set(rubberBand(dragStart.current - dx / panelW, 0, n - 1, 3)),
    onEnd: (_dx, velocity) => {
      const v = -velocity / panelW;
      const from = Math.round(dragStart.current);
      const target = Math.round(spring.get() + v * 0.28);
      // Un lancer fait avancer de 3 mois au maximum.
      snapTo(Math.min(from + 3, Math.max(from - 3, target)), v);
    },
    onTap: (e) => {
      const hit = pickAt(e.clientX);
      if (!hit) return;
      if (hit.i !== index) {
        snapTo(hit.i);
        setHover(null);
      } else {
        setHover(hit);
      }
    },
  });

  // Molette / pavé tactile horizontal.
  const wheelTimer = useRef(0);
  const live = useRef({ n, panelW, snapTo });
  live.current = { n, panelW, snapTo };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!delta) return;
      e.preventDefault();
      const { n: count, panelW: pw } = live.current;
      spring.set(rubberBand(spring.get() + delta / pw, 0, count - 1, 3));
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => live.current.snapTo(Math.round(spring.get())), DURATION.fast);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheelTimer.current);
    };
  }, [spring, wrapRef]);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    handlers.onPointerMove(e);
    if (e.pointerType === 'mouse' && !dragging && e.buttons === 0) setHover(pickAt(e.clientX));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: n - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    snapTo(map[e.key]);
  };

  // Mois visibles (+1 de chaque côté pour que la courbe sorte proprement de l'écran).
  const half = width / 2 / panelW;
  const lo = Math.max(0, Math.floor(pos - half) - 1);
  const hi = Math.min(n - 1, Math.ceil(pos + half) + 1);

  // Échelles du mois affiché : son plus haut solde touche le haut de la courbe, sa plus grosse
  // opération le haut des barres. Lissées pour suivre le glisser d'un mois à l'autre.
  const focus = Math.min(n - 1, Math.max(0, Math.round(pos)));
  const target = useMemo(() => {
    const m = months[focus];
    if (!m) return [0, 100, 1];
    let low = m.openingBalance;
    let high = m.openingBalance;
    let fMax = 0;
    for (const p of m.days) {
      if (p.balance < low) low = p.balance;
      if (p.balance > high) high = p.balance;
      fMax = Math.max(fMax, Math.sqrt(p.income), Math.sqrt(p.expense));
    }
    // Solde (quasi) constant : on affiche aussi zéro plutôt que de zoomer sur une ligne plate.
    if (high - low <= Math.max(1, Math.abs(high) * 0.01)) {
      low = Math.min(low, 0);
      high = Math.max(high, 0);
    }
    if (high === low) high = low + 100;
    const span = high - low;
    return [low - span * 0.08, high + span * 0.05, fMax || 1];
  }, [months, focus]);
  const [bMin, bMax, fMax] = useTweened(target);

  const balTop = TOP + 4;
  const balBottom = TOP + (H - TOP - BOTTOM) * 0.62;
  const flowTop = balBottom + 20;
  const flowBottom = H - BOTTOM - 6;
  const flowMid = (flowTop + flowBottom) / 2;

  const yBal = (v: number) => balBottom - ((v - bMin) / (bMax - bMin || 1)) * (balBottom - balTop);
  // Les mois voisins peuvent dépasser l'échelle du mois affiché : barres plafonnées.
  const flowUp = (v: number) => Math.min(1, Math.sqrt(v) / fMax) * (flowMid - flowTop);
  const flowDown = (v: number) => Math.min(1, Math.sqrt(v) / fMax) * (flowBottom - flowMid);
  /** Abscisse du k-ième jour (1 = premier jour) de la période i. */
  const xOf = (i: number, k: number) => (i + (k - 0.5) / months[i].days.length) * panelW;

  // Courbe du solde : trait plein jusqu'à aujourd'hui, pointillés ensuite. Les jours à venir
  // suivent le solde estimé (opérations connues + habitudes des mois terminés).
  const past: Pt[] = [];
  const future: Pt[] = [];
  if (lo === 0 && months[0]) past.push([0, yBal(shape.opening(months[0]))]);
  for (let i = lo; i <= hi; i++) {
    months[i].days.forEach((p, k) => {
      const v = shape.day(p);
      const pt: Pt = [xOf(i, k + 1), yBal(p.future ? v.fb : v.b)];
      if (p.future) {
        if (future.length === 0 && past.length > 0) future.push(past[past.length - 1]);
        future.push(pt);
      } else past.push(pt);
    });
  }
  if (hi === n - 1 && months[hi]) {
    const lastDay = months[hi].days[months[hi].days.length - 1];
    const v = lastDay ? shape.day(lastDay) : null;
    const ahead = future.length > 0;
    const endPt: Pt = [(hi + 1) * panelW, yBal(v ? (ahead ? v.fb : v.b) : months[hi].closingBalance)];
    (ahead ? future : past).push(endPt);
  }

  const pastLine = monotonePath(past, CURVE_SHARPNESS);
  const futureLine = monotonePath(future, CURVE_SHARPNESS);
  const area = (pts: Pt[], line: string) =>
    pts.length > 1 ? `${line}L${pts[pts.length - 1][0].toFixed(1)},${balBottom}L${pts[0][0].toFixed(1)},${balBottom}Z` : '';

  const ticks = niceTicks(bMin, bMax, compact ? 3 : 4);
  // Ligne rouge du zéro seulement si un solde visible est réellement négatif.
  const negative = months.slice(lo, hi + 1).some((m) => m.openingBalance < 0 || m.days.some((p) => p.balance < 0));
  const todayMonthIdx = monthIndexOf(months, today);
  const todayDay = todayMonthIdx >= 0 ? months[todayMonthIdx].days.findIndex((p) => p.date === today) + 1 : 0;

  // Le jour survolé reste affiché le temps de l'animation de sortie de l'infobulle.
  const tip = usePresence(hover && months[hover.i] ? hover : null);
  const shown = tip.item && months[tip.item.i] ? tip.item : null;
  const hovered: DayPoint | null = shown ? (months[shown.i].days[shown.d - 1] ?? null) : null;
  const hoverX = shown && hovered ? tx + xOf(shown.i, shown.d) : 0;

  const barW = Math.max(2, Math.min(12, (panelW / 31) * 0.52));

  // Fenêtre du mois ciblé (toujours centré) : seule zone où l'aire sous la courbe est peinte.
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const winLeft = (width - panelW) / 2;
  const winStops = [winLeft - 20, winLeft, winLeft + panelW, winLeft + panelW + 20].map((x) => clamp01(width > 0 ? x / width : 0));
  // Bande verticale de la courbe : au-delà, les mois voisins hors échelle s'estompent.
  const bandFrom = balTop - 18;
  const bandTo = balBottom + 18;
  const bandStop = (y: number) => clamp01((y - bandFrom) / (bandTo - bandFrom));

  return (
    <div
      ref={wrapRef}
      className={`strip${dragging ? ' is-dragging' : ''}`}
      style={{ height: H }}
      tabIndex={0}
      role="group"
      aria-roledescription="carrousel de mois"
      aria-label={months[index] ? `Graphique de ${monthName(months[index].key)} ${months[index].year}. Flèches gauche et droite pour changer de mois.` : 'Graphique'}
      onKeyDown={onKeyDown}
      {...handlers}
      onPointerMove={onPointerMove}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
    >
      <svg width={width} height={H} className="strip__svg">
        <defs>
          <linearGradient id={`area-${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={balTop} y2={balBottom}>
            <stop offset="0" stopColor="var(--chart-line)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`area-f-${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={balTop} y2={balBottom}>
            <stop offset="0" stopColor="var(--chart-line)" stopOpacity="0.12" />
            <stop offset="1" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`fade-${uid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset={compact ? 0.04 : 0.07} stopColor="#fff" stopOpacity="1" />
            <stop offset={compact ? 0.96 : 0.93} stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`win-${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2={width} y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset={winStops[0]} stopColor="#fff" stopOpacity="0" />
            <stop offset={winStops[1]} stopColor="#fff" stopOpacity="1" />
            <stop offset={winStops[2]} stopColor="#fff" stopOpacity="1" />
            <stop offset={winStops[3]} stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`win-mask-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={H}>
            <rect x="0" y="0" width={width} height={H} fill={`url(#win-${uid})`} />
          </mask>
          <linearGradient id={`band-${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={bandFrom} y2={bandTo}>
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset={bandStop(balTop)} stopColor="#fff" stopOpacity="1" />
            <stop offset={bandStop(balBottom)} stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`band-mask-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={H}>
            <rect x="0" y="0" width={width} height={H} fill={`url(#band-${uid})`} />
          </mask>
          <mask id={`mask-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={H}>
            <rect x="0" y="0" width={width} height={H} fill={`url(#fade-${uid})`} />
          </mask>
        </defs>

        {/* Grille fixe */}
        {ticks.map((v) => (
          <line key={v} x1={0} x2={width} y1={yBal(v)} y2={yBal(v)} className="grid-line" />
        ))}
        {negative && bMin < 0 && bMax > 0 && <line x1={0} x2={width} y1={yBal(0)} y2={yBal(0)} className="zero-line" />}
        <line x1={0} x2={width} y1={flowMid} y2={flowMid} className="flow-axis" />

        <g mask={`url(#mask-${uid})`}>
          <g transform={`translate(${tx.toFixed(2)},0)`}>
            {Array.from({ length: hi - lo + 1 }, (_, k) => {
              const i = lo + k;
              const m = months[i];
              const dist = Math.min(1, Math.abs(i - pos));
              const x0 = i * panelW;
              const dim = m.days.length;
              const net = m.income - m.expense;
              // Graduations : 1er du mois, jours ronds et bords de période (pas sur mobile : ils se chevaucheraient).
              const tickDays = m.days.flatMap((p, k) => {
                const edge = k === 0 || k === dim - 1;
                const nearEdge = k <= 1 || k >= dim - 2;
                const round = (p.day === 1 || (p.day % 5 === 0 && p.day <= 25)) && !(nearEdge && !edge);
                if (compact ? edge || !round : !(edge || round)) return [];
                return [{ k: k + 1, label: p.day === 1 && k > 0 ? `1 ${monthShortName(p.date.slice(0, 7))}` : String(p.day) }];
              });
              // Période décalée (jour de paie) : on affiche ses dates à côté du mois.
              const shifted = m.days[0].day !== 1;
              return (
                <g key={m.key} className="month">
                  <rect
                    x={x0 + 1}
                    y={4}
                    width={panelW - 2}
                    height={H - 8}
                    rx={16}
                    className="month__focus"
                    style={{ opacity: 1 - dist }}
                  />
                  {i > 0 && <line x1={x0} x2={x0} y1={14} y2={H - 12} className="month__sep" />}
                  <g style={{ opacity: 1 - dist * 0.55 }}>
                    <text x={x0 + 18} y={32} className="month__title">
                      {monthName(m.key)}
                      <tspan className="month__year" dx={6}>{m.year}</tspan>
                      {shifted && !compact && (
                        <tspan className="month__range" dx={10}>{periodRange(m.start, m.end)}</tspan>
                      )}
                    </text>
                    <text x={x0 + panelW - 18} y={32} textAnchor="end" className={`month__net ${net >= 0 ? 'up' : 'down'}`}>
                      {signedMoneyRound(net)}
                    </text>
                    {tickDays.map((t) => (
                      <text key={t.k} x={xOf(i, t.k)} y={H - 10} textAnchor="middle" className={`month__tick${t.label.length > 2 ? ' month__tick--month' : ''}`}>
                        {t.label}
                      </text>
                    ))}
                  </g>
                  {m.days.map((p, k) => {
                    const x = xOf(i, k + 1) - barW / 2;
                    const { i: income, e: expense, ei, ee } = shape.day(p);
                    return (
                      <g key={p.date} className={p.future ? 'is-future' : undefined}>
                        {/* Barre fantôme : hauteur de la journée estimée, l'opération connue se pose dessus. */}
                        {ei > 0.005 && (
                          <rect x={x} y={flowMid - flowUp(income + ei)} width={barW} height={Math.max(1.5, flowUp(income + ei))} rx={barW / 2.5} className="bar bar--up bar--est" />
                        )}
                        {ee > 0.005 && (
                          <rect x={x} y={flowMid} width={barW} height={Math.max(1.5, flowDown(expense + ee))} rx={barW / 2.5} className="bar bar--down bar--est" />
                        )}
                        {income > 0.005 && (
                          <rect x={x} y={flowMid - flowUp(income)} width={barW} height={Math.max(1.5, flowUp(income))} rx={barW / 2.5} className="bar bar--up" />
                        )}
                        {expense > 0.005 && (
                          <rect x={x} y={flowMid} width={barW} height={Math.max(1.5, flowDown(expense))} rx={barW / 2.5} className="bar bar--down" />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* L'échelle est celle du mois ciblé : un mois voisin plus haut ou plus bas s'estompe
              au bord de la bande, et l'aire colorée n'est peinte que sous le mois ciblé
              (sinon elle formerait un bloc plein sous le titre du voisin). */}
          <g mask={`url(#band-mask-${uid})`}>
            <g mask={`url(#win-mask-${uid})`}>
              <g transform={`translate(${tx.toFixed(2)},0)`}>
                <path d={area(past, pastLine)} fill={`url(#area-${uid})`} />
                <path d={area(future, futureLine)} fill={`url(#area-f-${uid})`} />
              </g>
            </g>
            <g transform={`translate(${tx.toFixed(2)},0)`}>
              <path d={pastLine} className="balance-line" />
              <path d={futureLine} className="balance-line balance-line--future" />
            </g>
          </g>

          <g transform={`translate(${tx.toFixed(2)},0)`}>
            {todayMonthIdx >= lo && todayMonthIdx <= hi && (
              <g className="today">
                <line
                  x1={xOf(todayMonthIdx, todayDay)}
                  x2={xOf(todayMonthIdx, todayDay)}
                  y1={TOP - 4}
                  y2={flowBottom}
                />
                <rect x={xOf(todayMonthIdx, todayDay) - 38} y={TOP - 16} width={76} height={18} rx={9} />
                <text x={xOf(todayMonthIdx, todayDay)} y={TOP - 3} textAnchor="middle">Aujourd’hui</text>
              </g>
            )}

            {shown && hovered && (
              <g className="crosshair" data-state={tip.state}>
                <line x1={xOf(shown.i, shown.d)} x2={xOf(shown.i, shown.d)} y1={TOP} y2={flowBottom} />
                <circle cx={xOf(shown.i, shown.d)} cy={yBal(shape.day(hovered).b)} r={5.5} />
              </g>
            )}
          </g>
        </g>

        {/* Libellés de l'axe, au-dessus de tout */}
        {ticks.map((v) => (
          <text key={v} x={10} y={yBal(v) - 5} className="axis-label">
            {moneyCompact(v)}
          </text>
        ))}
      </svg>

      {shown && hovered && (
        <div
          className={`strip__tip${hoverX > width / 2 ? ' is-left' : ''}`}
          data-state={tip.state}
          style={{ left: hoverX, top: TOP + 6 }}
          role="status"
        >
          <div className="strip__tip-date">
            {dayLabel(hovered.date)}
            {hovered.future && <span className="badge">Prévu</span>}
          </div>
          <div className="strip__tip-balance">
            <span>{hovered.future ? 'Solde prévu' : 'Solde'}</span>
            <strong className={(hovered.future ? hovered.estBalance : hovered.balance) < 0 ? 'down' : undefined}>
              {money(hovered.future ? hovered.estBalance : hovered.balance)}
            </strong>
          </div>
          {hovered.entries.length > 0 ? (
            <ul>
              {hovered.entries.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <span className="strip__tip-label">
                    {categoryOf(e.type, e.category).icon} {e.label}
                  </span>
                  <span className={e.type === 'income' ? 'up' : 'down'}>
                    {signedMoney(e.type === 'income' ? e.amount : -e.amount)}
                  </span>
                </li>
              ))}
              {hovered.entries.length > 5 && <li className="muted">+ {hovered.entries.length - 5} autres</li>}
            </ul>
          ) : null}
          {hovered.entries.length > 0 ? (
            <div className="strip__tip-total">
              <div>
                <span>Total du jour</span>
                <strong className={hovered.income - hovered.expense >= 0 ? 'up' : 'down'}>
                  {signedMoney(hovered.income - hovered.expense)}
                </strong>
              </div>
              {hovered.income > 0 && hovered.expense > 0 && (
                <small>
                  <span className="up">{signedMoney(hovered.income)}</span> · <span className="down">{signedMoney(-hovered.expense)}</span>
                </small>
              )}
              <small className="muted">
                {hovered.entries.length} opération{hovered.entries.length > 1 ? 's' : ''}
              </small>
            </div>
          ) : null}
          {estimated(hovered) && (
            <div className="strip__tip-est">
              <div>
                <span>Estimation du jour</span>
                <strong className={hovered.estIncome - hovered.estExpense >= 0 ? 'up' : 'down'}>
                  {signedMoney(hovered.estIncome - hovered.estExpense)}
                </strong>
              </div>
              <small className="muted">d’après vos mois terminés</small>
            </div>
          )}
          {hovered.entries.length === 0 && !estimated(hovered) && <div className="muted small">Aucune opération</div>}
        </div>
      )}
    </div>
  );
}
