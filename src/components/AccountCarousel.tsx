import { useEffect, useRef, type KeyboardEvent } from 'react';
import { money, signedMoney } from '../lib/format';
import { rubberBand, useElementWidth, useHorizontalDrag, useSpring } from '../lib/motion';
import { ChevronLeft, ChevronRight, EditIcon, LayersIcon, PlusIcon, ReorderIcon, StarIcon, WalletIcon } from './Icons';

export interface CarouselItem {
  id: string;
  kind: 'all' | 'account';
  name: string;
  color: string;
  balance: number;
  monthIncome: number;
  monthExpense: number;
  subtitle: string;
  /** Compte principal : affiché à l'ouverture de l'app. */
  primary: boolean;
  /** Compte mis de côté : gardé pour son historique, hors des totaux. */
  archived: boolean;
}

interface Props {
  items: CarouselItem[];
  index: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  /** Ouvre la réorganisation des comptes (affiché à partir de deux comptes). */
  onReorder: () => void;
  onTogglePrimary: (id: string) => void;
}

const GAP = 18;

export function AccountCarousel({ items, index, onSelect, onAdd, onEdit, onReorder, onTogglePrimary }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>(900);
  const cardW = Math.min(340, Math.max(240, width - 72));
  const step = cardW + GAP;
  const maxIndex = Math.max(0, items.length - 1);

  const spring = useSpring(index);
  const dragStart = useRef(index);
  const requested = useRef(index);

  useEffect(() => {
    if (index !== requested.current) {
      requested.current = index;
      spring.animateTo(index);
    }
  }, [index, spring]);

  const { dragging, handlers } = useHorizontalDrag({
    onStart: () => {
      spring.stop();
      dragStart.current = spring.get();
    },
    onMove: (dx) => spring.set(rubberBand(dragStart.current - dx / step, 0, maxIndex, 3)),
    onEnd: (dx, velocity) => {
      const v = -velocity / step;
      let target = Math.round(spring.get() + v * 0.18);
      const from = Math.round(dragStart.current);
      if (target === from && Math.abs(dx) > step * 0.12) target = from + (dx < 0 ? 1 : -1);
      target = Math.min(maxIndex, Math.max(0, target));
      requested.current = target;
      spring.animateTo(target, v);
      if (target !== index) onSelect(target);
    },
  });

  const go = (i: number) => {
    const target = Math.min(maxIndex, Math.max(0, i));
    if (target !== index) onSelect(target);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'ArrowRight') go(index + 1);
    else return;
    e.preventDefault();
  };

  const pos = spring.value;
  const offset = width / 2 - cardW / 2 - pos * step;

  return (
    <div className="carousel">
      <div
        ref={ref}
        className={`carousel__viewport${dragging ? ' is-dragging' : ''}`}
        tabIndex={0}
        role="listbox"
        aria-label="Comptes bancaires"
        aria-activedescendant={items[index] ? `acct-${items[index].id}` : undefined}
        onKeyDown={onKeyDown}
        {...handlers}
      >
        <div className="carousel__track" style={{ transform: `translate3d(${offset}px,0,0)` }}>
          {items.map((item, i) => {
            const dist = Math.min(1, Math.abs(i - pos));
            const active = i === index;
            return (
              <div
                key={item.id}
                id={`acct-${item.id}`}
                role="option"
                aria-selected={active}
                className={`acct-card acct--${item.color}${active ? ' is-active' : ''}${item.archived ? ' is-archived' : ''}`}
                style={{
                  width: cardW,
                  left: i * step,
                  transform: `scale(${1 - dist * 0.07})`,
                  opacity: 1 - dist * 0.38,
                }}
                onClick={() => go(i)}
              >
                <div className="acct-card__glow" aria-hidden />
                <svg className="acct-card__waves" viewBox="0 0 340 200" preserveAspectRatio="none" aria-hidden>
                  <path d="M0 150 C 70 120, 130 185, 210 150 S 320 110, 340 130 L340 200 L0 200Z" />
                  <path d="M0 170 C 90 150, 150 200, 230 172 S 310 150, 340 160 L340 200 L0 200Z" />
                </svg>
                <div className="acct-card__top">
                  <span className="acct-card__chip">{item.kind === 'all' ? <LayersIcon /> : <WalletIcon />}</span>
                  <div className="acct-card__title">
                    <strong className="acct-card__name">
                      <span>{item.name}</span>
                      {/* Sur la carte active, l'étoile jaune suffit : le nom garde toute la place.
                          La pastille reste rendue pour passer en fondu d'une carte à l'autre. */}
                      {item.archived ? (
                        <span className="acct-card__primary acct-card__primary--off">De côté</span>
                      ) : item.primary ? (
                        <span className={`acct-card__primary${active ? ' is-hidden' : ''}`} aria-hidden={active}>
                          Principal
                        </span>
                      ) : null}
                    </strong>
                    <span>{item.subtitle}</span>
                  </div>
                  {item.kind === 'account' && (
                    // Boutons toujours rendus : ils apparaissent en fondu sur la carte active.
                    <div className={`acct-card__actions${active ? '' : ' is-hidden'}`} aria-hidden={!active}>
                      {/* Un compte mis de côté ne peut pas être le compte principal : pas d’étoile. */}
                      {!item.archived && (
                      <button
                        tabIndex={active ? 0 : -1}
                        className={`acct-card__edit acct-card__star${item.primary ? ' is-on' : ''}`}
                        aria-pressed={item.primary}
                        aria-label={item.primary ? `Retirer « ${item.name} » comme compte principal` : `Faire de « ${item.name} » le compte principal`}
                        title={item.primary ? 'Compte principal (affiché à l’ouverture)' : 'Définir comme compte principal'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePrimary(item.id);
                        }}
                      >
                        <StarIcon width={16} height={16} />
                      </button>
                      )}
                      <button
                        tabIndex={active ? 0 : -1}
                        className="acct-card__edit"
                        aria-label={`Modifier ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(item.id);
                        }}
                      >
                        <EditIcon width={16} height={16} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="acct-card__label">Solde actuel</div>
                <div className={`acct-card__balance${item.balance < 0 ? ' is-negative' : ''}`}>{money(item.balance)}</div>
                <div className="acct-card__foot">
                  <span className="pill pill--up">{signedMoney(item.monthIncome)}</span>
                  <span className="pill pill--down">{signedMoney(-item.monthExpense)}</span>
                  <span className="acct-card__period">ce mois-ci</span>
                </div>
              </div>
            );
          })}
          <button
            className="acct-card acct-card--add"
            style={{
              width: cardW,
              left: items.length * step,
              transform: `scale(${1 - Math.min(1, Math.abs(items.length - pos)) * 0.07})`,
            }}
            onClick={onAdd}
          >
            <span className="acct-card--add__icon"><PlusIcon width={26} height={26} /></span>
            <strong>Nouveau compte</strong>
            <span>Livret, compte joint, épargne…</span>
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="carousel__nav">
          <button className="icon-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Compte précédent">
            <ChevronLeft />
          </button>
          <div className="carousel__dots">
            {items.map((item, i) => (
              <button
                key={item.id}
                className={`dot acct--${item.color}${i === index ? ' is-active' : ''}`}
                onClick={() => go(i)}
                aria-label={item.name}
              />
            ))}
          </div>
          <button className="icon-btn" onClick={() => go(index + 1)} disabled={index === maxIndex} aria-label="Compte suivant">
            <ChevronRight />
          </button>
          <button className="carousel__reorder" onClick={onReorder} title="Changer l’ordre des comptes">
            <ReorderIcon width={15} height={15} /> Réorganiser
          </button>
        </div>
      )}
    </div>
  );
}
