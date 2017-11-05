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

