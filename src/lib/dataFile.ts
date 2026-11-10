/**
 * Fichier de comptes sur le disque (API File System Access de Chrome et Edge) :
 * ouvrir un fichier .json, l'enregistrer au même endroit, et s'en souvenir d'une session à l'autre.
 * Le navigateur garde toujours sa copie (localStorage) : le fichier est un enregistrement en plus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeState } from './store';
import type { AppState } from './types';
import { plural } from './format';

/* ---------- API du navigateur (absente des types DOM de TypeScript) ---------- */

type AccessMode = { mode: 'read' | 'readwrite' };
interface DiskFileHandle extends FileSystemFileHandle {
  queryPermission?(descriptor: AccessMode): Promise<PermissionState>;
  requestPermission?(descriptor: AccessMode): Promise<PermissionState>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
declare global {
  interface Window {
    showOpenFilePicker?: (options?: { types?: PickerType[]; multiple?: boolean; id?: string }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: { types?: PickerType[]; suggestedName?: string; id?: string }) => Promise<FileSystemFileHandle>;
  }
}

const PICKER = {
  id: 'slice',
  types: [{ description: 'Comptes (Slice)', accept: { 'application/json': ['.json'] } }],
};
export const DEFAULT_FILE_NAME = 'slice.json';
/** Délai entre la dernière modification et l'enregistrement automatique. */
const AUTOSAVE_DELAY = 700;

export const canUseFiles = () =>
  typeof window !== 'undefined' &&
  typeof window.showOpenFilePicker === 'function' &&
  typeof window.showSaveFilePicker === 'function';

const errorName = (e: unknown) => (e instanceof DOMException || e instanceof Error ? e.name : '');

/** Fenêtre « Ouvrir » : null si l'utilisateur annule. */
async function pickFileToOpen() {
  try {
    const [handle] = await window.showOpenFilePicker!({ ...PICKER, multiple: false });
    return handle ?? null;
  } catch (e) {
    if (errorName(e) === 'AbortError') return null;
    throw e;
  }
}

/** Fenêtre « Enregistrer sous » : null si l'utilisateur annule. */
async function pickFileToSave(suggestedName: string) {
  try {
    return await window.showSaveFilePicker!({ ...PICKER, suggestedName });
  } catch (e) {
    if (errorName(e) === 'AbortError') return null;
    throw e;
  }
}

/** Droit d'écrire dans le fichier ; `ask` affiche la demande du navigateur (après un clic uniquement). */
async function hasAccess(handle: FileSystemFileHandle, ask: boolean) {
  const h = handle as DiskFileHandle;
  if (!h.queryPermission) return true;
  const mode: AccessMode = { mode: 'readwrite' };
  if ((await h.queryPermission(mode)) === 'granted') return true;
  return ask && !!h.requestPermission && (await h.requestPermission(mode)) === 'granted';
}

/** Écrit le texte et renvoie la date de modification du fichier obtenue. */
async function writeText(handle: FileSystemFileHandle, text: string) {
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
  return (await handle.getFile()).lastModified;
}

/* ---------- Contenu du fichier ---------- */

/** Même format que les anciennes sauvegardes exportées : les deux s'ouvrent indifféremment. */
export const serializeState = (state: AppState) => JSON.stringify(state, null, 2);

export function parseStateText(text: string): AppState | null {
  try {
    return sanitizeState(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    return null;
  }
}

type Data = Pick<AppState, 'accounts' | 'transactions' | 'recurrings' | 'period' | 'primaryId' | 'categories' | 'groups'>;

/** Empreinte des données (le thème n'en fait pas partie : il reste propre à ce navigateur). */
export function fingerprint({ accounts, transactions, recurrings, period, primaryId, categories, groups }: Data) {
  const text = JSON.stringify([accounts, transactions, recurrings, period, primaryId, categories, groups]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/* ---------- Mémoire du fichier ouvert (IndexedDB, seul stockage qui accepte un fichier) ---------- */

export interface FileLink {
  handle: FileSystemFileHandle;
  /** Date de modification du fichier lors de notre dernière lecture ou écriture. */
  savedAt: number;
  /** Empreinte des données à ce moment-là. */
  savedPrint: string;
  autoSave: boolean;
}

const DB_NAME = 'slice';
/** Base d'avant le changement de nom : on y récupère le fichier lié, une fois. */
const LEGACY_DB = 'mes-comptes';
const DB_STORE = 'fichier';
const DB_KEY = 'courant';
let dbPromise: Promise<IDBDatabase> | null = null;

function openNamed(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  dbPromise ??= openNamed(DB_NAME);
  return dbPromise;
}

/**
 * N'ouvre l'ancienne base que si elle existe déjà : l'ouvrir autrement en créerait
 * une vide pour rien.
 */
async function openLegacyDb(): Promise<IDBDatabase | null> {
  try {
    const bases = await indexedDB.databases?.();
    if (!bases?.some((b) => b.name === LEGACY_DB)) return null;
    return await openNamed(LEGACY_DB);
  } catch {
    return null;
  }
}

async function loadLink(): Promise<FileLink | null> {
  const link = await readLink(await openDb());
  if (link) return link;
  // Rien sous le nouveau nom : le fichier lié vient peut-être de l'ancienne base.
  const legacy = await openLegacyDb();
  if (!legacy) return null;
  const repris = await readLink(legacy).catch(() => null);
  legacy.close();
  if (repris) await storeLink(repris);
  return repris;
}

function readLink(db: IDBDatabase): Promise<FileLink | null> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(DB_KEY);
    req.onsuccess = () => {
      const v = req.result as Partial<FileLink> | undefined;
      resolve(
        v?.handle && typeof v.savedAt === 'number' && typeof v.savedPrint === 'string'
          ? { handle: v.handle, savedAt: v.savedAt, savedPrint: v.savedPrint, autoSave: v.autoSave !== false }
          : null,
      );
    };
    req.onerror = () => reject(req.error);
  });
}

async function storeLink(link: FileLink | null) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    if (link) store.put(link, DB_KEY);
    else store.delete(DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Hook ---------- */

export type FileStatus = 'saved' | 'dirty' | 'saving' | 'locked' | 'conflict' | 'missing' | 'error';

export interface FileQuestion {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  altLabel?: string;
  onAlt?: () => void;
}

interface Callbacks {
  /** Remplace les données de l'application par celles du fichier (`keepView` : rechargement en arrière-plan). */
  load: (state: AppState, message: string, keepView: boolean) => void;
  notify: (message: string) => void;
  ask: (question: FileQuestion) => void;
}

interface Outside {
  state: AppState | null;
  lastModified: number;
}

export function useDataFile(state: AppState, callbacks: Callbacks) {
  const supported = useMemo(canUseFiles, []);
  const [link, setLinkState] = useState<FileLink | null>(null);
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Dernier échec : fichier disparu (« missing ») ou autre erreur. */
  const [failed, setFailed] = useState<false | 'missing' | 'other'>(false);
  const [conflict, setConflict] = useState(false);

  const { accounts, transactions, recurrings, period, primaryId, categories, groups } = state;
  const print = useMemo(
    () => fingerprint({ accounts, transactions, recurrings, period, primaryId, categories, groups }),
    [accounts, transactions, recurrings, period, primaryId, categories, groups],
  );

  // Valeurs courantes pour les fonctions asynchrones (qui survivent à plusieurs rendus).
  const stateRef = useRef(state);
  const printRef = useRef(print);
  const linkRef = useRef(link);
  const busyRef = useRef(false);
  const cb = useRef(callbacks);
  stateRef.current = state;
  printRef.current = print;
  cb.current = callbacks;

  const setLink = useCallback((next: FileLink | null) => {
    linkRef.current = next;
    setLinkState(next);
    storeLink(next).catch(() => {});
  }, []);

  /** Le fichier a-t-il été modifié ailleurs depuis notre dernière lecture ou écriture ? */
  const changedOutside = useCallback(
    async (current: FileLink): Promise<Outside | null> => {
      const file = await current.handle.getFile();
      if (file.lastModified === current.savedAt) return null;
      const outside = parseStateText(await file.text());
      // Date changée mais contenu identique (synchronisation OneDrive…) : rien à signaler.
      if (outside && fingerprint(outside) === current.savedPrint) {
        if (linkRef.current?.handle === current.handle) setLink({ ...linkRef.current, savedAt: file.lastModified });
        return null;
      }
      return { state: outside, lastModified: file.lastModified };
    },
    [setLink],
  );

  /** Adopte la version du fichier. */
  const adopt = useCallback(
    (current: FileLink, outside: AppState, lastModified: number, message: string) => {
      cb.current.load(outside, message, true);
      setLink({ ...(linkRef.current ?? current), savedAt: lastModified, savedPrint: fingerprint(outside) });
      setConflict(false);
      setFailed(false);
    },
    [setLink],
  );

  const reportError = useCallback((handle: FileSystemFileHandle, e: unknown, action: string) => {
    const name = errorName(e);
    setFailed(name === 'NotFoundError' ? 'missing' : 'other');
    cb.current.notify(
      name === 'NotFoundError'
        ? `« ${handle.name} » est introuvable (déplacé ou supprimé) : utilisez Enregistrer sous…`
        : name === 'NotAllowedError' || name === 'SecurityError'
          ? `Accès à « ${handle.name} » refusé par le navigateur`
          : `Impossible ${action} « ${handle.name} »`,
    );
  }, []);

  // `write` et `askConflict` s'appellent l'un l'autre : on passe par une référence.
  const writeRef = useRef<(handle: FileSystemFileHandle, opts?: { force?: boolean; interactive?: boolean }) => Promise<boolean>>(
    async () => false,
  );

  const askConflict = useCallback(
    (current: FileLink, outside: Outside) => {
      const name = current.handle.name;
      const readable = outside.state;
      cb.current.ask({
        title: 'Le fichier a changé',
        message: readable
          ? `« ${name} » a été modifié en dehors de l’application depuis le dernier enregistrement (autre ordinateur, synchronisation…). Quelle version garder ?`
          : `« ${name} » ne contient plus de comptes lisibles. Le remplacer par les données affichées ?`,
        confirmLabel: 'Garder mes données',
        onConfirm: () =>
          void writeRef.current(current.handle, { force: true, interactive: true }).then(
            (ok) => ok && cb.current.notify(`Vos données ont remplacé celles de « ${name} »`),
          ),
        ...(readable && {
          altLabel: 'Charger le fichier',
          onAlt: () => {
            if (linkRef.current) adopt(linkRef.current, readable, outside.lastModified, `Version de « ${name} » chargée`);
          },
        }),
      });
    },
    [adopt],
  );

  /** Écrit les données dans `handle` (vérifie d'abord qu'on n'écrase pas une version plus récente). */
  const write = useCallback(
    async (handle: FileSystemFileHandle, { force = false, interactive = false } = {}) => {
      if (busyRef.current) return false;
      const current = linkRef.current;
      busyRef.current = true;
      setBusy(true);
      try {
        if (!force && current?.handle === handle) {
          const outside = await changedOutside(current);
          if (outside) {
            setConflict(true);
            if (interactive) askConflict(current, outside);
            return false;
          }
        }
        const snapshot = stateRef.current;
        const snapshotPrint = printRef.current;
        const savedAt = await writeText(handle, serializeState(snapshot));
        // Fichier fermé ou remplacé pendant l'écriture (démo, Ouvrir…) : on ne le rattache pas.
        if (linkRef.current?.handle !== current?.handle) return false;
        setLink({ handle, savedAt, savedPrint: snapshotPrint, autoSave: linkRef.current?.autoSave ?? true });
        setGranted(true);
        setConflict(false);
        setFailed(false);
        return true;
      } catch (e) {
        reportError(handle, e, 'd’enregistrer');
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [changedOutside, askConflict, setLink, reportError],
  );
  writeRef.current = write;

  /** Demande l'accès en écriture (doit suivre un clic). */
  const requestAccess = useCallback(async (handle: FileSystemFileHandle) => {
    try {
      const ok = await hasAccess(handle, true);
      setGranted(ok);
      if (!ok) cb.current.notify(`Accès à « ${handle.name} » refusé : les modifications restent dans ce navigateur`);
      return ok;
    } catch {
      cb.current.notify(`Le navigateur n’a pas pu autoriser « ${handle.name} » : réessayez`);
      return false;
    }
  }, []);

  /**
   * Recharge le fichier s'il a changé ailleurs et que rien n'est en attente ici.
   * Renvoie true si le fichier n'a pas bougé depuis notre dernier passage.
   */
  const sync = useCallback(async (interactive = false) => {
    const current = linkRef.current;
    if (!current || busyRef.current) return false;
    try {
      const outside = await changedOutside(current);
      if (linkRef.current?.handle !== current.handle) return false;
      if (!outside) return true;
      const dirty = printRef.current !== current.savedPrint;
      if (!dirty && outside.state) {
        adopt(current, outside.state, outside.lastModified, `« ${current.handle.name} » a changé ailleurs : données rechargées`);
      } else {
        setConflict(true);
        if (interactive) askConflict(current, outside);
      }
    } catch (e) {
      if (errorName(e) === 'NotFoundError') reportError(current.handle, e, 'de lire');
    }
    return false;
  }, [changedOutside, adopt, askConflict, reportError]);

  // Au démarrage : on retrouve le dernier fichier ouvert.
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    (async () => {
      const saved = await loadLink();
      if (!alive || !saved || linkRef.current) return;
      linkRef.current = saved;
      setLinkState(saved);
      if (await hasAccess(saved.handle, false)) {
        setGranted(true);
        void sync();
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [supported, sync]);

  const dirty = !!link && print !== link.savedPrint;

  // Enregistrement automatique, peu après la dernière modification.
  useEffect(() => {
    if (!link?.autoSave || !granted || !dirty || busy || conflict || failed) return;
    const t = window.setTimeout(() => void write(link.handle), AUTOSAVE_DELAY);
    return () => window.clearTimeout(t);
  }, [link, granted, dirty, busy, conflict, failed, print, write]);

  // Retour sur la page : le fichier a pu être modifié depuis un autre ordinateur.
  useEffect(() => {
    if (!link || !granted) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [link, granted, sync]);

  // Quitter avec des modifications absentes du fichier : le navigateur demande confirmation.
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  /* ---------- Actions ---------- */

  const saveAs = useCallback(async () => {
    let handle: FileSystemFileHandle | null;
    try {
      handle = await pickFileToSave(linkRef.current?.handle.name ?? DEFAULT_FILE_NAME);
    } catch {
      return cb.current.notify('Impossible d’ouvrir la fenêtre d’enregistrement');
    }
    if (!handle) return;
    if (await write(handle, { force: true })) cb.current.notify(`Comptes enregistrés dans « ${handle.name} »`);
  }, [write]);

  const save = useCallback(async () => {
    const current = linkRef.current;
    if (!current) return saveAs();
    if (!granted && !(await requestAccess(current.handle))) return;
    if (await write(current.handle, { interactive: true })) cb.current.notify(`Enregistré dans « ${current.handle.name} »`);
  }, [granted, saveAs, requestAccess, write]);

  const open = useCallback(async () => {
    let handle: FileSystemFileHandle | null;
    let opened: AppState | null;
    let lastModified: number;
    try {
      handle = await pickFileToOpen();
      if (!handle) return;
      const file = await handle.getFile();
      opened = parseStateText(await file.text());
      lastModified = file.lastModified;
    } catch {
      return cb.current.notify('Impossible de lire ce fichier');
    }
    if (!opened) return cb.current.notify(`« ${handle.name} » n’est pas un fichier Slice`);
    const file = handle;
    const data = opened;

    const apply = async () => {
      const autoSave = linkRef.current?.autoSave ?? true;
      cb.current.load(data, `« ${file.name} » ouvert`, false);
      setLink({ handle: file, savedAt: lastModified, savedPrint: fingerprint(data), autoSave });
      setConflict(false);
      setFailed(false);
      setGranted(false);
      // Ouvrir ne donne que la lecture : on demande tout de suite le droit d'enregistrer.
      setGranted(await hasAccess(file, true).catch(() => false));
    };

    const current = linkRef.current;
    const shown = stateRef.current;
    if (!shown.accounts.length || fingerprint(data) === printRef.current) return void apply();
    const unsaved = current && printRef.current !== current.savedPrint;
    const n = data.accounts.length;
    const m = data.transactions.length;
    cb.current.ask({
      title: `Ouvrir « ${file.name} » ?`,
      message:
        `Les données affichées seront remplacées par celles du fichier (${n} compte${plural(n)}, ${m} opération${plural(m)}).` +
        (unsaved
          ? ` Les modifications pas encore enregistrées dans « ${current.handle.name} » seront perdues.`
          : current
            ? ''
            : ' Elles ne sont enregistrées dans aucun fichier : utilisez d’abord « Enregistrer sous… » pour les garder.'),
      confirmLabel: 'Ouvrir',
      onConfirm: () => void apply(),
    });
  }, [setLink]);

  /** Oublie le fichier sans rien y écrire (démo, remise à zéro…). */
  const detach = useCallback(() => {
    setLink(null);
    setGranted(false);
    setConflict(false);
    setFailed(false);
  }, [setLink]);

  const close = useCallback(() => {
    const current = linkRef.current;
    if (!current) return;
    const name = current.handle.name;
    const done = () => {
      detach();
      cb.current.notify(`« ${name} » fermé · vos comptes restent dans ce navigateur`);
    };
    if (printRef.current === current.savedPrint) return done();
    cb.current.ask({
      title: 'Enregistrer avant de fermer ?',
      message: `Des modifications ne sont pas encore dans « ${name} ».`,
      confirmLabel: 'Enregistrer et fermer',
      onConfirm: () =>
        void (async () => {
          if (!granted && !(await requestAccess(current.handle))) return;
          if (await write(current.handle, { interactive: true })) done();
        })(),
      altLabel: 'Fermer sans enregistrer',
      onAlt: done,
    });
  }, [detach, granted, requestAccess, write]);

  /** Clic sur l'indicateur : reconnecte, résout un conflit ou enregistre. */
  const resume = useCallback(async () => {
    const current = linkRef.current;
    if (!current || failed === 'missing') return saveAs();
    if (!granted) {
      if (!(await requestAccess(current.handle))) return;
      setFailed(false);
      // Accès obtenu : on enregistre dans la foulée ce qui attendait.
      const pending = (await sync(true)) && printRef.current !== linkRef.current?.savedPrint;
      if (pending && (await write(current.handle, { interactive: true }))) {
        cb.current.notify(`Enregistré dans « ${current.handle.name} »`);
      }
      return;
    }
    setFailed(false);
    await save();
  }, [failed, granted, requestAccess, sync, write, save, saveAs]);

  const setAutoSave = useCallback(
    (autoSave: boolean) => {
      if (linkRef.current) setLink({ ...linkRef.current, autoSave });
    },
    [setLink],
  );

  // Priorités, de la plus forte à la plus faible.
  const statusOf = (): FileStatus | null => {
    if (!link) return null;
    if (busy) return 'saving';
    if (conflict) return 'conflict';
    if (failed === 'missing') return 'missing';
    if (failed) return 'error';
    if (!granted) return 'locked';
    return dirty ? 'dirty' : 'saved';
  };
  const status = statusOf();

  return {
    supported,
    name: link?.handle.name ?? null,
    status,
    savedAt: link?.savedAt ?? null,
    autoSave: link?.autoSave ?? true,
    open,
    save,
    saveAs,
    close,
    detach,
    resume,
    setAutoSave,
  };
}
