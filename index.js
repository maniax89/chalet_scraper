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
  const { startDate, endDate } = parseDates(parkIds);
  if (intervalSeconds > 0) {
    // run task once at the beginning
    await task({ parkIds, chaletSites, startDate, endDate });
    // then run it continuously until the process is killed
    setInterval(async () => {
      await task({ parkIds, chaletSites, startDate, endDate });
    }, intervalSeconds * 1000);
  } else {
    await task({ parkIds, chaletSites, startDate, endDate });
  }
}

async function task({ parkIds, chaletSites, startDate, endDate }) {
  const unnotifiedSites = filterUnnotifiedUrls(chaletSites);
  const unnotifiedParkIds = filterUnnotifiedUrls(
    parkIds.map((parkId) => {
      return { url: `${BASE_URL}${parkId}` };
    })
  ).map((parkUrlObj) => parkUrlObj.url.replace(BASE_URL, ""));
  const scrapedSites = await scrapeSites(unnotifiedSites);
  let scrapedParks = [];
  try {
    scrapedParks = await scrapeGovCampsites({
      parkIds: unnotifiedParkIds,
      startDate,
      endDate,
    });
  } catch (e) {
    if (e.stdout === "{}\n") {
      log("No recreation.gov availabilities");
    } else {
      error(e);
    }
  }
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
    receivers,
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
    subject: "Chalet Vacancies Available",
    text: `Chalet Vacancies available for \n${urls}`,
  };
  try {
    for (let i = 0; i < receivers.length; i++) {
      const to = receivers[i];
      const info = await transporter.sendMail({ ...mailOptions, to });
      recordSiteNotificationsSent(sitesWithVacancies);
      log(`Successfully sent email to ${to} for url(s):\n${urls}`, info);
    }
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
  const receivers = (process.env.RECEIVE_EMAIL_ADDRESS || "")
    .split(",")
    .filter(Boolean);
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
  if (receivers.length === 0) {
    throw new Error("Must set RECEIVE_EMAIL_ADDRESS");
  }
  return {
    user,
    clientId,
    clientSecret,
    refreshToken,
    receivers,
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
  const parkIds = (process.env.PARK_IDS || "").split(",").filter(Boolean);
  if (parkIds.length === 0) {
    log("PARK_IDS not provided, skipping recreation.gov scrape");
  }
  return parkIds;
}

function parseChaletSites() {
  const chaletUrls = (process.env.CHALET_URLS || "").split(",").filter(Boolean);
  if (chaletUrls.length === 0) {
    log("CHALET_URLS not provided, skipping old 90s website scrape");
  }
  return chaletUrls.map((url) => {
    return {
      url,
      row: 3,
      data: [],
      hasVacancy: false,
    };
  });
}

function parseDates(parkIds) {
  const dateRegex = /^\d{4}\-(0[1-9]|1[012])\-(0[1-9]|[12][0-9]|3[01])$/;
  const startDate = process.env.START_DATE;
  const endDate = process.env.END_DATE;
  if (parkIds.length > 0) {
    if (!dateRegex.test(startDate)) {
      throw new Error(
        "Non-empty PARK_IDS requires START_DATE in YYYY-MM-DD format"
      );
    }
    if (!dateRegex.test(endDate)) {
      throw new Error(
        "Non-empty PARK_IDS requires END_DATE in YYYY-MM-DD format"
      );
    }
  }
  return { startDate, endDate };
}

function filterUnnotifiedUrls(urls) {
  return urls.filter((urlObj) => {
    const notifiedSiteRecipients = notifiedSites[urlObj.url];
    return typeof notifiedSiteRecipients === "undefined";
  });
}

function recordSiteNotificationsSent(sitesWithVacancies, to) {
  sitesWithVacancies.forEach((siteWithVacancy) => {
    notifiedSites[siteWithVacancy.url] = (
      notifiedSites[siteWithVacancy.url] || []
    ).concat(to);
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
