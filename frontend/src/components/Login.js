import React from 'react';
import { Redirect } from 'react-router-dom';
import API from '../api';

class Login extends React.Component {

  state = {
    redirectToReferrer: false,
    username: 'TODOadmin',
    password: 'TODOpassword',
  };

  handleUsernameChange = (e) => {
    this.setState({username: e.target.value});
  }

  handlePasswordChange = (e) => {
    this.setState({password: e.target.value});
  }

  login = (e) => {
    e.preventDefault();
    API.login((token) => {
      if(token) {
        this.props.updateAuthCB(token);
        // TODO referrer redirect? (cant do here)
        //this.setState({ redirectToReferrer: true });
      }
    }, {
      username: this.state.username,
      password: this.state.password,
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
        <form onSubmit={this.login}>
          <label>Name:
            <input type="text" value={this.state.username} onChange={this.handleUsernameChange} />
            <input type="password" value={this.state.password} onChange={this.handlePasswordChange} />
          </label>
          <input type="submit" value="Login" />
        </form>
      </div>
    );
  }
};

export default Login;

