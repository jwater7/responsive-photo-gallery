import React from 'react';
import API from '../api';

class Logout extends React.Component {

  logout() {
    this.props.updateAuthCB(false);
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
    this.logout();
    return (
      <div>
        <p>You are now logged out</p>
      </div>
    );
  }
};

export default Logout;

