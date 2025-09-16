const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const CONFIG_PATH = path.resolve(__dirname, 'devuploader.config.json');
const DIST_DIR = path.resolve(__dirname, 'dist');

function readConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config.paths || [];
}

function ensureDistDir() {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR);
  }
}

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyFolderSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function downloadFile(url, dest, cb) {
  const proto = url.startsWith('https') ? https : http;
  proto.get(url, (res) => {
    if (res.statusCode !== 200) return cb(new Error('Failed to download: ' + url));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    res.pipe(file);
    file.on('finish', () => file.close(cb));
  }).on('error', cb);
}

function getDistPath(src) {
  if (src.startsWith('http')) {
    return path.join(DIST_DIR, encodeURIComponent(src));
  }
  return path.join(DIST_DIR, path.relative(process.cwd(), src));
}

function gitAddCommitPush(files) {
  try {
    execSync('git add .', { cwd: DIST_DIR });
    const msg = 'Auto-commit: ' + new Date().toISOString();
    execSync(`git commit -m "${msg}"`, { cwd: DIST_DIR });
    execSync('git push', { cwd: DIST_DIR });
  } catch (e) {
    // ignore if nothing to commit
  }
}

function printRawLinks(files) {
  // User should configure this for their repo
  const base = 'https://raw.githubusercontent.com/SalvatorePreviti/git-dev-uploader/main/dist/';
  files.forEach(f => {
    const rel = path.relative(DIST_DIR, f);
    console.log(base + rel.replace(/\\/g, '/'));
  });
}

function watchLocal(paths) {
  const chokidar = require('chokidar');
  let changed = new Set();
  let timer = null;
  const watcher = chokidar.watch(paths.filter(p => !p.startsWith('http')));
  watcher.on('all', (event, filePath) => {
    changed.add(filePath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      ensureDistDir();
      const copied = [];
      for (const p of changed) {
        const src = path.resolve(p);
        const dest = getDistPath(src);
        if (fs.lstatSync(src).isDirectory()) {
          copyFolderSync(src, dest);
        } else {
          copyFileSync(src, dest);
        }
        copied.push(dest);
      }
      gitAddCommitPush(copied);
      printRawLinks(copied);
      changed.clear();
    }, 3000);
  });
}

function pollRemote(urls) {
  const hashes = {};
  setInterval(() => {
    urls.forEach(url => {
      const dest = getDistPath(url);
      downloadFile(url, dest, (err) => {
        if (err) return;
        const content = fs.readFileSync(dest);
        const hash = require('crypto').createHash('sha1').update(content).digest('hex');
        if (hashes[url] !== hash) {
          hashes[url] = hash;
          ensureDistDir();
          gitAddCommitPush([dest]);
          printRawLinks([dest]);
        }
      });
    });
  }, 5000);
}

function main() {
  const paths = readConfig();
  ensureDistDir();
  const local = paths.filter(p => !p.startsWith('http'));
  const remote = paths.filter(p => p.startsWith('http'));
  if (local.length) watchLocal(local);
  if (remote.length) pollRemote(remote);
}

main();
