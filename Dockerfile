# Lightweight Node.js image — no browser needed, Actor uses HTTP fetch only.
FROM apify/actor-node:22

# Copy package files and install production deps only
COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Copy source files
COPY --chown=myuser:myuser . ./

CMD ["node", "src/main.js"]
