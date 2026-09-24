FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# Linux build of the CLI. No wallet session is baked into the image.
# The installer clones onchainos-skills, so git has to be present.
# -y -g skips the prompts that would hang a Docker build.
ENV GIT_TERMINAL_PROMPT=0
RUN npx -y @okxweb3/onchainos-installer install -y -g \
  && bin="$(command -v onchainos || find /root /usr -name onchainos -type f 2>/dev/null | head -1)" \
  && test -n "$bin" \
  && ln -sf "$bin" /usr/local/bin/onchainos \
  && onchainos --version
ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx tsc -p tsconfig.json && chmod +x scripts/start.sh

ENV PORT=4173
EXPOSE 4173

ENTRYPOINT ["scripts/start.sh"]
