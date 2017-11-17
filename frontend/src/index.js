// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import ReactDOM from 'react-dom';
//import './index.css';
import App from './components/App';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import reducers from './reducers';
// TODO determine when to use the service worker for caching
//import registerServiceWorker from './registerServiceWorker';

let store = createStore(reducers);

ReactDOM.render((
  <Provider store={store}>
    <App />
  </Provider>
), document.getElementById('root'))
// TODO (see above)
//registerServiceWorker();

