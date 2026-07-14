FROM oven/bun:1-alpine AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
