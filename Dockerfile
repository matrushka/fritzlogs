FROM node:16-alpine AS builder
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --pure-lockfile
COPY . ./
RUN yarn build

FROM node:16-alpine AS runner
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --prod --pure-lockfile && yarn cache clean
COPY . ./
COPY --from=builder /app/build ./build

EXPOSE 3000

CMD ["yarn", "serve"]
