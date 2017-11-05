FROM node
LABEL maintainer "j"

WORKDIR /usr/src/app

COPY . /usr/src/app
RUN npm install

ENV NODE_ENV production

VOLUME /data

EXPOSE 3000

CMD [ "npm", "start" ]

