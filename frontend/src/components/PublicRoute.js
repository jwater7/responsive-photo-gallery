import React from 'react';
import { Route, Redirect } from 'react-router-dom';

// TODO /list?
const PublicRoute = ({ authenticated, component, updateAuthCB, ...rest }) => (
  <Route {...rest} render={(props) => {
    //if (authenticated) return <div></div>;
    return !authenticated ?
    (React.createElement(component, { ...props, authenticated, updateAuthCB })) :
    (<Redirect to="/list" />);
  }} />
);

export default PublicRoute;

