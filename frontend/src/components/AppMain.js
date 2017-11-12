import React from 'react';
import { Switch, Route } from 'react-router-dom';
import { Grid } from 'react-bootstrap';

import NotFound from './NotFound';
import AuthenticatedRoute from './AuthenticatedRoute';
import PublicRoute from './PublicRoute';
import Login from './Login';
import Logout from './Logout';
import Landing from './Landing';
import List from './List';

const AppMain = (props) => (
  <Grid>
    <Switch>
      <Route exact name="landing" path="/" component={Landing} />
      <AuthenticatedRoute exact path="/list" component={List} {...props} />
      <PublicRoute path="/login" component={Login} {...props} />
      <AuthenticatedRoute path="/logout" component={Logout} {...props} />
      <Route component={NotFound} />
    </Switch>
  </Grid>
);

export default AppMain;

