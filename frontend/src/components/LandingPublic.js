// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Redirect } from 'react-router-dom';

const LandingPublic = (props) => (
  <div>
    <Redirect to="/login" />
  </div>
);

export default LandingPublic;

