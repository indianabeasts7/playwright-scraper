/**
 * index.js
 * Playwright microservice + unified fastpitch scrapers (USSSA, PGF, USFA, Bullpen, SoftballConnected)
 *
 * Features:
 * - /scrape?url= -> returns raw HTML from a Playwright-rendered browser
 * - /events -> runs unified scrapers and returns JSON of events
 * - scheduled weekly run (Sunday 23:59 America/Indiana/Indianapolis) to write JSON/CSV
 * - optional S3 upload (configure AWS_* and S3_BUCKET)
 * - robust retries, rotating UAs, randomized waits, optional proxy
 */

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// ----------------------------
// Config (from env)
// ----------------------------
const PORT = process.env.PORT || 10000;
const PROXY_URL = process.env.PROXY_URL || null; // optional proxy server "http://user:pass@host:port"
const S3_BUCKET = process.env.S3_BUCKET || null;  // optional S3 bucket name for uploads
const AWS_REGION = process.env.AWS_REGION || "us-east-1"; // if uploading to S3
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || null;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || null;

// Scheduler: Sunday 23:59 in America/Indiana/Indianapolis
const SCHEDULE_CRON = process.env.SCHEDULE_CRON || "59 23 * * 0"; // node-cron tz option used below
const SCHEDULE_TZ = process.env.SCHEDULE_TZ || "America/Indiana/Indianapolis";

// Output files
const JSON_FILE = "fastpitch_master.json";
const CSV_FILE = "fastpitch_master.csv";

// ----------------------------
// Anti-bot helpers
// ----------------------------
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
];

const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const randBetween = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

// ----------------------------
// S3 client (optional)
// ----------------------------
let s3Client = null;
if (S3_BUCKET && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
  });
  console.log("S3 upload enabled (bucket:", S3_BUCKET, ")");
}

// ----------------------------
// Core fetch (Playwright + retries)
// ----------------------------
async function fetchHTMLViaPlaywright(targetUrl, opts = {}) {
  /**
   * opts:
   *  - attempts (default 3)
   *  - initialWaitMs (default 3000)
   *  - detectBlockStrings (array)
   */
  const attempts = opts.attempts || 3;
  const initialWaitMs = opts.initialWaitMs || 3000;
  const detectBlockStrings = opts.detectBlockStrings || ["Access Denied", "Forbidden", "403", "captcha", "verify you are human"];

  let browser = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let context = null;
    let page = null;
    try {
      console.log(`[playwright] attempt ${attempt} -> ${targetUrl}`);

      const launchOptions = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote"
        ]
      };

      if (PROXY_URL) {
        launchOptions.proxy = { server: PROXY_URL };
        console.log("[playwright] using proxy:", PROXY_URL);
      }

      browser = await chromium.launch(launchOptions);

      context = await browser.newContext({
        userAgent: randomUA(),
        viewport: { width: 1280, height: 720 },
        javaScriptEnabled: true
      });

      // small stealth: override webdriver
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      page = await context.newPage();

      // navigation
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

      // allow JS to render — add a randomized extra wait to simulate real browsing
      await wait(initialWaitMs + randBetween(1000, 3000));

      const html = await page.content();

      // detect block strings
      const lowered = html.toLowerCase();
      let blocked = false;
      for (const s of detectBlockStrings) {
        if (lowered.includes(s.toLowerCase())) {
          blocked = true;
          break;
        }
      }

      await page.close();
      await context.close();
      await browser.close();

      if (blocked) {
        console.log("[playwright] detected block response, retrying...");
        // small backoff
        await wait(2000 + attempt * 1000);
        continue;
      }

      return html;
    } catch (err) {
      console.log("[playwright] error on attempt", attempt, ":", err && err.toString ? err.toString() : err);
      try {
        if (page && !page.isClosed()) await page.close();
      } catch (e) {}
      try {
        if (context) await context.close();
      } catch (e) {}
      try {
        if (browser) await browser.close();
      } catch (e) {}
      // backoff
      await wait(2000 + attempt * 1000);
    }
  } // attempts

  return null;
}

