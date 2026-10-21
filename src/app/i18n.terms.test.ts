import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses Arbeitskopie instead of Workspace/Arbeitsbereich in German UI text', () => {
  const src = readFileSync('src/app/i18n.ts', 'utf8');
  const de = src.slice(0, src.indexOf("settings: 'Settings'"));
  // Only quoted values: dictionary keys like noWorkspace may keep the word.
  expect(de).not.toMatch(/'[^'\n]*(Workspace|Arbeitsbereich)/);
  const start = readFileSync('src/modules/home/StartPage.tsx', 'utf8');
  expect(start).not.toMatch(/Arbeitsbereich/);
});
