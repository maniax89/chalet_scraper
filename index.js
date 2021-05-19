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
  if (intervalSeconds > 0) {
    // run task once at the beginning
    await task();
    // then run it continuously until the process is killed
    setInterval(async () => {
      await task();
    }, intervalSeconds * 1000);
  } else {
    await task();
  }
}

async function task() {
  const {
    recGovEntries,
    chaletSites,
    emails,
    pastNotifications,
  } = loadInputs();
  if (emails.length === 0) {
    log("No emails configured. Not running scraper(s).");
    return;
  }
  const scrapedChaletSites = await scrapeSites(
    chaletSites,
    emails,
    pastNotifications
  );
  const scrapedParks = await scrapeParks(
    recGovEntries,
    emails,
    pastNotifications
  );

  const sitesWithVacancies = scrapedChaletSites
    .filter(({ hasVacancy }) => hasVacancy)
    .concat(scrapedParks);

  if (sitesWithVacancies.length > 0) {
    sendNotification(sitesWithVacancies, emails);
  } else {
    log("No sites with vacancies. Not sending notification.");
  }
}

async function scrapeSites(chaletSites, emails, pastNotifications) {
  const unnotifiedChaletSites = filterUnnotifiedUrls(
    chaletSites,
    emails,
    pastNotifications
  );
  for (let i = 0; i < unnotifiedChaletSites.length; i++) {
    const { url, row } = unnotifiedChaletSites[i];
    // reset defaults
    unnotifiedChaletSites[i].data = [];
    unnotifiedChaletSites[i].hasVacancy = false;
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
            unnotifiedChaletSites[i].hasVacancy = true;
          }
          unnotifiedChaletSites[i].data.push(parsedCell);
        }
      });
    } catch (e) {
      error("Error fetching url", url);
      throw e;
    }
  }
  return unnotifiedChaletSites;
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

async function scrapeParks(recGovEntries, emails, pastNotifications) {
  let scrapedParks = [];
  for (let i = 0; i < recGovEntries.length; i++) {
    const { parkIds, startDate, endDate } = recGovEntries[i];
    const unnotifiedParkIds = filterUnnotifiedUrls(
      parkIds.map((parkId) => {
        return { url: `${BASE_URL}${parkId}`, startDate, endDate };
      }),
      emails,
      pastNotifications
    ).map((parkUrlObj) => parkUrlObj.url.replace(BASE_URL, ""));
    try {
      const parks = await scrapeGovCampsites({
        parkIds: unnotifiedParkIds,
        startDate,
        endDate,
      });
      scrapedParks.push(parks);
    } catch (e) {
      if (e.stdout === "{}\n") {
        log(
          `No recreation.gov availabilities for parks: ${parkIds} between ${startDate} and ${endDate}`
        );
      } else {
        error(e);
      }
    }
  }
  return scrapedParks;
}

async function sendNotification(sitesWithVacancies, emails) {
  const {
    user,
    clientId,
    clientSecret,
    refreshToken,
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
    to: emails.join(","),
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
  return {
    user,
    clientId,
    clientSecret,
    refreshToken,
  };
}

function loadInputs() {
  // TODO returns inputs object
  // { recGovEntries, chaletSites, emails, pastNotifications }
}

function loadEmails() {
  // TODO returns array of strings
  // [ 'email@foo.com' ]
}

function loadPastNotifications() {
  //TODO return array of objects
  // [ { email, url, startDate, endDate }]
}

function loadRecGovEntries() {
  //TODO return array of objects
  // [ { parkIds: [], startDate, endDate }]
}

function loadChaletSites() {
  //TODO return array of objects
  // [ { url, row } ]
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

function filterUnnotifiedUrls(urls, emails, pastNotifications) {
  return urls.filter(({ url, startDate, endDate }) => {
    return (
      typeof pastNotifications.find(
        ({
          email: pastNotificationEmail,
          url: pastNotificationUrl,
          startDate: pastNotificationStartDate,
          endDate: pastNotificationEndDate,
        }) => {
          return (
            url === pastNotificationUrl &&
            emails.includes(pastNotificationEmail) &&
            startDate === pastNotificationStartDate &&
            endDate === pastNotificationEndDate
          );
        }
      ) === "undefined"
    );
  });
}

function recordSiteNotificationsSent(sitesWithVacancies, emails) {
  sitesWithVacancies.forEach(({ url, startDate, endDate }) => {
    emails.forEach((email) => {
      //TODO add row to output: notifications
      // convert undefined to empty string
      console.log({ email, url, startDate, endDate });
    });
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
