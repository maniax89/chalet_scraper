FROM node:14-alpine

WORKDIR /app

# prepare recreation-gov python scraper
COPY recreation-gov-campsite-checker/setup.py ./recreation-gov-campsite-checker/setup.py
COPY recreation-gov-campsite-checker/requirements.txt ./recreation-gov-campsite-checker/requirements.txt
COPY recreation-gov-campsite-checker/camping.py ./recreation-gov-campsite-checker/camping.py
RUN python3 -m pip install ./recreation-gov-campsite-checker

# prepare app
COPY package.json .
RUN yarn install
COPY index.js .

CMD ["node", "index.js"]