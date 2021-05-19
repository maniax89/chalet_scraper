FROM node:14-alpine

WORKDIR /app

# Install python/pip
ENV PYTHONUNBUFFERED=1
RUN apk add --update --no-cache python3 && ln -sf python3 /usr/bin/python
RUN python3 -m ensurepip
RUN pip3 install --no-cache --upgrade pip setuptools

# prepare recreation-gov python scraper
COPY recreation-gov-campsite-checker/setup.py ./recreation-gov-campsite-checker/setup.py
COPY recreation-gov-campsite-checker/requirements.txt ./recreation-gov-campsite-checker/requirements.txt
COPY recreation-gov-campsite-checker/README.md ./recreation-gov-campsite-checker/README.md
COPY recreation-gov-campsite-checker/camping.py ./recreation-gov-campsite-checker/camping.py
RUN python3 -m pip install ./recreation-gov-campsite-checker

# prepare app
COPY package.json .
COPY yarn.lock .
RUN yarn install --frozen-lockfile
COPY recreationGovCampsiteChecker.js .
COPY index.js .

CMD ["node", "index.js"]