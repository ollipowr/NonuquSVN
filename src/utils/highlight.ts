import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bash);

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  css: 'css',
  json: 'json',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  csproj: 'xml',
  config: 'xml',
  sh: 'bash',
  bash: 'bash',
};

export function languageForPath(path: string | null): string | null {
  if (!path) return null;
  const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Returns HTML for one line. Lines are highlighted independently, so multi-line constructs only colour partially. */
export function highlightLine(line: string, lang: string | null): string {
  if (!lang || !line) return escapeHtml(line);
  try {
    return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(line);
  }
}
