import React from 'react';
import { Redirect } from 'react-router-dom';
import API from '../api';

class Login extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      redirectToReferrer: false,
    };
  }

  login = (loginCallback) => {
    API.login((token) => {
      if(token) {
        loginCallback(token);
        this.setState({ redirectToReferrer: true })
      }
    });
  }

  render() {
    //const { from } = this.props.location.state || { from: { pathname: '/' } };
    const { from } = { from: { pathname: '/' } };
    const { redirectToReferrer } = this.state;

    if (redirectToReferrer) {
      return (
        <Redirect to={from}/>
      );
    }

    return (
      <div>
        <p>You must log in to view {from.pathname}</p>
        <button onClick={this.login(this.props.onSignIn)}>Login</button>
      </div>
    );
  }
};

export default Login;

