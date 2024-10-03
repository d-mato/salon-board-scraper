FROM apify/actor-node-playwright-chrome:20

COPY package.json package-lock.json ./
RUN npm install --include=dev --audit=false

COPY . .
