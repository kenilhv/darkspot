# DarkSpot chat services (tool server + guard proxy). Node 24 runs .ts directly (type stripping).
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY guard ./guard
COPY tools ./tools
COPY proxy ./proxy
COPY prompts ./prompts
COPY intake ./intake
COPY trace ./trace
