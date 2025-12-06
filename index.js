
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
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
});


  await page.waitForTimeout(3000);

  const html = await page.content();

  await browser.close();

  return html;
}

// ===========================
// 🚀 SCRAPE ROUTE
// ===========================
app.get("/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url=" });

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // retry logic
    let success = false;
    let html = "";

    for (let i = 0; i < 3 && !success; i++) {
      try {
        console.log(`Attempt ${i + 1} → ${url}`);
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        // wait additional time for JS-rendered content
        await page.waitForTimeout(3000);

        html = await page.content();
        success = true;

      } catch (err) {
        console.log("Attempt failed:", err.message);
        if (i === 2) throw err;
      }
    }

    await browser.close();
    res.send(html);

  } catch (error) {
    await browser.close();
    res.status(500).json({ error: error.toString() });
  }
});

