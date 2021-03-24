const axios = require('axios');

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36;'
const chaletSites = [
    'http://sperrychalet.com/vacancy_s.html',
    'https://www.graniteparkchalet.com/vacancy_g.html'
];

async function scrapeSites() {
    for (let i = 0; i < chaletSites.length; i++) {
        const url = chaletSites[i];
        try {
            const html = await axios.get(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html'
                }
            });
            return html;
        } catch (e) {
            console.log('Error fetching url', url);
            throw e;
        }
    }
}

if (require.main === module) {
    console.log(scrapeSites());
}

module.exports = scrapeSites;