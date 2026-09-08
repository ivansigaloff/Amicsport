const fs = require('fs');
const path = require('path');

const urls = {
  "satalia": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=800&auto=format&fit=crop",
  "iberia": "https://images.unsplash.com/photo-1543351611-58f69d7c1781?q=80&w=800&auto=format&fit=crop",
  "escuela_industrial": "https://images.unsplash.com/photo-1518605368461-1ee7c5320f73?q=80&w=800&auto=format&fit=crop",
  "agapito": "https://images.unsplash.com/photo-1587329310686-91414b8e3cb7?q=80&w=800&auto=format&fit=crop"
};

const dir = path.join(__dirname, '..', '..', 'assets', 'images', 'venues');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

async function download(name, url) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const dest = path.join(dir, name + '.jpg');
  fs.writeFileSync(dest, Buffer.from(buffer));
  console.log('Downloaded', dest);
}

async function run() {
  for (const [name, url] of Object.entries(urls)) {
    await download(name, url);
  }
}

run();
