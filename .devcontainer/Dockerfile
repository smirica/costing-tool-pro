FROM node:22.13-slim

# Install curl (for downloading ngrok) and unzip
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Install ngrok by downloading the official binary
RUN curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.zip -o /tmp/ngrok.zip \
    && unzip /tmp/ngrok.zip -d /usr/local/bin \
    && rm /tmp/ngrok.zip \
    && chmod +x /usr/local/bin/ngrok

WORKDIR /workspace

# Copy package files
COPY package*.json ./

# Install dependencies (glibc-compatible, so platform-specific binaries like
# @cloudflare/workerd-linux-64 install correctly)
RUN npm ci

# Copy the rest of the project
COPY . .

# Expose ports: 3000 for the dev server, 4040 for the on-demand ngrok inspector
EXPOSE 3000 4040

ENV HOST=0.0.0.0

# The dev container controls the local server lifecycle. The public tunnel is
# intentionally dormant until `npm run tunnel:start` is invoked.
CMD ["sleep", "infinity"]
