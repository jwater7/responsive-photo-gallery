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
#WORKDIR /usr/src/app/frontend
#RUN npm run build
#WORKDIR /usr/src/app

# Default to production mode
ENV NODE_ENV production
#ENV SWAGGER_ROOT_PATH
#ENV REACT_APP_API_PREFIX
#ENV PUBLIC_URL

VOLUME /data
VOLUME /images

EXPOSE 3000

#CMD [ "npm", "start" ]
CMD cd frontend && npm run build && cd .. && npm start

