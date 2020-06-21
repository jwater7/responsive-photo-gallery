import React from 'react';
import { Redirect } from 'react-router-dom';
import { 
    FormControl,
    FormGroup,
    //ControlLabel,
    Button,
  } from 'react-bootstrap';
import API from '../api';

class Login extends React.Component {

  state = {
    redirectToReferrer: false,
    username: '',
    password: '',
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
          <FormGroup controlId="username">
            {/*<ControlLabel>Username:</ControlLabel>*/}
            <FormControl type="text" value={this.state.username} onChange={this.handleUsernameChange} placeholder="Enter username" autoCorrect="off" autoCapitalize="none"/>
          </FormGroup>
          <FormGroup controlId="password">
            {/*<ControlLabel>Password:</ControlLabel>*/}
            <FormControl type="password" value={this.state.password} onChange={this.handlePasswordChange} placeholder="Enter password"/>
          </FormGroup>
          <Button type="submit">Login</Button>
        </form>
      </div>
    );
  }
};

export default Login;

