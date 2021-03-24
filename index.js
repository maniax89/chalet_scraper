const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

// to avoid cloudflare blocking, otherwise you get a 406
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36;'
const chaletSites = [
    { url: 'http://sperrychalet.com/vacancy_s.html', row: 3, data: [], hasVacancy: false },
    { url: 'https://www.graniteparkchalet.com/vacancy_g.html', row: 3, data: [], hasVacancy: false }
];

async function main() {
    const scrapedSites = await scrapeSites();
    const sitesWithVacancies = scrapedSites.filter(({ hasVacancy }) => hasVacancy);

    if (sitesWithVacancies.length > 0) {
        sendNotification(chaletSites);
    } else {
        console.log('No sites with vacancies. Not sending notification.');
    }
}

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
                    const parsedCell = parseCellText(text);
                    if (!parsedCell.isBooked) {
                        chaletSites[i].hasVacancy = true;
                    }
                    chaletSites[i].data.push(parsedCell);
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

async function sendNotification(sitesWithVacancies) {
    const { user, pass, to } = validateNodemailerParameters();
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass
        }
    });
    const mailOptions = {
        from: user,
        to,
        subject: 'Chalet Vacancies Available',
        text: `Chalet Vacancies available for \n${sitesWithVacancies.map(({ url }) => url).join('\n')}`
    };
    try {
        const info = await transporter.sendMail(mailOptions)
        console.log(`Successfully sent email to ${to}`, info);
    } catch (e) {
        console.error(`Failed to send email to ${to}`);
        throw e;
    }
}

function validateNodemailerParameters() {
    const user = process.env.SEND_EMAIL_USER;
    const pass = process.env.SEND_EMAIL_PASS;
    const to = process.env.RECEIVE_EMAIL_ADDRESS;
    if (!user) {
        throw new Error('Must set process.env.SEND_EMAIL_USER');
    }
    if (!pass) {
        throw new Error('Must set process.env.SEND_EMAIL_PASS');
    }
    if (!pass) {
        throw new Error('Must set process.env.SEND_EMAIL_PASS');
    }
    return { user, pass, to };
}

if (require.main === module) {
    main();
}

module.exports = main;