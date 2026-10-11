// Em dashes read as machine-written, so the app's own wording uses commas, colons and full stops.
// Comments may still use them; strings may not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

test('no em dashes in user-facing strings', () => {
  const offenders = sources(join(__dirname, '..')).flatMap(path => readFileSync(path, 'utf8').split(/\r?\n/)
    .map((line, i) => ({ line: line.replace(/\/\/.*$/, '').trim(), at: `${path}:${i + 1}` }))
    .filter(({ line }) => line.includes('—') && !/^(\*|\/\*)/.test(line))
    .map(({ at }) => at));
  expect(offenders).toEqual([]);
});
