// Python alignment worker files are bundled into main.js at build time (esbuild text loader),
// because Obsidian's installer and BRAT only download main.js, manifest.json and styles.css.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const FILES = {
  'align.py': require('../align.py'),
  'align.py.lock': require('../align.py.lock'),
  'alignment_utils.py': require('../alignment_utils.py'),
};
function ensureWorker() {
  const hash = crypto.createHash('sha256');
  for (const [name, text] of Object.entries(FILES)) hash.update(name + '\0' + text + '\0');
  const dir = path.join(os.homedir(), '.cache', 'obsidian-sing-along', 'worker', hash.digest('hex').slice(0, 16));
  const script = path.join(dir, 'align.py');
  if (!fs.existsSync(script)) {
    const tmp = dir + '.tmp-' + process.pid;
    fs.mkdirSync(tmp, {recursive: true});
    for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(tmp, name), text, 'utf8');
    try { fs.renameSync(tmp, dir); } catch (e) { fs.rmSync(tmp, {recursive: true, force: true}); if (!fs.existsSync(script)) throw e; }
  }
  return script;
}
module.exports = {ensureWorker};
