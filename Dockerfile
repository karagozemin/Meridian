FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Linux build of the CLI. No wallet session is baked into the image.
RUN curl -fsSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx tsc -p tsconfig.json && chmod +x scripts/start.sh

ENV PORT=4173
EXPOSE 4173

ENTRYPOINT ["scripts/start.sh"]
