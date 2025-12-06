
const express = require("express");
const cors = require("cors");
const playwright = require("playwright");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

async function scrapeSite(url, selector) {
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });

  await page.waitForTimeout(3000);

  const html = await page.content();

  await browser.close();

  return html;
}

// ===========================
// 🚀 SCRAPE ROUTE
// ===========================
app.get("/scrape", async (req, res) => {
  try {
    console.log("Scrape request received...");

    const urls = [
      "https://usssa.com/fastpitch/eventSearch/",
      "https://usfastpitch.com/tournaments",
      "https://pgfusa.com/tournaments",
      "https://play.bullpentournaments.com/events",
      "https://softballconnected.com/tournaments"
    ];

    const results = {};

    for (let url of urls) {
      console.log("Scraping:", url);
      const html = await scrapeSite(url);
      results[url] = html ? "HTML loaded" : "Failed";
    }

    res.json({
      status: "success",
      message: "Scraped all sites",
      results
    });

  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/", (req, res) => {
  res.send("Playwright scraper is running.");
});

app.listen(PORT, () => {
  console.log(`Scraper running on port ${PORT}`);
});
