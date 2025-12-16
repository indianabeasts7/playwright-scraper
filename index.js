const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/**
 * GET /scrape/usssa
 * Example:
 * https://your-app.onrender.com/scrape/usssa
 */
app.get("/scrape/usssa", async (req, res) => {
  let browser;

  try {
    console.log("Starting USSSA intercept scrape...");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process"
      ]
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    let eventsData = null;

    // 🔥 INTERCEPT NETWORK RESPONSES
    page.on("response", async (response) => {
      const url = response.url();

      // USSSA event API endpoints usually contain these keywords
      if (
        url.includes("event") &&
        url.includes("search") &&
        response.request().resourceType() === "xhr"
      ) {
        try {
          const json = await response.json();

          if (json && (json.events || json.data)) {
            console.log("✅ USSSA event API intercepted");
            eventsData = json;
          }
        } catch (err) {
          // ignore non-JSON responses
        }
      }
    });

    // Load real USSSA page (must be browser-based)
    await page.goto("https://usssa.com/fastpitch/eventSearch", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Give JS time to fire API requests
    await page.waitForTimeout(8000);

    await browser.close();

    if (!eventsData) {
      return res.status(500).json({
        error: "USSSA API returned no event data (possible site change)"
      });
    }

    return res.json({
      source: "usssa",
      intercepted: true,
      data: eventsData
    });

  } catch (err) {
    console.error("SCRAPER ERROR:", err);

    if (browser) await browser.close();

    return res.status(500).json({
      error: err.toString()
    });
  }
});

app.get("/", (req, res) => {
  res.send("Playwright USSSA Intercept Scraper running ✔");
});

app.listen(PORT, () => {
  console.log(`Playwright scraper service listening on port ${PORT}`);
});
