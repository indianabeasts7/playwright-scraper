const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

// Fast health check (Render LOVES this)
app.get("/", (req, res) => {
  res.status(200).send("USSSA Playwright Scraper alive ✔");
});

app.get("/scrape/usssa", async (req, res) => {
  // 🔥 Tell Render immediately: "I'm alive"
  res.setHeader("Content-Type", "application/json");
  res.write(JSON.stringify({ status: "starting scrape..." }));

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

    page.on("response", async (response) => {
      const url = response.url();

      if (
        url.toLowerCase().includes("event") &&
        response.request().resourceType() === "xhr"
      ) {
        try {
          const json = await response.json();
          if (json && (json.events || json.data)) {
            console.log("✅ USSSA API intercepted");
            eventsData = json;
          }
        } catch {}
      }
    });

    await page.goto("https://usssa.com/fastpitch/eventSearch", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Hard wait cap (Render-safe)
    await page.waitForTimeout(6000);

    await browser.close();

    if (!eventsData) {
      return res.end(
        JSON.stringify({
          error: "No USSSA event data intercepted",
          hint: "Site may have changed endpoints"
        })
      );
    }

    return res.end(
      JSON.stringify({
        source: "usssa",
        intercepted: true,
        data: eventsData
      })
    );

  } catch (err) {
    console.error("SCRAPER ERROR:", err);

    if (browser) await browser.close();

    return res.end(
      JSON.stringify({
        error: err.toString()
      })
    );
  }
});

app.listen(PORT, () => {
  console.log(`Playwright scraper service listening on port ${PORT}`);
});
