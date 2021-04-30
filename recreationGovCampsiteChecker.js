const path = require("path");
const childProcess = require("child_process");

// ENV vars
const parkIds = "251869,232493,232890,267071".split(",").join(" ");
const startDate = "2021-07-10";
const endDate = "2021-07-17";

const searches = [
  {
    parkId: "251869",
    startDate: "2021-07-17",
    endDate: "2021-07-24",
  },
];

const campsiteScriptFile = path.resolve(
  __dirname,
  "..",
  "..",
  "banool",
  "recreation-gov-campsite-checker",
  "camping.py"
);

async function scrapeGovCampsites() {
  const parkIdsWithAvailability = Object.keys(
    JSON.parse(
      childProcess.execSync(
        `python3 ${campsiteScriptFile} --start-date "${startDate}" --end-date "${endDate}" --parks ${parkIds} --nights 1 --json-output`,
        { encoding: "utf-8" }
      )
    )
  );
  const parkNames = JSON.parse(
    childProcess.execSync(
      `python3 ${campsiteScriptFile} --start-date "${startDate}" --end-date "${endDate}" --parks ${parkIds} --get-park-names`,
      { encoding: "utf-8" }
    )
  );
  return parkIdsWithAvailability.map((parkId) => parkNames[parkId]);
}

module.exports = { scrapeGovCampsites };
