const axios = require('axios');

function scrapeSites() {
    return 'hello';
}

if (require.main === module) {
    console.log(scrapeSites());
}

module.exports = scrapeSites;