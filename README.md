# responsive-photo-gallery
NodeJS backend to serve a photo collection in a mobile-friendly and beautiful way
The Express web server will start up on port 3000 by default (this can be changed with the PORT environment variable).

To run using a docker container (uses local port 8000 to expose default port 3000 so you can bring up a web browser to http://localhost:8000/):
~~~~
docker run -d --name responsive-photo-gallery -v '/path/to/album/folders:/images:ro' -v '/your/persistent/storage/dir:/data:rw' -p 8000:3000 jwater7/responsive-photo-gallery
~~~~

To run as node module:
~~~~
npm install
cd frontend
npm install
cd ..
npm run build-frontend
npm start
~~~~

The backend may be customized using environment variables:
* SWAGGER_ROOT_PATH (default '')
  Set swagger documentation (available at /api-docs/) api root path
* PORT (default 3000)
  Set express server port
* DEFAULT_PASSWORD (default is a random base64 string)
  Sets the default API admin password (written to config file)
* DEFAULT_PRIVATE_KEY (default is a random base64 string)
  Sets the JSON Web Token signing key (to be consistent over reboots)
* PRIVATE_KEY (default is a random base64 string)
  Overrides the JSON Web Token signing key with a new one
* AUTH_PATH (default '/data/auth')
  Sets the path to the authentication data directory for persistance
* TAGS_PATH (default '/data/tags')
  Sets the path to the tags data directory for persistance of tag links and saved favorites
* IMAGE_PATH (default '/images')
  Sets the path the the photos
* THUMB_PATH (default '/data/thumbs')
  Sets the path to the thumb data directory for caching persistance
* DEBUG
  You may also use the debug package variables for some debugging output (for example, DEBUG=express,responsive-photo-gallery:\*)
* NO_AUTHENTICATION (default false)
  If set to "yes" then all users will have full access to all read-only backend calls and will not be prompted for a password

The frontend may be customized using these environment variables:
* PUBLIC_URL (default '')
  May be used as a prefix for all web requests (such as if it were hosted in a subdirectory reverse proxy on the server)
* REACT_APP_BASENAME (default '/' unless PUBLIC_URL)
  Sets the url prefix of the react routing
* REACT_APP_API_PREFIX (default '/' unless PUBLIC_URL unless REACT_APP_BASENAME)
  Sets the url prefix for all API calls to the express server

