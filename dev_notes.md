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

Add redux:
~~~~
npm install react-redux redux -S
~~~~

This was useful help on express middleware chains
https://stormpath.com/blog/how-to-write-middleware-for-express-apps

Useful links:
* http://sharp.dimens.io/en/stable/api-input/#metadata
* https://themeteorchef.com/tutorials/getting-started-with-react-router-v4
* https://github.com/ReactTraining/react-router/blob/master/website/modules/examples/Auth.js
* https://medium.com/@ruthmpardee/passing-data-between-react-components-103ad82ebd17
* https://medium.com/@pshrmn/a-simple-react-router-v4-tutorial-7f23ff27adf
* https://reacttraining.com/react-router/web/example/auth-workflow
* https://stackoverflow.com/questions/43520498/react-router-private-routes-redirect-not-working
* https://medium.freecodecamp.org/react-binding-patterns-5-approaches-for-handling-this-92c651b5af56
* https://devhints.io/react
* https://docs.npmjs.com/getting-started/publishing-npm-packages
* https://docs.travis-ci.com/user/languages/javascript-with-nodejs/
* https://docs.travis-ci.com/user/deployment/npm/
* https://reacttraining.com/react-router/web/api/Redirect
* https://www.npmjs.com/package/react-photo-gallery
* http://neptunian.github.io/react-photo-gallery/examples/lightbox.html
* https://redux.js.org/docs/basics/ExampleTodoList.html

JWT:
* https://medium.freecodecamp.org/how-to-make-authentication-easier-with-json-web-token-cc15df3f2228
* https://github.com/louischatriot/nedb
* https://github.com/scotch-io/node-token-authentication/blob/master/server.js
* https://scotch.io/tutorials/authenticate-a-node-js-api-with-json-web-tokens
* https://gist.github.com/smebberson/1581536

recursive readdir:
* https://gist.github.com/kethinov/6658166

node-json-db:
* https://www.npmjs.com/package/node-json-db

