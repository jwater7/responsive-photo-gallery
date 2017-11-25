// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Route } from 'react-router-dom';

/*
const renderMergedProps = (component, ...rest) => {
  const finalProps = Object.assign({}, ...rest);
  return React.createElement(component, finalProps);
}
*/

const PropsRoute = ({ component: Component, ...rest }) => (
  <Route {...rest} render={(routeProps) => (
    <Component {...routeProps} {...rest} />
    //renderMergedProps(component, routeProps, rest);
  )} />
);

export default PropsRoute;

