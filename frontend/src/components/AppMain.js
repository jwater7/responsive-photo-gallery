// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Switch } from 'react-router-dom';
import { Grid } from 'react-bootstrap';

import NotFound from './NotFound';
import PropsRoute from './PropsRoute';
import AuthenticatedRoute from './AuthenticatedRoute';
import PublicOnlyRoute from './PublicOnlyRoute';
import Login from './Login';
import Logout from './Logout';
import Landing from './Landing';
import AlbumsContainer from './AlbumsContainer';
import ListContainer from './ListContainer';
import CollectionContainer from './CollectionContainer';
import SingleViewContainer from './SingleViewContainer';

const AppMain = (props) => (
  <Grid>
    <Switch>
      <PropsRoute
        exact
        name="landing"
        path="/"
        component={Landing}
        {...props}
      />
      <AuthenticatedRoute
        path="/singleview/:album"
        component={SingleViewContainer}
        action={'view'}
        {...props}
      />
      <AuthenticatedRoute
        path="/edit/:album"
        component={SingleViewContainer}
        action={'edit'}
        {...props}
      />
      <AuthenticatedRoute
        path="/list/:album"
        component={ListContainer}
        {...props}
      />
      <AuthenticatedRoute
        path="/collection/:album"
        component={CollectionContainer}
        {...props}
      />
      <AuthenticatedRoute
        exact
        path="/albums"
        component={AlbumsContainer}
        {...props}
      />
      <PublicOnlyRoute path="/login" component={Login} {...props} />
      <AuthenticatedRoute path="/logout" component={Logout} {...props} />
      <PropsRoute component={NotFound} {...props} />
    </Switch>
  </Grid>
);

export default AppMain;
