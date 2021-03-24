const axios = require('axios');
const cheerio = require('cheerio');

// to avoid cloudflare blocking, otherwise you get a 406
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36;'
const chaletSites = [
    { url: 'http://sperrychalet.com/vacancy_s.html', row: 2, data: [] },
    { url: 'https://www.graniteparkchalet.com/vacancy_g.html', row: 3, data: [] }
];

async function scrapeSites() {
    for (let i = 0; i < chaletSites.length; i++) {
        const { url, row } = chaletSites[i];
        try {
            const { data } = await axios.get(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html'
                }
            });
            const tableRows = getTableRows(data, row);
            tableRows.each((_, element) => {
                const text = cheerio(element).text().trim();
                if (text) {
                    chaletSites[i].data.push(parseCellText(text));
                }
            });
        } catch (e) {
            console.log('Error fetching url', url);
            throw e;
        }
    }
    return chaletSites;
}

function getTableRows(html, startingRow) {
    const $ = cheerio.load(html);
    return $(`table tr:nth-child(n+${startingRow}) td`);
}

function parseCellText(cellText) {
    const cellTuple = cellText.replace(/[\t]/g,'').split('\n');
    const value = cellTuple.slice(1).join(' ').trim();
    const isBooked = value === '' || value.includes('NO');
    return {
        date: cellTuple[0],
        value,
        isBooked
    };
}

if (require.main === module) {
    scrapeSites().then(output => console.log(JSON.stringify(output, null, 2)));
}

module.exports = scrapeSites;