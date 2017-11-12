import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom'
import AppNavigation from './AppNavigation';
import AppMain from './AppMain';
//import logo from './logo.svg';
//import './App.css';

const title = 'Responsive Photo Gallery';

class App extends React.Component {

  state = {
    authtoken: false,
  };

  updateAuth = (token) => {
    this.setState({authtoken: token});
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

