# Loc Prod Planner — the Node web app.
#
# No build step and no npm install: the app has ZERO dependencies. It is plain Node
# reading the engine's .gs sources at startup, so the image is the base image plus a
# few hundred KB of source.
FROM node:22-alpine

# Runs as the base image's unprivileged `node` user. The app writes nothing to disk —
# all state is the Google Sheet — so it needs no writable volume.
WORKDIR /app
COPY --chown=node:node . /app
USER node

# The editing instance. Override PORT/PLANNER_READONLY per service (see compose).
ENV PORT=8127 \
    PLANNER_SOURCE=sheets \
    NODE_ENV=production
EXPOSE 8127

# The app answers /api/health with the store's state, which is a real readiness signal:
# it is only ok once the spreadsheet has been read at least once.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8127)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "webapp/server.js"]
