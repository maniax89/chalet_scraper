const axios = require("axios");
const cheerio = require("cheerio");
const nodemailer = require("nodemailer");
const {
  scrapeGovCampsites,
  BASE_URL,
} = require("./recreationGovCampsiteChecker");

let notifiedSites = {};
// const parkIds = "251869,232493,232890,267071";
// const chaletSites = "http://sperrychalet.com/vacancy_s.html,https://www.graniteparkchalet.com/vacancy_g.html"
// to avoid cloudflare blocking, otherwise you get a 406
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36;";

async function main() {
  const intervalSeconds = parseIntervalSeconds();
  const parkIds = parseParkIds();
  const chaletSites = parseChaletSites();
  if (intervalSeconds > 0) {
    // run task once at the beginning
    await task({ parkIds, chaletSites });
    // then run it continuously until the process is killed
    setInterval(async () => {
      await task({ parkIds, chaletSites });
    }, intervalSeconds * 1000);
  } else {
    await task({ parkIds, chaletSites });
  }
}

async function task({ parkIds, chaletSites }) {
  const unnotifiedSites = filterUnnotifiedUrls(
    chaletSites.map(({ url }) => url)
  );
  const unnotifiedParkIds = filterUnnotifiedUrls(
    parkIds.map((parkId) => `${BASE_URL}${parkId}`)
  ).map((parkUrl) => parkUrl.replace(BASE_URL, ""));
  const scrapedSites = await scrapeSites(unnotifiedSites);
  const scrapedParks = await scrapeGovCampsites(unnotifiedParkIds);
  const sitesWithVacancies = scrapedSites
    .filter(({ hasVacancy }) => hasVacancy)
    .concat(scrapedParks);

  if (sitesWithVacancies.length > 0) {
    sendNotification(sitesWithVacancies);
  } else {
    log("No sites with vacancies. Not sending notification.");
  }
}

async function scrapeSites(unnotifiedSites) {
  for (let i = 0; i < unnotifiedSites.length; i++) {
    const { url, row } = unnotifiedSites[i];
    // reset defaults
    unnotifiedSites[i].data = [];
    unnotifiedSites[i].hasVacancy = false;
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html",
        },
      });
      const tableRows = getTableRows(data, row);
      tableRows.each((_, element) => {
        const text = cheerio(element).text().trim();
        if (text) {
          const parsedCell = parseCellText(text);
          if (!parsedCell.isBooked) {
            unnotifiedSites[i].hasVacancy = true;
          }
          unnotifiedSites[i].data.push(parsedCell);
        }
      });
    } catch (e) {
      error("Error fetching url", url);
      throw e;
    }
  }
  return unnotifiedSites;
}

function getTableRows(html, startingRow) {
  const $ = cheerio.load(html);
  return $(`table tr:nth-child(n+${startingRow}) td`);
}

function parseCellText(cellText) {
  const cellTuple = cellText.replace(/[\t]/g, "").split("\n");
  const value = cellTuple.slice(1).join(" ").trim();
  const isBooked = value === "" || value.includes("NO");
  return {
    date: cellTuple[0],
    value,
    isBooked,
  };
}

async function sendNotification(sitesWithVacancies) {
  const {
    user,
    clientId,
    clientSecret,
    refreshToken,
    to,
  } = validateNodemailerParameters();
  const urls = sitesWithVacancies.map(({ url }) => url).join("\n");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user,
      clientId,
      clientSecret,
      refreshToken,
    },
  });
  const mailOptions = {
    from: user,
    to,
    subject: "Chalet Vacancies Available",
    text: `Chalet Vacancies available for \n${urls}`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    recordSiteNotificationsSent(sitesWithVacancies);
    log(`Successfully sent email to ${to} for url(s):\n${urls}`, info);
  } catch (e) {
    error(`Failed to send email to ${to}`);
    throw e;
  }
}

function validateNodemailerParameters() {
  const user = process.env.SEND_EMAIL_USER;
  const clientId = process.env.SEND_EMAIL_CLIENT_ID;
  const clientSecret = process.env.SEND_EMAIL_CLIENT_SECRET;
  const refreshToken = process.env.SEND_EMAIL_REFRESH_TOKEN;
  const to = process.env.RECEIVE_EMAIL_ADDRESS;
  if (!user) {
    throw new Error("Must set SEND_EMAIL_USER");
  }
  if (!clientId) {
    throw new Error("Must set SEND_EMAIL_CLIENT_ID");
  }
  if (!clientSecret) {
    throw new Error("Must set SEND_EMAIL_CLIENT_SECRET");
  }
  if (!refreshToken) {
    throw new Error("Must set SEND_EMAIL_REFRESH_TOKEN");
  }
  if (!to) {
    throw new Error("Must set RECEIVE_EMAIL_ADDRESS");
  }
  return {
    user,
    clientId,
    clientSecret,
    refreshToken,
    to,
  };
}

function parseIntervalSeconds() {
  let intervalSeconds = -1;
  const intervalStr = process.env.INTERVAL_SECONDS;
  if (intervalStr) {
    const intervalSecondsParsed = parseInt(intervalStr, 10);
    if (!isNaN(intervalSecondsParsed)) {
      intervalSeconds = intervalSecondsParsed;
    } else {
      log("INTERVAL_SECONDS was not a number, not setting interval");
    }
  } else {
    log("INTERVAL_SECONDS was not set, not setting interval");
  }
  return intervalSeconds;
}

function parseParkIds() {
  const parkIdsStr = process.env.PARK_IDS;
  if (parkIdsStr) {
    const parkIdsParsed = parkIdsStr.split(",");
    if (parkIdsParsed.length === 0) {
      log("PARK_IDS not provided, skipping recreation.gov scrape");
      return [];
    }
    return parkIdsParsed;
  }
  return [];
}

function parseChaletSites() {
  const chaletUrlsStr = process.env.CHALET_URLS;
  if (chaletUrlsStr) {
    const chaletUrlsParsed = chaletUrlsStr.split(",");
    if (chaletUrlsParsed.length === 0) {
      log("CHALET_URLS not provided, skipping old 90s website scrape");
      return [];
    }
    return chaletUrlsParsed.map((url) => {
      return {
        url,
        row: 3,
        data: [],
        hasVacancy: false,
      };
    });
  }
  return [];
}

function filterUnnotifiedUrls(fullSiteList) {
  return fullSiteList.filter((site) => {
    const notifiedSiteRecipients = notifiedSites[site.url];
    return typeof notifiedSiteRecipients === "undefined";
  });
}

function recordSiteNotificationsSent(sitesWithVacancies) {
  sitesWithVacancies.forEach((siteWithVacancy) => {
    notifiedSites[siteWithVacancy.url] = process.env.RECEIVE_EMAIL_ADDRESS;
  });
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function error(...args) {
  console.error(`[${new Date().toISOString()}]`, ...args);
}

if (require.main === module) {
  main();
}

module.exports = main;
