# Build stage
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# Production stage
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

# Cache directory for index YAML and downloaded PDFs
RUN mkdir -p /app/downloads

# Build info for somamcp's info tool. Set late so a new commit doesn't invalidate the install layer
ARG GIT_HASH=""
ARG BUILD_DATE=""
ARG BUILD_BRANCH=""
ENV GIT_HASH=${GIT_HASH} \
    SOMAMCP_BUILD_COMMIT=${GIT_HASH} \
    SOMAMCP_BUILD_DATE=${BUILD_DATE} \
    SOMAMCP_BUILD_BRANCH=${BUILD_BRANCH}

ENV MCP_TRANSPORT=httpStream
ENV MCP_PORT=8000

EXPOSE 8000

CMD ["node", "dist/index.js"]
