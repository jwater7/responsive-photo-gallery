// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Redirect } from 'react-router-dom';

const LandingAuthenticated = (props) => (
  <div>
    <Redirect to="/albums" />
  </div>
);

export default LandingAuthenticated;
