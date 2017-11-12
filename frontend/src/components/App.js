import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import Cookies from 'universal-cookie';

import AppNavigation from './AppNavigation';
import AppMain from './AppMain';
//import logo from './logo.svg';
//import './App.css';

const title = 'Responsive Photo Gallery';

const cookies = new Cookies();

class App extends React.Component {

  constructor(props) {
    super(props);

    let authtoken = cookies.get('authtoken');
    if (authtoken) {
      authtoken = JSON.parse(authtoken);
    }

    this.state = {
      authtoken: authtoken,
    };
  }

  updateAuth = (token) => {
    cookies.set('authtoken', token);
    this.setState({authtoken: token});
    //if (!token) {
    //  cookies.remove('authtoken');
    //}
  }

  render() {
    return (
      <Router>
        <div className="App">
          <AppNavigation pagetitle={title} authtoken={this.state.authtoken} {...this.props} />
          <AppMain authtoken={this.state.authtoken} updateAuthCB={this.updateAuth} {...this.props} />
        </div>
      </Router>
    );
  }
}

export default App;

