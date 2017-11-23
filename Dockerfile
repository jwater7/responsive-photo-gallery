FROM node:alpine
LABEL maintainer "j"

# Backend node_modules
WORKDIR /usr/src/app
# Install dependencies
COPY package.json package-lock.json ./
#RUN npm install
# Build with gyp dependencies for sharp, see: http://sharp.dimens.io/en/stable/install/
RUN apk add --no-cache --virtual .gyp \
        python \
        make \
        g++ \
    && apk add vips-dev fftw-dev --update-cache --repository https://dl-3.alpinelinux.org/alpine/edge/testing/ \
    && npm install \
    && apk del .gyp

# Frontend node_modules
WORKDIR /usr/src/app/frontend
# Install dependencies
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install

# Bundle app source
WORKDIR /usr/src/app
COPY . ./

# Default to production mode
ENV NODE_ENV production
#ENV SWAGGER_ROOT_PATH
#ENV REACT_APP_API_PREFIX
#ENV REACT_APP_BASENAME
#ENV PUBLIC_URL

VOLUME /data
VOLUME /images

EXPOSE 3000

#CMD [ "npm", "start" ]
#TODO create entrypoint.sh
CMD npm run build-frontend && npm start

