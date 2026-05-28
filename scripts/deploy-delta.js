/**
 * deploy-delta.js
 *
 * Incremental FTP deploy: only uploads files whose MD5 changed since the
 * last run. A manifest (.deploy-manifest.json) is stored in dist/ and kept
 * out of git (.gitignore). On the first run it uploads everything, exactly
 * like the original deploy.js.
 *
 * Usage:
 *   node scripts/deploy-delta.js          # deploy only changed files
 *   node scripts/deploy-delta.js --full   # force full upload (like original)
 */

const FtpDeploy = require('ftp-deploy');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST_DIR      = path.join(__dirname, '../dist');
const MANIFEST_FILE = path.join(DIST_DIR, '.deploy-manifest.json');
const FORCE_FULL    = process.argv.includes('--full');

const FTP_CONFIG = {
  user:       'user-8594235',
  password:   'X6#x8XqnLw#vwae5',
  host:       '79.139.120.28',
  port:       21,
  localRoot:  DIST_DIR,
  remoteRoot: '/multigraf.info/Kickerzbcn/',
  include:    [],           // filled dynamically
  deleteRemote: false,      // we manage what to upload, never wipe
  forcePasv:  true,
  sftp:       false,
};

function md5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function walkDir(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walkDir(full, base) : [path.relative(base, full)];
  });
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); }
  catch { return {}; }
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DIST_DIR)) {
  console.error('❌  dist/ not found. Run `npx expo export -p web` first.');
  process.exit(1);
}

const allFiles   = walkDir(DIST_DIR).filter(f => f !== '.deploy-manifest.json');
const manifest   = FORCE_FULL ? {} : loadManifest();
const newManifest = {};
const toUpload   = [];

for (const rel of allFiles) {
  const abs  = path.join(DIST_DIR, rel);
  const hash = md5(abs);
  newManifest[rel] = hash;
  if (FORCE_FULL || manifest[rel] !== hash) {
    toUpload.push(rel.replace(/\\/g, '/'));   // FTP uses forward slashes
  }
}

if (toUpload.length === 0) {
  console.log('✅  Nothing to upload — all files are up to date.');
  process.exit(0);
}

console.log(`🚀  Deploying ${toUpload.length} changed file(s) (of ${allFiles.length} total)`);
console.log(`📡  Host: ${FTP_CONFIG.host}`);
console.log(`🎯  Destination: ${FTP_CONFIG.remoteRoot}\n`);

// ftp-deploy's include globs must match relative paths exactly.
// Passing the list as exact file patterns works because ftp-deploy uses
// micromatch and an exact path is a valid glob.
FTP_CONFIG.include = toUpload;

const ftpDeploy = new FtpDeploy();

ftpDeploy.on('uploading', d =>
  process.stdout.write(`📤 (${d.transferredFileCount}/${d.totalFilesCount}) ${d.filename}\r`)
);
ftpDeploy.on('uploaded', d =>
  console.log(`✅ (${d.transferredFileCount}/${d.totalFilesCount}) ${d.filename}`)
);
ftpDeploy.on('upload-error', d =>
  console.error(`❌ ${d.filename}:`, d.err)
);

ftpDeploy.deploy(FTP_CONFIG)
  .then(() => {
    saveManifest(newManifest);
    console.log('\n✨  Deployment finished successfully!');
    console.log('🔗  https://multigraf.info/Kickerzbcn/');
  })
  .catch(err => {
    console.error('\n💥  Deployment failed:', err);
    process.exit(1);
  });