// ----------------------------
// Utility: event object
// ----------------------------
function makeEvent(name, start, end, location, sanction, link) {
  return {
    event_name: (name || "N/A").toString().trim(),
    start_date: (start || "N/A").toString().trim(),
    end_date: (end || "N/A").toString().trim(),
    location: (location || "N/A").toString().trim(),
    sanction: (sanction || "N/A").toString(),
    link: link || "N/A"
  };
}

// ----------------------------
// Per-site scrapers (HTML parse with cheerio)
// ----------------------------
async function scrapeUSSSA() {
  const url = "https://usssa.com/fastpitch/eventSearch/";
  const html = await fetchHTMLViaPlaywright(url);
  if (!html) return [];

  try {
    // USSSA commonly includes a JS variable with events; try to extract JSON
    const regex = /preloadedEvents\s*=\s*(\[[\s\S]*?\]);/i;
    const m = html.match(regex);
    if (!m) return [];

    const jsonText = m[1];
    const data = JSON.parse(jsonText);
    const events = data.map(e => makeEvent(e.event_name, e.start_date, e.end_date, e.city || e.location, "USSSA", url));
    console.log("[USSSA] scraped", events.length);
    return events;
  } catch (err) {
    console.log("[USSSA] parse error:", err && err.toString ? err.toString() : err);
    return [];
  }
}

