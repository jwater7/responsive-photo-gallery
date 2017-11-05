Installed and ran express-generator to create skeleton:
~~~~
npm install -g express-generator
#PATH=$(npm bin):$PATH express --git --view pug --force
express --git --view pug --force
npm init #append more details
npm install
npm install swagger-jsdoc --save
npm install swagger-ui-express --save
~~~~

Run with (and add to package.json as debug script)
~~~~
DEBUG=responsive-photo-gallery:* npm start
~~~~

Or in docker run example:
~~~~
docker run -it --rm -p 3000:3000 jwater7/responsive-photo-gallery
~~~~

Create a react app:
~~~~
npm install -g create-react-app
create-react-app frontend
~~~~

