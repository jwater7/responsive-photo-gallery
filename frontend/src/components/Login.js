import React from 'react';
import { Redirect } from 'react-router-dom';
import API from '../api';

class Login extends React.Component {
  state = {
    redirectToReferrer: false,
  }

  login = () => {
    const self = this;
    API.login((token) => {
      if(token) {
        console.log(self.props);
        self.props.loginCallback(token);
        self.setState({ redirectToReferrer: true })
      }
    });
  }

  render() {
    const { from } = this.props.location.state || { from: { pathname: '/' } };
    const { redirectToReferrer } = this.state;

    if (redirectToReferrer) {
      return (
        <Redirect to={from}/>
      );
    }

    return (
      <div>
        <p>You must log in to view {from.pathname}</p>
        <button onClick={this.login}>Login</button>
      </div>
    );
  }
};

export default Login;

