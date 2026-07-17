FROM alpine:latest
RUN apk add --no-cache libstdc++ libgcc && addgroup -g 1000 -S app && adduser -u 1000 -S app -G app
WORKDIR /app
COPY alicetele-bot .
RUN chmod +x alicetele-bot && mkdir -p /app/data && chown -R app:app /app/data
USER app
EXPOSE 3000
CMD ["./alicetele-bot"]
