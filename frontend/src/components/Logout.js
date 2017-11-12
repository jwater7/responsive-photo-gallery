import React from 'react';
import API from '../api';

class Logout extends React.Component {

  logout = () => {
    API.logout((good) => {
      if (!good) {
        //TODO
        console.log('Failed to logout');
        return;
      }
      this.props.updateAuthCB(false);
    }, {
      token: this.props.authtoken,
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

