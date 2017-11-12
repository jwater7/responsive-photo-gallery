import React from 'react';
import { Route, Redirect } from 'react-router-dom';

/* TODO why not work
const Authenticated = (props) => (
  <div>
    {props.authtoken ? <Route {...props} /> : <Redirect to="/login" />}
  </div>
);
*/
const AuthenticatedRoute = ({ authtoken, component, updateAuthCB, ...rest }) => (
  <Route {...rest} render={(props) => {
    //if (!authtoken) return <div></div>;
    return authtoken ?
    (React.createElement(component, { ...props, authtoken, updateAuthCB })) :
    (<Redirect to="/login" />);
  }} />
);
// TODO using rest in Component
/*
const AuthenticatedRoute = ({ component: Component, ...rest}) => (
  <Route {...rest} render={(props) => (
    rest.authtoken ?
    (<Component {...rest} />) :
    (<Redirect to="/login" />)
  )} />
);
*/

export default AuthenticatedRoute;

