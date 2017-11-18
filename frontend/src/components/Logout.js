// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import API from '../api';

class Logout extends React.Component {

  logout = () => {
    API.logout((good) => {
      if (!good) {
        //TODO
        console.log('Failed to logout');
        // Clear it anyway
        this.props.updateAuthCB(false);
        return;
      }
      this.props.updateAuthCB(false);
    }, {
      token: this.props.authtoken,
    });
    // TODO fix api - Clear it anyway when we get a 401
    this.props.updateAuthCB(false);
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

