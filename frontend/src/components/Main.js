import React from 'react';
//import { Switch, Route, Redirect } from 'react-router-dom';
import Login from './Login';
import Home from './Home';

class Main extends React.Component {

  constructor(props) {
    super(props);

    this.state = {
      auth: {
        token: null,
      },
    };
  }

  setAuthenticated(token) {
    this.setState({
      auth: {
        token: token,
      },
    });
  }

  clearAuthenticated() {
    this.setState({
      auth: {
        token: null,
      },
    });
  }

  render() {
    return (
      <div>
        {!this.state.auth.token && <div className="Home"><Home /></div>}
        {this.state.auth.token && <Login onSignIn={this.setAuthenticated.bind(this)}/>}
      </div>
    );
  }
}

export default Main;

