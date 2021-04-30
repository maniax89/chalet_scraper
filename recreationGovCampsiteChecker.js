const path = require("path");
const childProcess = require("child_process");

// ENV vars
const startDate = "2021-07-10";
const endDate = "2021-07-17";
const relativePathToCampsiteScriptFile =
  "../recreation-gov-campsite-checker/camping.py";
// end ENV vars

const BASE_URL = "https://www.recreation.gov/camping/campgrounds/";

const campsiteScriptFile = path.resolve(
  __dirname,
  relativePathToCampsiteScriptFile
);

async function scrapeGovCampsites(parkIds) {
  if (parkIds.length === 0) {
    return [];
  }
  const parkIdsWithAvailability = Object.keys(
    JSON.parse(
      childProcess.execSync(
        `python3 ${campsiteScriptFile} --start-date "${startDate}" --end-date "${endDate}" --parks ${parkIds.join(
          " "
        )} --nights 1 --json-output`,
        { encoding: "utf-8" }
      )
    )
  );
  return parkIdsWithAvailability.map((parkId) => {
    return { url: `${BASE_URL}${parkId}` };
  });
}

module.exports = { scrapeGovCampsites, BASE_URL };
