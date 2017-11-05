FROM node:alpine
LABEL maintainer "j"

# Frontend node_modules
WORKDIR /usr/src/app/frontend
# Install dependencies
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install

# Backend node_modules
WORKDIR /usr/src/app
# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Bundle app source
COPY . ./

# Build the Frontend
WORKDIR /usr/src/app/frontend
RUN npm run build
WORKDIR /usr/src/app

# Default to production mode
ENV NODE_ENV production

VOLUME /data
VOLUME /images

EXPOSE 3000

CMD [ "npm", "start" ]

