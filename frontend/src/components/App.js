// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
// TODO import Cookies from 'universal-cookie';

import AppNavigation from './AppNavigation';
import AppMain from './AppMain';
//import logo from './logo.svg';
//import './App.css';
import API from '../api';

const title = 'Responsive Photo Gallery';

// TODO const cookies = new Cookies();

// TODO pass in
var basename = '/';
if (process.env.PUBLIC_URL) {
  basename = process.env.PUBLIC_URL;
  if (basename.substr(-1) !== '/') {
    basename += '/';
  }
}
if (process.env.REACT_APP_BASENAME) {
  basename = process.env.REACT_APP_BASENAME;
  if (basename.substr(-1) !== '/') {
    basename += '/';
  }
}

class App extends React.Component {
  constructor(props) {
    super(props);

    /* TODO 
    let authtoken = cookies.get('authtoken');
    // ugh, cookies are strings, make the bool a bool
    if (authtoken === "false") {
      authtoken = JSON.parse(authtoken);
    }
    */

    this.state = {
      authtoken: null,
    };
  }

  updateAuth = (token) => {
    // TODO cookies.set('authtoken', token, {path: '/'});
    this.setState({ authtoken: token });
    //if (!token) {
    //  cookies.remove('authtoken');
    //}
  };

  async componentDidMount() {
    // Check state of auth token expiration
    this.updateAuth(await API.ping({ token: this.state.authtoken }));
  }

  render() {
    return (
      <Router basename={basename}>
        <div className="App">
          <AppNavigation
            pagetitle={title}
            authtoken={this.state.authtoken}
            updateAuthCB={this.updateAuth}
            basename={basename}
            {...this.props}
          />
          <AppMain
            authtoken={this.state.authtoken}
            updateAuthCB={this.updateAuth}
            basename={basename}
            {...this.props}
          />
        </div>
      </Router>
    );
  }
}

export default App;
