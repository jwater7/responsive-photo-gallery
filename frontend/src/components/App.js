import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom'
import AppNavigation from './AppNavigation';
import AppMain from './AppMain';
//import logo from './logo.svg';
//import './App.css';

const title = 'Responsive Photo Gallery';

class App extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      auth: {
        token: false,
      },
    };
  }

  updateAuth = (token) => {
    this.setState({auth: {token: token}});
  }

  render() {
    return (
      <Router>
        <div className="App">
          <AppNavigation pagetitle={title} authenticated={this.state.auth.token} {...this.props} />
          <AppMain authenticated={this.state.auth.token} updateAuthCB={this.updateAuth} {...this.props} />
        </div>
      </Router>
    );
  }
}

export default App;

