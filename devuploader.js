const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const CONFIG_PATH = path.resolve(__dirname, 'devuploader.config.json');
const DIST_DIR = path.resolve(__dirname, 'docs');

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

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        let options = {};
        if (url.startsWith('https')) {
            // Allow self-signed certs for localhost or if explicitly requested
            if (url.includes('localhost') || url.includes('127.0.0.1')) {
                options.rejectUnauthorized = false;
            }
        }
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, options, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Failed to download: ${url} (status ${res.statusCode})`));
            }
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        });
        req.on('error', reject);
    });
}

function getDistPath(src) {
    if (src.startsWith('http')) {
        // Use only the filename from the URL, not urlencoded
        const urlObj = new URL(src);
        const pathname = urlObj.pathname;
        const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        return path.join(DIST_DIR, filename);
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
    //const base = 'https://salvatorepreviti.github.io/git-dev-uploader/docs/';
    const base = 'https://raw.githubusercontent.com/SalvatorePreviti/git-dev-uploader/main/upload/';
    console.log('uploaded:')
    files.forEach(f => {
        const rel = path.relative(DIST_DIR, f);
        console.log(' ', base + rel.replace(/\\/g, '/'));
    });
    console.log('\n')
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
        urls.forEach(async url => {
            const dest = getDistPath(url);
            try {
                await downloadFile(url, dest);
                const content = fs.readFileSync(dest);
                const hash = require('crypto').createHash('sha1').update(content).digest('hex');
                if (hashes[url] !== hash) {
                    hashes[url] = hash;
                    ensureDistDir();
                    gitAddCommitPush([dest]);
                    printRawLinks([dest]);
                }
            } catch (err) {
                console.error(`Failed to download ${url}: ${err.message}`);
            }
        });
    }, 5000);
}



async function initialCopy(paths) {
    ensureDistDir();
    const copied = [];
    const local = paths.filter(p => !p.startsWith('http'));
    for (const p of local) {
        const src = path.resolve(p);
        const dest = getDistPath(src);
        if (fs.existsSync(src)) {
            if (fs.lstatSync(src).isDirectory()) {
                copyFolderSync(src, dest);
            } else {
                copyFileSync(src, dest);
            }
            copied.push(dest);
        }
    }
    // For remote files, download and wait for all to finish
    const remote = paths.filter(p => p.startsWith('http'));
    for (const url of remote) {
        const dest = getDistPath(url);
        try {
            await downloadFile(url, dest);
            copied.push(dest);
        } catch (e) {
            console.error(`Failed to download ${url}: ${e.message}`);
        }
    }
    return copied;
}

async function initialCommit() {
    // Add and commit all files in dist if any
    if (fs.existsSync(DIST_DIR)) {
        const files = [];
        function walk(dir) {
            for (const entry of fs.readdirSync(dir)) {
                const full = path.join(dir, entry);
                if (fs.lstatSync(full).isDirectory()) {
                    walk(full);
                } else {
                    files.push(full);
                }
            }
        }
        walk(DIST_DIR);
        if (files.length) {
            gitAddCommitPush(files);
            printRawLinks(files);
        }
    }
}


async function main() {
    const paths = readConfig();
    ensureDistDir();
    const copied = await initialCopy(paths);
    if (copied.length) {
        gitAddCommitPush(copied);
        // Do not print links here; will be printed after initial commit
    }
    await initialCommit();
    const local = paths.filter(p => !p.startsWith('http'));
    const remote = paths.filter(p => p.startsWith('http'));
    if (local.length) watchLocal(local);
    if (remote.length) pollRemote(remote);
}

main();
