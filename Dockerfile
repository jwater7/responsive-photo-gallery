FROM node
LABEL maintainer "j"

WORKDIR /usr/src/app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Bundle app source
COPY . ./

# Default to production mode
ENV NODE_ENV production

VOLUME /data

EXPOSE 3000

CMD [ "npm", "start" ]

