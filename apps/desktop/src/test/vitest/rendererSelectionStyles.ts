import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

// Load production CSS as a behavioral fixture, not a source-text assertion.
// jsdom cannot parse Tailwind/layer syntax. Keep the actual selection rules in
// their original order and specificity, without copying their selector lists.
const source = postcss.parse(readFileSync(resolve(__dirname, '../../renderer/styles/globals.css'), 'utf8'));
const selectionStyles = postcss.root();
source.walkRules(rule => {
  const declarations = (rule.nodes ?? []).filter(node => node.type === 'decl' &&
    (node.prop === 'user-select' || node.prop === '-webkit-user-select'));
  if (declarations.length) selectionStyles.append(rule.clone({ nodes: declarations.map(node => node.clone()) }));
});
if (!selectionStyles.nodes.length) throw new Error('Production renderer selection styles were not loaded');
const css = selectionStyles.toString();

export function installRendererSelectionStyles(doc: Document = document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.dataset.copyTest = '';
  style.textContent = css;
  doc.head.appendChild(style);
  return style;
}
