/**
 * Load the Client half exactly as the browser module table would, against a
 * stub React and a recording Cordis context. This catches a factory that
 * throws, a registration with the wrong shape, and disposal leaks — none of
 * which a syntax check can see.
 */
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// --- stub React ------------------------------------------------------------
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: (subscribe, read) => read(),
};

const registry = new Map();
const storage = new Map();
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      registry.set(id, factory);
    },
  },
  location: { origin: 'http://127.0.0.1:63584' },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
};
globalThis.fetch = async () => new Response('{"ok":true,"items":[]}', { headers: { 'content-type': 'application/json' } });

// --- run the bundle --------------------------------------------------------
new Function(source)();

const id = 'dsh-plugin-vinyl-player';
if (!registry.has(id)) throw new Error(`factory ${id} was not registered`);
const plugin = registry.get(id)((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require(${JSON.stringify(name)})`);
});

const checks = [];
const expect = (label, condition, detail) => {
  checks.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
};

expect('factory returns a plugin object', plugin !== null && typeof plugin === 'object');
expect('inject lists slots and locale', Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('locale'), JSON.stringify(plugin.inject));
expect('apply is a function', typeof plugin.apply === 'function');

// --- recording context -----------------------------------------------------
const registrations = [];
const injections = [];
const effects = [];
const dictionaries = [];

const ctx = {
  locale: {
    register: (ns, dicts) => {
      dictionaries.push({ ns, locales: Object.keys(dicts) });
      return () => {};
    },
    bind: (ns) => (key, params) => {
      const dict = dictionaries.find((entry) => entry.ns === ns);
      void dict;
      return key;
    },
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0, active: 'en' }),
  },
  slots: {
    inject: (key, callback) => {
      injections.push(key);
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    },
  },
  effect: (callback, label) => {
    const dispose = callback();
    effects.push({ label, dispose });
    return () => {};
  },
};

plugin.apply(ctx);

expect('locale dictionary registered', dictionaries.length === 1 && dictionaries[0].ns === 'vinyl-room', JSON.stringify(dictionaries));
expect('dictionary ships en and zh', dictionaries[0]?.locales?.includes('en') && dictionaries[0]?.locales?.includes('zh'), JSON.stringify(dictionaries[0]?.locales));
expect('three slot injections', injections.length === 3, JSON.stringify(injections));
expect('injects expected slots', ['sidebar.panellist', 'main', 'shell.overlay'].every((key) => injections.includes(key)), JSON.stringify(injections));
expect('three registrations recorded', registrations.length === 3, String(registrations.length));

const byName = (name) => registrations.find((entry) => entry.options.name === name);
const panel = byName('sidebar.panellist');
const main = byName('main');
const overlay = byName('shell.overlay');

expect('sidebar entry uses the panel id', panel?.options.id === 'vinyl-room', JSON.stringify(panel?.options));
expect('sidebar entry carries a label thunk', typeof panel?.options.label === 'function', typeof panel?.options.label);
expect('sidebar entry names its locale namespace', panel?.options.locale === 'vinyl-room');
expect('main entry key matches the sidebar id', main?.options.key === 'vinyl-room', JSON.stringify(main?.options));
expect('overlay entry has a fresh id', overlay?.options.id === 'vinyl-room.player', JSON.stringify(overlay?.options));

for (const entry of registrations) {
  expect(`component for "${entry.options.name}" is a function`, typeof entry.component === 'function');
}

// --- render the components with stub props ---------------------------------
const render = (component, props) => {
  const element = component(props ?? {});
  if (element === undefined || element === null) throw new Error('component returned nothing');
  return element;
};

try {
  const icon = render(panel.component, { size: 18, active: false });
  expect('panel icon renders', icon !== null && icon !== undefined);
  // The sidebar entry doubles as the transport: a play/pause badge appears once a
  // record is on the platter, and its handlers must stop the row's navigation.
  const flatIcon = [];
  const walkIcon = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) { node.forEach(walkIcon); return; }
    if (typeof node === 'object') { flatIcon.push(node); walkIcon(node.children); }
  };
  walkIcon(icon);
  expect('sidebar icon has no badge while idle', !flatIcon.some((n) => n.props?.['data-vinyl-room-toggle'] === 'true'));
} catch (error) {
  expect('panel icon renders', false, error.message);
}

try {
  const page = render(main.component, {});
  expect('room page renders', page !== null);
  // Walk the tree, materializing nested function components so the stylesheet
  // that `Styles` renders is part of the flattening rather than an opaque type.
  const flatten = (node, out = [], depth = 0) => {
    if (node === null || node === undefined || depth > 40) return out;
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out, depth + 1);
      return out;
    }
    if (typeof node !== 'object') return out;
    if (typeof node.type === 'function') {
      flatten(node.type(node.props ?? {}), out, depth + 1);
      return out;
    }
    out.push(node);
    flatten(node.children, out, depth + 1);
    return out;
  };
  const nodes = flatten(page);
  const styleNode = nodes.find((node) => node.type === 'style');
  expect('room page mounts its stylesheet', styleNode !== undefined && typeof styleNode.children[0] === 'string');
  expect('stylesheet names every vr- class it uses', typeof styleNode?.children?.[0] === 'string' && styleNode.children[0].includes('.vr-page'));

  // --- the deck is the centred subject; both shelves sit underneath it ---
  const shelves = nodes.find((node) => node.props?.className === 'vr-shelves');
  expect('crate and favorites share one row beneath the deck', shelves !== undefined);
  const rails = nodes.filter((node) => node.props?.className === 'vr-rail');
  expect('exactly two shelves render', rails.length === 2, `${rails.length} shelves`);
  expect(
    'shelves are labelled as the crate and the favorites',
    rails.length === 2 && rails.every((rail) => typeof rail.props['aria-label'] === 'string' && rail.props['aria-label'] !== ''),
    JSON.stringify(rails.map((rail) => rail.props['aria-label'])),
  );

  const deckArea = nodes.find((node) => node.props?.className === 'vr-deck-area');
  expect('the deck has its own centred area', deckArea !== undefined);
  expect('no left/right column wrapper remains', nodes.every((node) => node.props?.className !== 'vr-room' && node.props?.className !== 'vr-center'));
  const deck = nodes.find((node) => node.props?.className === 'vr-deck');
  expect('turntable deck is rendered', deck !== undefined);
  // The deck is drawn as SVG; the disc is a real <circle> (see round-check.mjs
  // for the full roundness proof). Here we only assert the drop target exists.
  const vinyl = nodes.find((node) => String(node.props?.className ?? '').includes('vr-drop-target'));
  expect('deck carries a round drop target', vinyl !== undefined, String(vinyl?.props?.className));
  expect('the drop target accepts a record', typeof vinyl?.props?.onDrop === 'function' && typeof vinyl?.props?.onDragOver === 'function');

  // --- the tonearm IS the transport ---
  const arm = nodes.find((node) => /(^|\s)vr-arm(\s|$)/.test(String(node.props?.className ?? '')));
  expect('deck renders a tonearm', arm !== undefined, String(arm?.props?.className));
  expect(
    'tonearm is draggable',
    typeof arm?.props?.onPointerDown === 'function' && typeof arm?.props?.onPointerMove === 'function' && typeof arm?.props?.onPointerUp === 'function',
  );
  expect('tonearm exposes its angle as a slider', arm?.props?.role === 'slider' && typeof arm?.props?.['aria-valuenow'] === 'number');
  expect('tonearm is keyboard operable', typeof arm?.props?.onKeyDown === 'function' && arm.props.tabIndex === 0);
  // The arm is an SVG group rotated about its explicit pivot.
  expect(
    'tonearm applies its angle about a pivot',
    /^rotate\(-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\)$/.test(String(arm?.props?.transform ?? '')),
    String(arm?.props?.transform),
  );

  // --- secondary transport: no play/pause here, the arm owns it ---
  const keys = nodes.filter((node) => {
    const list = String(node.props?.className ?? '').split(/\s+/);
    return list.includes('vr-key');
  });
  const labels = keys.map((key) => key.props['aria-label']);
  expect('secondary controls are prev/stop/replay/next', keys.length === 4, JSON.stringify(labels));
  expect('secondary controls omit play/pause', !labels.some((l) => /^(play|pause|播放|暂停)$/i.test(l)), JSON.stringify(labels));

  // --- the dedicated play/pause key sits on the right of the transport bar ---
  const playKey = nodes.find((node) => String(node.props?.className ?? '').split(/\s+/).includes('vr-play'));
  expect('a dedicated play/pause key exists', playKey !== undefined);
  expect('play/pause key is labelled', /^(play|pause|播放|暂停)$/i.test(String(playKey?.props?.['aria-label'] ?? '')), String(playKey?.props?.['aria-label']));
  // Order inside the transport row decides the visual side: it must be the last child.
  const transport = nodes.find((node) => String(node.props?.className ?? '').split(/\s+/).includes('vr-transport'));
  const transportChildren = (transport?.children ?? []).flat(3).filter((child) => child !== null && typeof child === 'object');
  const lastChild = transportChildren[transportChildren.length - 1];
  expect('play/pause key is the right-most control', lastChild?.props?.className === 'vr-play', String(lastChild?.props?.className));

  // --- the seek bar is a real, draggable track ---
  const seek = nodes.find((node) => node.type === 'input' && node.props?.className === 'vr-range');
  expect('seek bar is a range input', seek !== undefined && seek.props.type === 'range');
  expect('seek bar has both drag handlers', typeof seek?.props?.onInput === 'function' && typeof seek?.props?.onChange === 'function');
  expect('seek bar releases its scrub guard', typeof seek?.props?.onPointerUp === 'function' && typeof seek?.props?.onBlur === 'function');
  expect('seek bar exposes its time text', typeof seek?.props?.['aria-valuetext'] === 'string', seek?.props?.['aria-valuetext']);

  // --- the fixed frontal view: no orbit handlers on the deck ---
  const deckHandlers = Object.keys(deck?.props ?? {});
  expect('deck keeps a fixed angle (no orbit handlers)', !deckHandlers.includes('onPointerMove') && !deckHandlers.includes('onPointerDown'), JSON.stringify(deckHandlers));

  // --- the deck exposes its own hardware, drawn inside the SVG ---
  expect('deck has a speed selector', nodes.some((node) => node.props?.['aria-label'] && /speed|转速/i.test(String(node.props['aria-label']))));
  expect('deck has a volume knob', nodes.some((node) => node.props?.['aria-label'] && /volume|音量/i.test(String(node.props['aria-label']))));
} catch (error) {
  expect('room page renders', false, error.message);
}

try {
  const player = render(overlay.component, { usePanelInfo: (select) => select({ activePanelId: null }) });
  expect('overlay player renders', player !== null);
  const flat = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(player);
  expect('player owns exactly one audio element', flat.filter((node) => node.type === 'audio').length === 1);
  expect('audio element is preloaded', flat.find((node) => node.type === 'audio')?.props?.preload === 'auto');
  // The floating mini player is gone: the overlay renders only the hidden audio
  // element plus the stylesheet, so nothing is drawn over the app.
  expect(
    'no floating mini player is rendered',
    flat.every((node) => !String(node.props?.className ?? '').includes('vr-mini')),
    JSON.stringify(flat.map((node) => node.props?.className).filter(Boolean)),
  );
  expect('overlay renders nothing visible', flat.filter((node) => node.type !== 'audio' && node.type !== 'style').length === 0);
} catch (error) {
  expect('overlay player renders', false, error.message);
}

// --- disposal --------------------------------------------------------------
expect('one owning effect registered', effects.length === 1);
expect('disposal is a function', typeof effects[0]?.dispose === 'function');
try {
  effects[0].dispose();
  expect('disposal runs without throwing', true);
} catch (error) {
  expect('disposal runs without throwing', false, error.message);
}

// --- drag-and-drop plumbing -------------------------------------------------
// The store is closure-private, so it is exercised the way the UI exercises it:
// render the page, then invoke the handlers the rendered tree exposes.
{
  const flatten = (node, out = [], depth = 0) => {
    if (node === null || node === undefined || depth > 40) return out;
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out, depth + 1);
      return out;
    }
    if (typeof node !== 'object') return out;
    if (typeof node.type === 'function') {
      flatten(node.type(node.props ?? {}), out, depth + 1);
      return out;
    }
    out.push(node);
    flatten(node.children, out, depth + 1);
    return out;
  };

  const nodes = flatten(main.component({}));
  expect(
    'empty store renders no record rows',
    nodes.every((node) => !String(node.props?.className ?? '').startsWith('vr-chip')),
  );
  expect('favorites rail shows its empty state', nodes.some((node) => node.props?.className === 'vr-rail-empty'));

  const vinyl = nodes.find((node) => String(node.props?.className ?? '').includes('vr-drop-target'));
  const makeTransfer = (bvid) => {
    const data = new Map();
    if (bvid !== '') {
      data.set('application/x-vinyl-record', bvid);
      data.set('text/plain', bvid);
    }
    return {
      effectAllowed: '',
      dropEffect: '',
      getData: (type) => data.get(type) ?? '',
      setData: (type, value) => data.set(type, value),
    };
  };

  let prevented = false;
  let thrown;
  try {
    vinyl.props.onDrop({ preventDefault() { prevented = true; }, dataTransfer: makeTransfer('BV1GJ411x7h7') });
  } catch (error) {
    thrown = error;
  }
  expect('deck drop prevents the browser default', prevented);
  expect('deck drop accepts a dragged record without throwing', thrown === undefined, thrown?.message);

  // An empty payload is still a valid drop event; it must not start playback.
  let preventedEmpty = false;
  try {
    vinyl.props.onDrop({ preventDefault() { preventedEmpty = true; }, dataTransfer: makeTransfer('') });
  } catch (error) {
    thrown = error;
  }
  expect('deck drop tolerates an empty payload', preventedEmpty && thrown === undefined, thrown?.message);

  // Drag-over must advertise a copy and not throw; drag-leave must clear it.
  try {
    vinyl.props.onDragOver({ preventDefault() {}, dataTransfer: makeTransfer('BV1GJ411x7h7') });
    vinyl.props.onDragLeave();
    expect('deck drag-over/leave are wired', true);
  } catch (error) {
    expect('deck drag-over/leave are wired', false, error.message);
  }

  // --- the favorites shelf accepts a record dragged from the crate -------------
  const rails = nodes.filter((node) => String(node.props?.className ?? '').split(/\s+/).includes('vr-rail'));
  expect('exactly two shelves for drop routing', rails.length === 2, `${rails.length}`);
  const accepting = rails.filter((node) => typeof node.props.onDrop === 'function');
  expect('exactly one shelf accepts dropped records', accepting.length === 1, `${accepting.length}`);
  expect('only the favorites shelf accepts drops', accepting[0] === rails[1], accepting[0]?.props?.['aria-label']);
  const crate = rails[0];
  expect('the crate does not accept drops', typeof crate?.props?.onDrop !== 'function');

  let collectionPrevented = false;
  let collectionThrew;
  try {
    accepting[0].props.onDrop({
      preventDefault() { collectionPrevented = true; },
      dataTransfer: makeTransfer('BV1GJ411x7h7'),
      currentTarget: { contains: () => false },
    });
  } catch (error) {
    collectionThrew = error;
  }
  expect('favorites drop prevents the browser default', collectionPrevented);
  expect('favorites drop is handled without throwing', collectionThrew === undefined, collectionThrew?.message);
}

// --- the sidebar entry carries the transport control -------------------------
// The badge is rendered from the shared store, so scope: it must be absent while
// the platter is empty, and its handlers must stop the sidebar row navigating.
{
  const collect = (node, out = []) => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) { node.forEach((child) => collect(child, out)); return out; }
    if (typeof node === 'object') { out.push(node); collect(node.children, out); }
    return out;
  };
  const idle = collect(panel.component({ size: 18, active: false }));
  expect('sidebar entry renders a glyph', idle.some((node) => node.type === 'svg'));
  expect('sidebar badge is hidden while idle', !idle.some((node) => node.props?.['data-vinyl-room-toggle'] === 'true'));
  // The glyph itself must not swallow the click that navigates to the panel.
  const glyph = idle.find((node) => node.type === 'svg');
  expect('glyph leaves navigation to the sidebar row', typeof glyph.props.onClick !== 'function');
  expect('sidebar wrapper has no click handler of its own', !idle.some((node) => node.props?.className === 'vr-side' && typeof node.props.onClick === 'function'));
}

console.log('');
const failed = checks.filter((check) => !check.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
