// Guards the stylesheet conventions so they survive future edits: colours come
// from _tokens.scss, widths from the breakpoint mixins, fonts from the font tokens.
import { describe, expect, test } from 'vitest';
import { compile } from 'sass-embedded';
import { resolve } from 'node:path';

const partials = import.meta.glob<string>('./_*.scss', { query: '?raw', import: 'default', eager: true });
const pages = Object.entries(partials).filter(([path]) => !/_(tokens|mixins)\.scss$/.test(path));

/** Each matching line as `file:line  text`, skipping comments and quoted strings (data URIs). */
function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const [path, source] of pages) {
    source.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\/|\/\/.*$/g, '').replace(/"[^"]*"|'[^']*'/g, '""');
      if (pattern.test(code)) hits.push(`${path.slice(2)}:${i + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe('stylesheets', () => {
  test('compile', () => {
    const css = compile(resolve(process.cwd(), 'src/styles/main.scss')).css;
    expect(css.length).toBeGreaterThan(10_000);
  });

  test('use colour tokens, never a raw hex', () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b(?!\s*\{)/)).toEqual([]);
  });

  test('use the breakpoint mixins, never a raw width', () => {
    expect(offenders(/@media[^{]*-width:\s*\d+px/)).toEqual([]);
  });

  test('use the type scale, never a raw font size', () => {
    // clamp() and calc() sizes are fluid on purpose; plain px sizes go through $fs-*.
    expect(offenders(/font-size:\s*[\d.]+px|font:\s*(?:\w+\s+)*[\d.]+px/)).toEqual([]);
  });

  test('use the font tokens', () => {
    expect(offenders(/Outfit|IBM Plex|Nunito|DM Mono/)).toEqual([]);
  });
});
