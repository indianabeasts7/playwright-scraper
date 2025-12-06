
// index.js
'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cron = require('node-cron');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Make sure data folder exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Basic concurrency guard so we don't spawn too many browsers at once
const MAX_CONCURRENT_BROWSERS = Number(process.env.MAX_CONCURRENT_BROWSERS) || 2;
let activeBrowsers = 0;

// Helpful delay
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Default user agent to mimic a real browser
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Core: fetch HTML via Playwright with retries + simple firewall checks
async function fetchPageHtml(url, opts = {}) {
  const attempts = opts.attempts || 3;
  const timeout = opts.timeout || 60000;
  const waitAfterLoad = opts.waitAfterLoad || 3000;

  if (activeBrowsers >= MAX_CONCURRENT_BROWSERS) {
    throw new Error('Too many concurrent requests. Try again later.');
  }

  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let browser;
    try {
      activeBrowsers++;
      console.log(`[fetchPageHtml] attempt ${attempt} -> ${url} (activeBrowsers=${activeBrowsers})`);

      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-zygote',
          '--single-process'
        ]
      });

      const context = await browser.newContext({
        userAgent: DEFAULT_USER_AGENT,
        viewport: { width: 1280, height: 800 }
      });

      const page = await context.newPage();

      // Lightweight navigation strategy (domcontentloaded) — more stable on JS-heavy pages
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

      // Give site a moment to render client-side content
      await wait(waitAfterLoad);

      const html = await page.content();

      // Simple block detection
      const blocked = /access denied|forbidden|captcha|403|blocked/i.test(html);
      if (blocked) {
        lastErr = new Error('Blocked or forbidden response detected in HTML');
        console.warn('[fetchPageHtml] Blocked response content detected, will retry if attempts left.');
        await browser.close();
        activeBrowsers--;
        await wait(2000 * attempt); // backoff
        continue;
      }

      await browser.close();
      activeBrowsers--;
      return html;
    } catch (err) {
      lastErr = err;
      console.warn(`[fetchPageHtml] attempt ${attempt} failed: ${err.message}`);
      try {
        if (browser) await browser.close();
      } catch (e) {}
      activeBrowsers = Math.max(0, activeBrowsers - 1);
      // exponential-ish backoff
      await wait(1500 * attempt);
    }
  }

  throw lastErr || new Error('Failed to fetch page HTML');
}

// Fallback lightweight fetch if playwright fails (non-rendered fallback)
async function fetchFallback(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': DEFAULT_USER_AGENT } });
    if (!res.ok) throw new Error(`Fetch fallback HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    throw err;
  }
}

// Generic route: scrape any URL and return raw HTML
app.get('/scrape', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });

  try {
    let html;
    try {
      html = await fetchPageHtml(url);
    } catch (e) {
      console.warn('[ /scrape ] primary fetch failed, trying fallback:', e.message);
      html = await fetchFallback(url);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[ /scrape ] fatal:', err.toString());
    return res.status(502).json({ error: 'Failed to retrieve URL', details: err.toString() });
  }
});

// Site-specific fastpitch routes that return raw HTML
app.get('/fastpitch/events', async (req, res) => {
  const url = 'https://usssa.com/fastpitch/eventSearch/';
  try {
    let html;
    try {
      html = await fetchPageHtml(url, { attempts: 3, timeout: 60000, waitAfterLoad: 4000 });
    } catch (e) {
      console.warn('USSSA primary failed, fallback:', e.message);
      html = await fetchFallback(url);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[ /fastpitch/events ]', err);
    return res.status(502).json({ error: 'Failed to fetch USSSA', details: err.toString() });
  }
});

app.get('/fastpitch/pgf', async (req, res) => {
  const url = 'https://pgfusa.com/tournaments';
  try {
    let html;
    try {
      html = await fetchPageHtml(url);
    } catch (e) {
      console.warn('PGF primary failed, fallback:', e.message);
      html = await fetchFallback(url);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[ /fastpitch/pgf ]', err);
    return res.status(502).json({ error: 'Failed to fetch PGF', details: err.toString() });
  }
});

app.get('/fastpitch/bullpen', async (req, res) => {
  const url = 'https://play.bullpentournaments.com/events';
  try {
    let html;
    try {
      html = await fetchPageHtml(url);
    } catch (e) {
      console.warn('Bullpen primary failed, fallback:', e.message);
      html = await fetchFallback(url);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[ /fastpitch/bullpen ]', err);
    return res.status(502).json({ error: 'Failed to fetch Bullpen', details: err.toString() });
  }
});

app.get('/fastpitch/softballconnected', async (req, res) => {
  const url = 'https://softballconnected.com/tournaments';
  try {
    let html;
    try {
      html = await fetchPageHtml(url);
    } catch (e) {
      console.warn('SoftballConnected primary failed, fallback:', e.message);
      html = await fetchFallback(url);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[ /fastpitch/softballconnected ]', err);
    return res.status(502).json({ error: 'Failed to fetch SoftballConnected', details: err.toString() });
  }
});

// Health check
app.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    activeBrowsers,
    maxBrowsers: MAX_CONCURRENT_BROWSERS,
    dataDir: DATA_DIR
  });
});

// Weekly automation: run every Sunday at 23:59 (America/Indiana/Indianapolis)
try {
  cron.schedule(
    '59 23 * * 0',
    async () => {
      console.log('[cron] Weekly snapshot job starting (Sunday 23:59 America/Indiana/Indianapolis)');
      const targets = [
        { slug: 'usssa-events', url: 'https://usssa.com/fastpitch/eventSearch/' },
        { slug: 'pgf-tournaments', url: 'https://pgfusa.com/tournaments' },
        { slug: 'bullpen-events', url: 'https://play.bullpentournaments.com/events' },
        { slug: 'softballconnected', url: 'https://softballconnected.com/tournaments' }
      ];

      for (const t of targets) {
        try {
          let html;
          try {
            html = await fetchPageHtml(t.url);
          } catch (err) {
            console.warn(`[cron] primary failed for ${t.slug}: ${err.message}`);
            html = await fetchFallback(t.url);
          }
          const filename = path.join(DATA_DIR, `${t.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
          fs.writeFileSync(filename, html, 'utf8');
          console.log(`[cron] Wrote snapshot: ${filename}`);
        } catch (err) {
          console.error(`[cron] failed snapshot for ${t.slug}:`, err.toString());
        }
      }
      console.log('[cron] Weekly snapshot job completed');
    },
    {
      scheduled: true,
      timezone: 'America/Indiana/Indianapolis'
    }
  );
  console.log('[cron] Weekly job scheduled (Sunday 23:59 America/Indiana/Indianapolis)');
} catch (e) {
  console.warn('[cron] scheduling not available:', e.toString());
}

// Start server
app.listen(PORT, () => {
  console.log(`Playwright scraper service listening on port ${PORT}`);
});
