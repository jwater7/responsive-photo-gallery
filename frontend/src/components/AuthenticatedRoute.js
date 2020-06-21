import React from 'react';
import { Route, Redirect } from 'react-router-dom';

const AuthenticatedRoute = ({ component: Component, authtoken, ...rest }) => (
  <Route {...rest} render={(routeProps) => {
    //if (!authtoken) return <div></div>;
    return authtoken ?
    //(React.createElement(component, { ...routeProps, authtoken, ...rest })) :
    (<Component {...routeProps} authtoken={authtoken} {...rest} />) :
    authtoken === null ? <React.Fragment/> : (<Redirect to="/login" />);
  }} />
);

export default AuthenticatedRoute;

