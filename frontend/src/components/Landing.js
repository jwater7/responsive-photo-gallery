// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import LandingAuthenticated from './LandingAuthenticated';
import LandingPublic from './LandingPublic';

const Start = (props) => (
  <div>
    {props.authtoken ? (
      <LandingAuthenticated {...props} />
    ) : (
      <LandingPublic {...props} />
    )}
  </div>
);

export default Start;
