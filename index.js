const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth")();

chromium.use(StealthPlugin);

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

const USSSA_URL = "https://usssa.com/fastpitch/eventSearch";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* -------------------------------------------------- */
/* ROOT HEALTH CHECK                                  */
/* -------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("Playwright Scraper is running ✔");
});

/* -------------------------------------------------- */
/* USSSA SCRAPER                                      */
/* -------------------------------------------------- */
app.get("/scrape-usssa", async (req, res) => {
  console.log("\n================ USSSA SCRAPE START ================");

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    console.log("→ Navigating to USSSA Event Search");
    await page.goto(USSSA_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await sleep(6000);

    const html = await page.content();
    console.log("→ HTML length:", html.length);

    const $ = cheerio.load(html);
    const events = [];

    $("table tbody tr").each((_, row) => {
      const cols = $(row).find("td");
      if (cols.length >= 4) {
        events.push({
          event_name: $(cols[0]).text().trim(),
          start_date: $(cols[1]).text().trim(),
          stature: $(cols[2]).text().trim(),
          location: $(cols[3]).text().trim()
        });
      }
    });

    console.log("→ Events scraped:", events.length);

    await browser.close();

    if (!events.length) {
      return res.status(404).json({
        error: "USSSA page loaded but no events parsed",
        hint: "USSSA may have changed DOM structure"
      });
    }

    res.json({
      source: "playwright-browser",
      count: events.length,
      events
    });

  } catch (err) {
    if (browser) await browser.close();

    console.error("FATAL SCRAPER ERROR:", err);

    res.status(500).json({
      error: err.toString()
    });
  }
});

/* -------------------------------------------------- */
/* DEBUG / SELF-TEST ROUTE                             */
/* -------------------------------------------------- */
app.get("/self-test", (req, res) => {
  res.json({
    status: "ok",
    playwright: true,
    cheerio: true,
    timestamp: new Date().toISOString()
  });
});

/* -------------------------------------------------- */
app.listen(PORT, () => {
  console.log("Playwright scraper service started on port", PORT);
});
