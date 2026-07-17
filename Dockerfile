# 'docker compose build' to compile to binary+build the image locally without need to push, but this doesn't have typecheck though

FROM oven/bun:latest AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build --compile --target=bun-linux-x64-musl src/index.ts --outfile=alicetele-bot

FROM alpine:latest 
RUN apk add --no-cache libstdc++ libgcc
RUN addgroup -g 1000 -S app && adduser -u 1000 -S app -G app
WORKDIR /app
COPY --from=build /app/alicetele-bot .
RUN chmod +x alicetele-bot && mkdir -p /app/data && chown -R app:app /app/data
USER app
EXPOSE 3000
CMD ["./alicetele-bot"]
