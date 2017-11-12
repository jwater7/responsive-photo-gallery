import React from 'react';
import ReactDOM from 'react-dom';
//import './index.css';
import App from './components/App';
// TODO determine when to use the service worker for caching
//import registerServiceWorker from './registerServiceWorker';

ReactDOM.render((
  <App />
), document.getElementById('root'))
// TODO (see above)
//registerServiceWorker();

