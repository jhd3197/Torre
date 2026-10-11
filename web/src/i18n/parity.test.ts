// Every Spanish namespace must carry exactly the English keys: a key only in en shows English to
// Spanish readers, and a key only in es is a leftover from something that was renamed or removed.
const files = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json', { eager: true });

function byLanguage(lang: string): Map<string, Record<string, unknown>> {
  const namespaces = new Map<string, Record<string, unknown>>();
  for (const [path, module] of Object.entries(files)) {
    const [, fileLang, ns] = path.match(/\.\/locales\/(\w+)\/([\w-]+)\.json$/) ?? [];
    if (fileLang === lang && ns) namespaces.set(ns, module.default);
  }
  return namespaces;
}

/** Dotted paths to every leaf; arrays count as one leaf (their length may differ by language). */
function keys(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) keys(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.push(prefix);
  }
  return out;
}

const en = byLanguage('en');
const es = byLanguage('es');

test('en and es have the same namespaces', () => {
  expect([...es.keys()].sort()).toEqual([...en.keys()].sort());
});

describe.each([...en.keys()].sort())('the %s namespace', ns => {
  test('has the same keys in en and es', () => {
    const english = new Set(keys(en.get(ns)));
    const spanish = new Set(keys(es.get(ns) ?? {}));
    expect({
      missingInEs: [...english].filter(key => !spanish.has(key)),
      onlyInEs: [...spanish].filter(key => !english.has(key)),
    }).toEqual({ missingInEs: [], onlyInEs: [] });
  });
});
