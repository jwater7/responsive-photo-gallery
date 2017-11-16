import React from 'react';
import { Route, Redirect } from 'react-router-dom';

// TODO /list?
const PublicRoute = ({ authtoken, component, updateAuthCB, ...rest }) => (
  <Route {...rest} render={(props) => {
    //if (authtoken) return <div></div>;
    return !authtoken ?
    (React.createElement(component, { ...props, authtoken, updateAuthCB })) :
    (<Redirect to="/albums" />);
  }} />
);

export default PublicRoute;

