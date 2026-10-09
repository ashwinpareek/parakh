import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const [f0, f1, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const FPS = 30;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu-vsync'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('file:///tmp/claude-0/vid/stage/index.html'); await p.evaluate(() => window.ready);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = f0; f < f1; f++) {
  await p.evaluate((t) => render(t), f / FPS);
  const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if ((f - f0) % 300 === 0) console.log(out, f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
console.log('done', out, ((Date.now() - t0) / 1000).toFixed(0) + 's');
