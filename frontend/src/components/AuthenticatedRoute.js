import React from 'react';
import { Route, Redirect } from 'react-router-dom';

/* TODO why not work
const Authenticated = (props) => (
  <div>
    {props.authenticated ? <Route {...props} /> : <Redirect to="/login" />}
  </div>
);
*/
const AuthenticatedRoute = ({ authenticated, component, updateAuthCB, ...rest }) => (
  <Route {...rest} render={(props) => {
    //if (!authenticated) return <div></div>;
    return authenticated ?
    (React.createElement(component, { ...props, authenticated, updateAuthCB })) :
    (<Redirect to="/login" />);
  }} />
);
// TODO using rest in Component
/*
const AuthenticatedRoute = ({ component: Component, ...rest}) => (
  <Route {...rest} render={(props) => (
    rest.authenticated ?
    (<Component {...rest} />) :
    (<Redirect to="/login" />)
  )} />
);
*/

export default AuthenticatedRoute;

