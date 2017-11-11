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

  login() {
    this.props.updateAuthCB('testit');
    /*
    API.login((token) => {
      if(token) {
        this.props.updateAuthCB(token);
        this.setState({ redirectToReferrer: true })
      }
    }
    */
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
        <button onClick={this.login.bind(this)}>Login</button>
      </div>
    );
  }
};

export default Login;

