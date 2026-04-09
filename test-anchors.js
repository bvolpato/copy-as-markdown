import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

// ensure target directory exists
const outDir = path.join(process.cwd(), 'assets', 'screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function run() {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const urls = [
    { name: 'Amazon', url: 'https://www.amazon.com/dp/B08F7PTF53' },
    { name: 'ArXiv', url: 'https://arxiv.org/abs/1706.03762' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=what+is+markdown' },
    { name: 'GitHub', url: 'https://github.com/bvolpato/copy-as-markdown' },
    { name: 'Google', url: 'https://www.google.com/search?q=what+is+markdown' },
    { name: 'HackerNews', url: 'https://news.ycombinator.com/item?id=27814234' },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/in/brunovolpato/' },
    { name: 'News', url: 'https://www.cnn.com' },
    { name: 'Polymarket', url: 'https://polymarket.com' },
    { name: 'Reddit', url: 'https://www.reddit.com/r/learnprogramming/comments/4qzyj4' },
    { name: 'StackOverflow', url: 'https://stackoverflow.com/questions/11227809' },
    { name: 'Whatsapp', url: 'https://web.whatsapp.com' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Markdown' },
    { name: 'X-Twitter', url: 'https://x.com/elonmusk' },
    { name: 'YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { name: 'UnknownSite', url: 'https://example.com' }
  ];

  const scriptContent = fs.readFileSync('dist/userscript/copy-as-markdown.user.js', 'utf8');

  for (const site of urls) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setBypassCSP(true);
    
    console.log(`Navigating to ${site.name}...`);
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      console.log(`Injecting userscript on ${site.name}...`);
      await page.addScriptTag({ content: scriptContent });

      // wait for button
      await page.waitForSelector('#cam-copy-btn', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 1000)); // wait for layout/animations
      
      const file = path.join(outDir, `${site.name}.jpg`);
      await page.screenshot({ path: file, quality: 80, type: 'jpeg' });
      console.log(`Saved screenshot to ${file}`);
      
    } catch (e) {
      console.error(`Failed to process ${site.name}:`, e.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // Generate index.html
  console.log('Generating index.html...');
  const imgs = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg'));
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Anchor Screenshots</title>
  <style>
    body { font-family: sans-serif; background: #f4f4f5; padding: 20px; text-align: center; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
    .card { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .card img { width: 100%; height: auto; display: block; border-bottom: 2px solid #e4e4e7; }
    .card h3 { margin: 12px 0; font-size: 16px; color: #18181b; }
  </style>
</head>
<body>
  <h1>Anchor Render Testing</h1>
  <div class="gallery">
    ${imgs.map(img => `
      <div class="card">
        <a href="${img}" target="_blank">
          <img src="${img}" alt="${img}">
        </a>
        <h3>${path.parse(img).name}</h3>
      </div>
    `).join('')}
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'index.html'), html.trim());
  console.log('Done!');
}

run().catch(console.error);
