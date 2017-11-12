import React from 'react';
import API from '../api';

class Logout extends React.Component {

  logout = () => {
    //this.props.updateAuthCB(false);
    API.logout((token) => {
      this.props.updateAuthCB(token);
    });
  }

  componentDidMount() {
    this.logout();
  }

  render() {
    return (
      <div>
        <p>You are now logged out</p>
      </div>
    );
  }
};

export default Logout;

