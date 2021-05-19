const axios = require("axios");
const cheerio = require("cheerio");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const {
  scrapeGovCampsites,
  BASE_URL,
} = require("./recreationGovCampsiteChecker");

// to avoid cloudflare blocking, otherwise you get a 406
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36;";
const SPREADSHEET_NOTIFICATION_RANGE = "Notifications!A:D";

async function main() {
  const { sheets, spreadsheetId } = loadGoogleSheetsClient();
  const intervalSeconds = parseIntervalSeconds();
  if (intervalSeconds > 0) {
    // run task once at the beginning
    await task({ sheets, spreadsheetId });
    // then run it continuously until the process is killed
    setInterval(async () => {
      await task({ sheets, spreadsheetId });
    }, intervalSeconds * 1000);
  } else {
    await task({ sheets, spreadsheetId });
  }
}

function loadGoogleSheetsClient() {
  const {
    clientId,
    clientSecret,
    refreshToken,
    spreadsheetId,
  } = validateGoogleSheetsParameters();
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({
    refresh_token: refreshToken,
  });
  const sheets = google.sheets({ version: "v4", auth: oAuth2Client });
  return { sheets, spreadsheetId };
}

async function task({ sheets, spreadsheetId }) {
  const {
    recGovEntries,
    chaletSites,
    emails,
    pastNotifications,
  } = await loadInputs(sheets, spreadsheetId);
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
    sendNotification({ sitesWithVacancies, emails, sheets, spreadsheetId });
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
      scrapedParks.push(...parks);
    } catch (e) {
      if (e.stdout === "{}\n") {
        log(
          `No recreation.gov availabilities for parks: ${unnotifiedParkIds} between ${startDate} and ${endDate}`
        );
      } else {
        error(e);
      }
    }
  }
  return scrapedParks;
}

async function sendNotification({
  sitesWithVacancies,
  emails,
  sheets,
  spreadsheetId,
}) {
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
    await recordSiteNotificationsSent({
      sitesWithVacancies,
      emails,
      sheets,
      spreadsheetId,
    });
    log(
      `Successfully sent email to ${mailOptions.to} for url(s):\n${urls}`,
      info
    );
  } catch (e) {
    error(`Failed to send email to ${mailOptions.to}`);
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

function validateGoogleSheetsParameters() {
  const clientId = process.env.GOOGLE_SHEETS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_SHEETS_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!clientId) {
    throw new Error("Must set GOOGLE_SHEETS_CLIENT_ID");
  }
  if (!clientSecret) {
    throw new Error("Must set GOOGLE_SHEETS_CLIENT_SECRET");
  }
  if (!refreshToken) {
    throw new Error("Must set GOOGLE_SHEETS_REFRESH_TOKEN");
  }
  if (!spreadsheetId) {
    throw new Error("Must set GOOGLE_SHEETS_SPREADSHEET_ID");
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    spreadsheetId,
  };
}

async function loadInputs(sheetsClient, spreadsheetId) {
  const recGovEntries = await loadRecGovEntries(sheetsClient, spreadsheetId);
  const chaletSites = await loadChaletSites(sheetsClient, spreadsheetId);
  const emails = await loadEmails(sheetsClient, spreadsheetId);
  const pastNotifications = await loadPastNotifications(
    sheetsClient,
    spreadsheetId
  );
  return { recGovEntries, chaletSites, emails, pastNotifications };
}

async function loadEmails(sheetsClient, spreadsheetId) {
  try {
    const {
      data: { values = [] },
    } = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: "'Input: Email'!A:A",
    });

    return values.slice(1).flat();
  } catch (e) {
    error("Unable to load emails", e);
    return [];
  }
}

async function loadPastNotifications(sheetsClient, spreadsheetId) {
  try {
    const {
      data: { values = [] },
    } = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: SPREADSHEET_NOTIFICATION_RANGE,
    });

    return values.slice(1).map((row) => {
      return { email: row[0], url: row[1], startDate: row[2], endDate: row[3] };
    });
  } catch (e) {
    error("Unable to load past notifications", e);
    return [];
  }
}

async function loadRecGovEntries(sheetsClient, spreadsheetId) {
  try {
    const {
      data: { values = [] },
    } = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: "'Input: Rec.gov'!A:C",
    });

    if (values.length === 0) {
      log("No Rec.Gov sites provided, skipping recreation.gov scrape");
    }
    return values.slice(1).map((row) => {
      return {
        parkIds: (row[0] || "").split(",").filter(Boolean),
        startDate: validateDate(row[1]),
        endDate: validateDate(row[2]),
      };
    });
  } catch (e) {
    error("Unable to load rec.gov entries", e);
    return [];
  }
}

async function loadChaletSites(sheetsClient, spreadsheetId) {
  try {
    const {
      data: { values = [] },
    } = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: "'Input: Chalet'!A:B",
    });

    if (values.length === 0) {
      log("No Chalet sites provided, skipping old 90s website scrape");
    }
    return values.slice(1).map((row) => {
      return {
        url: row[0],
        row: row[1],
      };
    });
  } catch (e) {
    error("Unable to load chalet urls", e);
    return [];
  }
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

function validateDate(maybeDate) {
  const dateRegex = /^\d{4}\-(0[1-9]|1[012])\-(0[1-9]|[12][0-9]|3[01])$/;
  if (!dateRegex.test(maybeDate)) {
    throw new Error(`Date ${maybeDate} must be in YYYY-MM-DD format`);
  }
  return maybeDate;
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

async function recordSiteNotificationsSent({
  sitesWithVacancies,
  emails,
  sheets,
  spreadsheetId,
}) {
  const values = [];
  sitesWithVacancies.forEach(({ url, startDate, endDate }) => {
    emails.forEach((email) => {
      values.push([email, url, startDate, endDate].filter(Boolean));
    });
  });
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: SPREADSHEET_NOTIFICATION_RANGE,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } catch (e) {
    error(`Unable to record site notification sent for values: ${values}`, e);
  }
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
