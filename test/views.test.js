// Structural checks on the .html files the web app serves.
//
// These exist because of a failure I caused twice in one day: appending code to
// Index.html and to AnalysisView.html placed it AFTER the closing </script>, so the
// browser parsed JavaScript as markup and the entire app died at load with
// "Unexpected token '<'". Both times it was caught only because I happened to open
// the preview — the .gs files are syntax-checked by the other suites, the .html
// files were not checked by anything.
//
// Run: node test/views.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AS = path.join(__dirname, '..', 'appsscript');
const FILES = fs.readdirSync(AS).filter(f => f.endsWith('.html'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

console.log('View files: ' + FILES.join(', '));

// Apps Script templating is not JavaScript and lives outside the script blocks.
const stripTemplating = s => s.replace(/<\?[!=]?[\s\S]*?\?>/g, '');

for (const file of FILES) {
  const raw = fs.readFileSync(path.join(AS, file), 'utf8');
  const src = stripTemplating(raw);

  // ---- tags balance -------------------------------------------------------
  const opens = (src.match(/<script\b/g) || []).length;
  const closes = (src.match(/<\/script>/g) || []).length;
  ok(`${file}: every <script> is closed`, opens === closes,
     `${opens} open, ${closes} close`);

  const sOpen = (src.match(/<style\b/g) || []).length;
  const sClose = (src.match(/<\/style>/g) || []).length;
  ok(`${file}: every <style> is closed`, sOpen === sClose, `${sOpen} open, ${sClose} close`);

  // ---- every script block is valid JavaScript ----------------------------
  const blocks = [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((code, i) => {
    let err = null;
    try { new vm.Script(code); } catch (e) { err = e.message; }
    ok(`${file}: script block ${i + 1} parses`, err === null, err);
  });

  // ---- nothing that looks like JavaScript sits outside a block ------------
  // This is the exact shape of the bug: code appended past </script>.
  const outside = src
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const stray = outside.split('\n')
    .map((l, i) => ({ line: i + 1, text: l.trim() }))
    .filter(x => /^(function\s+\w+\s*\(|var\s+\w+\s*=|return\s|\}\s*;?$)/.test(x.text));
  ok(`${file}: no JavaScript outside a script block`, stray.length === 0,
     stray.slice(0, 3).map(x => `line ~${x.line}: ${x.text.slice(0, 60)}`).join(' | '));

  // ---- document files must close their body AFTER the last script --------
  if (/<\/body>/.test(src)) {
    const lastScript = src.lastIndexOf('</script>');
    const body = src.indexOf('</body>');
    ok(`${file}: </body> comes after the last </script>`, body > lastScript,
       `</script> at ${lastScript}, </body> at ${body}`);
  }
}

// ---- the api* surface the views call must exist on the server ------------
{
  const server = fs.readdirSync(AS).filter(f => f.endsWith('.gs'))
    .map(f => fs.readFileSync(path.join(AS, f), 'utf8')).join('\n');
  const called = new Set();
  for (const file of FILES) {
    const s = fs.readFileSync(path.join(AS, file), 'utf8');
    for (const m of s.matchAll(/api\(\s*'(\w+)'/g)) called.add(m[1]);
  }
  const missing = [...called].filter(fn => !new RegExp('function\\s+' + fn + '\\s*\\(').test(server));
  ok(`every api() the views call is defined server-side (${called.size} checked)`,
     missing.length === 0, missing.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