async function scrapeUSFA() {
  const url = "https://usfastpitch.com/tournaments";
  const html = await fetchHTMLViaPlaywright(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const out = [];
  $(".tournament-card").each((i, el) => {
    const name = $(el).find(".tournament-title").text().trim();
    const dates = $(el).find(".tournament-dates").text().trim();
    const loc = $(el).find(".tournament-location").text().trim();
    if (name) out.push(makeEvent(name, dates || "N/A", null, loc || "N/A", "USFA", url));
  });
  console.log("[USFA] scraped", out.length);
  return out;
}

async function scrapePGF() {
  const url = "https://pgfusa.com/tournaments";
  const html = await fetchHTMLViaPlaywright(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const out = [];
  $("table tbody tr").each((i, row) => {
    const cols = $(row).find("td").map((i, el) => $(el).text().trim()).get();
    if (cols.length >= 3) {
      out.push(makeEvent(cols[0], cols[1], null, cols[2], "PGF", url));
    }
  });
  console.log("[PGF] scraped", out.length);
  return out;
}

async function scrapeBullpen() {
  const url = "https://play.bullpentournaments.com/events";
  const html = await fetchHTMLViaPlaywright(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const out = [];
  $(".event-card").each((i, card) => {
    const title = $(card).find(".event-name").text().trim();
    const date = $(card).find(".event-date").text().trim();
    const city = $(card).find(".event-location").text().trim();
    if (title) out.push(makeEvent(title, date || "N/A", null, city || "N/A", "Bullpen", url));
  });
  console.log("[Bullpen] scraped", out.length);
  return out;
}

async function scrapeSoftballConnected() {
  const url = "https://softballconnected.com/tournaments";
  const html = await fetchHTMLViaPlaywright(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const out = [];
  $(".tournament-row").each((i, row) => {
    const title = $(row).find(".tournament-title").text().trim();
    const dates = $(row).find(".tournament-dates").text().trim();
    const city = $(row).find(".tournament-location").text().trim();
    if (title) out.push(makeEvent(title, dates || "N/A", null, city || "N/A", "SoftballConnected", url));
  });
  console.log("[SoftballConnected] scraped", out.length);
  return out;
}

// ----------------------------
// Run all scrapers
// ----------------------------
async function runAllScrapers(writeFiles = true) {
  console.log("[runAllScrapers] Starting full scrape...");

  // Run them in series to avoid too many browsers simultaneously (safer on Render)
  const results = [];
  try {
    results.push(...(await scrapeUSSSA()));
    results.push(...(await scrapeUSFA()));
    results.push(...(await scrapePGF()));
    results.push(...(await scrapeBullpen()));
    results.push(...(await scrapeSoftballConnected()));
  } catch (e) {
    console.log("[runAllScrapers] fatal:", e && e.toString ? e.toString() : e);
  }

  console.log("[runAllScrapers] total events:", results.length);

  if (writeFiles) {
    // write JSON
    try {
      fs.writeFileSync(JSON_FILE, JSON.stringify({ count: results.length, events: results }, null, 2), "utf8");
      console.log("[runAllScrapers] wrote", JSON_FILE);
    } catch (e) {
      console.log("[runAllScrapers] JSON write error:", e);
    }

    // write CSV (simple)
    try {
      const header = ["event_name", "start_date", "end_date", "location", "sanction", "link"];
      const rows = results.map(r => header.map(h => (`"${(r[h] || "").toString().replace(/"/g, '""')}"`).join(",")).join(","));
      const csv = header.join(",") + "\n" + results.map(r => `${escapeCSV(r.event_name)},${escapeCSV(r.start_date)},${escapeCSV(r.end_date)},${escapeCSV(r.location)},${escapeCSV(r.sanction)},${escapeCSV(r.link)}`).join("\n");
      fs.writeFileSync(CSV_FILE, csv, "utf8");
      console.log("[runAllScrapers] wrote", CSV_FILE);
    } catch (e) {
      console.log("[runAllScrapers] CSV write error:", e);
    }

    // optional S3 upload
    if (s3Client) {
      try {
        await uploadFileToS3(JSON_FILE);
        await uploadFileToS3(CSV_FILE);
      } catch (e) {
        console.log("[runAllScrapers] S3 upload error:", e);
      }
    }
  }

  return results;
}

// small helper to escape CSV cells
function escapeCSV(v) {
  if (!v && v !== 0) return '""';
  return `"${v.toString().replace(/"/g, '""')}"`;
}

// upload a local file to S3 (optional)
async function uploadFileToS3(filename) {
  if (!s3Client) throw new Error("S3 client not configured");
  const body = fs.readFileSync(path.resolve(filename));
  const key = `fastpitch/${path.basename(filename)}`;
  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: filename.endsWith(".json") ? "application/json" : "text/csv"
  });
  await s3Client.send(cmd);
  console.log("[S3] uploaded", key);
}

// ----------------------------
// Express endpoints
// ----------------------------
const app = express();
app.use(cors());

// raw scrape endpoint (returns HTML)
app.get("/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  console.log("[endpoint] /scrape", url);
  const html = await fetchHTMLViaPlaywright(url);
  if (!html) return res.status(500).json({ error: "Failed to fetch HTML" });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// unified events endpoint (JSON)
app.get("/events", async (req, res) => {
  console.log("[endpoint] /events request");
  try {
    const events = await runAllScrapers(true);
    res.json({ count: events.length, events });
  } catch (e) {
    res.status(500).json({ error: e && e.toString ? e.toString() : "unknown" });
  }
});

app.get("/", (req, res) => {
  res.send("Playwright Fastpitch Scraper is running ✔");
});

// ----------------------------
// Scheduler (weekly)
// ----------------------------
try {
  cron.schedule(SCHEDULE_CRON, async () => {
    console.log("[scheduler] Cron triggered:", new Date().toString());
    try {
      await runAllScrapers(true);
      console.log("[scheduler] Completed scheduled scrape");
    } catch (e) {
      console.log("[scheduler] Error during scheduled scrape:", e && e.toString ? e.toString() : e);
    }
  }, {
    timezone: SCHEDULE_TZ
  });
  console.log("[scheduler] scheduled:", SCHEDULE_CRON, "tz:", SCHEDULE_TZ);
} catch (e) {
  console.log("[scheduler] cron init failed:", e);
}

// ----------------------------
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

